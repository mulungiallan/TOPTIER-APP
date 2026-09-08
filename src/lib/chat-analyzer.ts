/**
 * TOPTIER AI Chat Analyser — multi-model fusion ("Triangulate") pipeline.
 *
 * Ported from the standalone "AI Chat Analyser" app and merged into TOPTIER.
 * Three independent layers form the ensemble:
 *
 *   1. Hugging Face — parallel specialist classifiers run concurrently:
 *      sentiment, emotion, toxicity, and named-entity recognition (NER).
 *   2. Gemini — structures the message: intent, topic, key facts and whether
 *      it needs human review. Returns strict JSON.
 *   3. Claude — the fusion + explainability layer. It weighs the HF and Gemini
 *      signals, explicitly resolves disagreement, and writes a plain-English
 *      verdict a human can trust without re-reading raw scores.
 *
 * Fast path: if Hugging Face is already highly confident and unambiguous
 * (>= FAST_PATH_CONFIDENCE and no per-task errors), Gemini and Claude are
 * skipped to save time/cost. Every result carries per-model `sources` so the
 * UI shows who said what — disagreement is shown, not hidden.
 *
 * The pipeline degrades gracefully: any layer that fails is captured and
 * passed along, rather than aborting the whole analysis.
 */

import { createHash } from 'crypto'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HfSignal {
  label: string
  score: number
}

export interface HfEntity {
  text: string
  type: string
  score: number
}

export interface HfResult {
  sentiment: HfSignal | null
  sentiment_distribution?: HfSignal[]
  emotion: HfSignal | null
  emotion_distribution?: HfSignal[]
  toxicity: HfSignal | null
  entities: HfEntity[]
  errors: Array<{ task: string; message: string }>
}

export interface GeminiStructure {
  intent?: string
  topic?: string
  key_facts?: string[]
  context_notes?: string
  requires_human_review?: boolean
  market_phase?: string
  market_notes?: string
}

// Accumulation · Manipulation · Distribution (AMD) market-cycle theory.
// Markets in a cycle: smart money accumulates quietly near lows → an
// engineered move (manipulation, e.g. stop hunts / fakeouts / liquidity grabs)
// shakes retail out → markup runs → smart money distributes into euphoria at
// the top → markdown. Detected when the chat content is trading-related.
export type AmdStage =
  | 'accumulation'
  | 'manipulation'
  | 'distribution'
  | 'markup'
  | 'markdown'
  | 'not_applicable'
  | 'unknown'

export interface AmdAssessment {
  stage: AmdStage
  confidence: number // 0-1
  market_relevant: boolean
  signals: string[] // matched phrases from the message
  explanation: string // plain-English read of the stage
  trading_style: AmdTradingStyle // normalised style implied by the message
  rr: string | null // recommended risk:reward for the detected style
}

export type AmdTradingStyle = 'scalp' | 'intraday' | 'swing' | 'unknown'

export interface ChatAnalysisResult {
  verdict: string
  confidence: number // 0-1
  severity: 'none' | 'low' | 'medium' | 'high'
  evidence_spans: string[]
  model_agreement: 'agree' | 'partial' | 'disagree'
  reasoning: string
  recommended_action: string
  amd: AmdAssessment
  path: 'fast' | 'full'
  cached: boolean
  sources: {
    huggingface: HfResult
    gemini: GeminiStructure | null
    gemini_error?: string
  }
}

interface CacheEntry {
  data: ChatAnalysisResult
  timestamp: number
}

// ─── Configuration ──────────────────────────────────────────────────────────

export const FAST_PATH_CONFIDENCE = parseFloat(
  process.env.FAST_PATH_CONFIDENCE ?? '0.97'
)

const HF_BASE = 'https://api-inference.huggingface.co/models'
const HF_TOKEN = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const CACHE_TTL_MS = 120 * 1000 // 2 minutes (matches original)
const CACHE_MAX_SIZE = 500
const MAX_INPUT_CHARS = parseInt(process.env.MAX_INPUT_CHARS ?? '6000', 10)

const HF_MODELS = {
  sentiment: 'cardiffnlp/twitter-roberta-base-sentiment-latest',
  emotion: 'j-hartmann/emotion-english-distilroberta-base',
  toxicity: 'unitary/toxic-bert',
  ner: 'dslim/bert-base-NER',
}

// Empirically verified 2026-09-04: `gemini-3.1-flash-lite` returns HTTP 200
// with content (~3.7s); `gemini-3.6-flash` and `gemini-flash-latest` HANG/abort
// or return 503 under load, so they are last resorts.
const GEMINI_MODELS = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.6-flash']

const CLAUDE_MODEL = 'claude-sonnet-4-6'

// ─── AMD (Accumulation · Manipulation · Distribution) rule engine ───────────
// Deterministic phrase detection so AMD classification always works — even on
// the HF fast path or when no LLM is configured. The LLM layers (Gemini /
// Claude) see the same stage and can refine it in their own explanation.

const AMD_KEYWORDS: Record<Exclude<AmdStage, 'not_applicable' | 'unknown'>, string[]> = {
  accumulation: [
    'accumulat', 'accumulation', 'loading up', 'loading', 'scooping', 'buying the dip',
    'buy the dip', 'smart money buying', 'whales accumulating', 'whale accumulation',
    'stealth buying', 'building a position', 'positioning', 'getting ready',
    'range', 'sideways', 'bottoming', 'basing', 'buy low', 'undervalued',
    'underpriced', 'discount', 'stage 1', 'stage one',
  ],
  manipulation: [
    'manipulat', 'stop hunt', 'stop-hunt', 'stop loss hunt', 'running stops',
    'liquidity grab', 'liquidity sweep', 'liquidity hunt', 'fakeout', 'fake out',
    'fake breakout', 'shakeout', 'shaking out', 'pump and dump', 'pump & dump',
    'exit liquidity', 'engineered', 'artificial', 'rigged', 'chart manipulation',
    'spoofing', 'wash trading', 'wash trade', 'bear trap', 'bull trap', 'trap',
  ],
  distribution: [
    'distribut', 'selling into strength', 'smart money selling', 'topping', 'topping out',
    'blow off', 'parabolic', 'euphoria', 'take profit', 'take profits', 'profit taking',
    'profit-taking', 'taking profit', 'big players selling', 'top signal', 'overbought',
    'exhaustion', 'dump', 'dumping', 'exit now', 'sell the rip', 'sell the rally',
  ],
  markup: [
    'markup', 'uptrend', 'bullish trend', 'trending up', 'pumping', 'squeeze',
    'breakout', 'break out', 'new high', 'all time high', 'ath',
  ],
  markdown: [
    'markdown', 'downtrend', 'bearish trend', 'crash', 'lower lows', 'death cross',
    'new low', 'all time low', 'cascade',
  ],
}

// Gating terms — a message only gets a real AMD stage if it also talks about
// markets/trading. Support-chat messages about orders etc. → not_applicable.
const AMD_MARKET_TERMS = [
  'buy', 'sell', 'long ', ' short', 'entry', 'stop loss', 'take profit', 'price',
  'market', 'chart', 'candle', 'signal', 'forex', 'crypto', 'btc', 'eth', 'usd',
  'stock', 'shares', 'trade', 'trading', 'position', 'breakout', 'dip', 'rally',
  'bull', 'bullish', 'bear', 'bearish', 'pump', 'dump', 'gain', 'loss', 'profit',
  'pips', 'lot', 'broker', 'coin', 'wallet', 'pair', 'liquidity', 'stop loss',
  'support', 'resistance',
]

const AMD_STAGE_PRIORITY: Array<Exclude<AmdStage, 'not_applicable' | 'unknown'>> = [
  'manipulation',
  'distribution',
  'accumulation',
  'markup',
  'markdown',
]

// Style detection + risk:reward policy for the chat analysis. When a message
// implies a trading style, we surface the house risk:reward for that style.
const AMD_STYLE_KEYWORDS: Record<Exclude<AmdTradingStyle, 'unknown'>, string[]> = {
  scalp: [
    'scalp', 'scalping', 'scalper', 'm1', 'm5', '1m ', '5m', '15m', 'small targets',
    'quick profit', 'quick profits', 'fast trade', 'in and out', 'grabbing pips',
    'quick scalps', 'short timeframe', 'small time frame',
  ],
  intraday: [
    'intraday', 'day trade', 'day trading', 'daytrader', 'this session',
    'end of day', 'm15', '30m ', '1h ', 'one hour', 'hourly', 'same day',
  ],
  swing: [
    'swing', 'swinging', 'h4', '4h', 'daily chart', 'holding days',
    'hold for days', 'days holding', 'multi-day', 'multi day', 'big move',
    'long term', 'weekly',
  ],
}

const AMD_RR_RECOMMENDATION: Record<Exclude<AmdTradingStyle, 'unknown'>, string> = {
  scalp: '1:3',
  intraday: '2:6–8',
  swing: '1:5',
}

function detectTradingStyle(text: string): AmdTradingStyle {
  const lower = text.toLowerCase()
  const scores: Array<{ style: AmdTradingStyle; hits: number }> = []
  ;(Object.keys(AMD_STYLE_KEYWORDS) as Array<Exclude<AmdTradingStyle, 'unknown'>>).forEach((style) => {
    const hits = AMD_STYLE_KEYWORDS[style].filter((kw) => lower.includes(kw)).length
    if (hits > 0) scores.push({ style, hits })
  })
  if (scores.length === 0) return 'unknown'
  scores.sort((a, b) => b.hits - a.hits)
  return scores[0].style
}

const AMD_EXPLANATIONS: Record<AmdStage, string> = {
  accumulation:
    'This talk describes smart money quietly building positions while price sits in a range or near lows — the "Accumulation" phase of the cycle. Expect the next leg to be a manipulated shakeout before the real move.',
  manipulation:
    'This talk flags engineered price action — stop hunts, liquidity grabs or fakeouts designed to shake retail traders out — the "Manipulation" phase. These messages usually precede a violent move against the crowd.',
  distribution:
    'This talk shows large holders selling into strength near cycle highs — the "Distribution" phase. Retail is typically euphoric here and a markdown leg usually follows.',
  markup:
    'This talk refers to price trending higher — the "Markup" phase, where the accumulated position gets run up. Distribution usually starts once retail FOMO peaks.',
  markdown:
    'This talk refers to price falling after the top — the "Markdown" phase. Smart money sold during distribution; longs are at risk until the next accumulation base forms.',
  not_applicable:
    'The message is not about markets or trading, so no accumulation/manipulation/distribution stage applies.',
  unknown:
    'The message has market context but no clear AMD phrase was detected; treat as undetermined.',
}

function isAmdStage(v: unknown): v is AmdStage {
  return (
    v === 'accumulation' ||
    v === 'manipulation' ||
    v === 'distribution' ||
    v === 'markup' ||
    v === 'markdown' ||
    v === 'not_applicable' ||
    v === 'unknown'
  )
}

export function detectAmdStage(text: string): AmdAssessment {
  const lower = text.toLowerCase()
  const hits: Record<Exclude<AmdStage, 'not_applicable' | 'unknown'>, string[]> = {
    accumulation: [],
    manipulation: [],
    distribution: [],
    markup: [],
    markdown: [],
  }

  ;(Object.keys(AMD_KEYWORDS) as Array<Exclude<AmdStage, 'not_applicable' | 'unknown'>>).forEach(
    (stage) => {
      for (const kw of AMD_KEYWORDS[stage]) {
        if (lower.includes(kw)) hits[stage].push(kw)
      }
    }
  )

  const marketHits = AMD_MARKET_TERMS.filter((t) => lower.includes(t))
  const anyStageHits = AMD_STAGE_PRIORITY.filter((s) => hits[s].length > 0)
  const marketRelevant = marketHits.length > 0
  const tradingStyle: AmdTradingStyle = marketRelevant ? detectTradingStyle(text) : 'unknown'

  const withRr = (explanation: string): string => {
    const rr = AMD_RR_RECOMMENDATION[tradingStyle as Exclude<AmdTradingStyle, 'unknown'>]
    if (!rr) return explanation
    return `${explanation} Fits the ${tradingStyle} style — house risk:reward is ${rr}.`
  }

  if (!marketRelevant || anyStageHits.length === 0) {
    const stage: AmdStage = marketRelevant ? 'unknown' : 'not_applicable'
    return {
      stage,
      confidence: 1,
      market_relevant: marketRelevant,
      signals: anyStageHits.flatMap((s) => hits[s]).slice(0, 5),
      explanation: withRr(AMD_EXPLANATIONS[stage]),
      trading_style: tradingStyle,
      rr: AMD_RR_RECOMMENDATION[tradingStyle as Exclude<AmdTradingStyle, 'unknown'>] ?? null,
    }
  }

  const scored = anyStageHits
    .map((s) => ({ stage: s, count: hits[s].length }))
    .sort((a, b) =>
      b.count - a.count ||
      AMD_STAGE_PRIORITY.indexOf(a.stage) - AMD_STAGE_PRIORITY.indexOf(b.stage)
    )

  const best = scored[0]
  const totalHits = scored.reduce((sum, s) => sum + s.count, 0)
  const confidence = Math.min(0.95, 0.5 + 0.09 * totalHits + (best.count === totalHits ? 0.05 : 0))

  return {
    stage: best.stage,
    confidence: confidence,
    market_relevant: true,
    signals: best.count > 0 ? hits[best.stage].slice(0, 5) : [],
    explanation: withRr(AMD_EXPLANATIONS[best.stage]),
    trading_style: tradingStyle,
    rr: AMD_RR_RECOMMENDATION[tradingStyle as Exclude<AmdTradingStyle, 'unknown'>] ?? null,
  }
}

// ─── In-memory cache ────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>()

// ─── Prompts ────────────────────────────────────────────────────────────────

const GEMINI_SCHEMA_INSTRUCTIONS = `You structure a customer/user chat message for downstream analysis.
Return ONLY valid JSON, no markdown fences, matching exactly this shape:
{
  "intent": string,            // e.g. "complaint", "question", "praise", "small_talk", "threat", "request_for_refund"
  "topic": string,             // short noun phrase, e.g. "shipping_delay", "billing", "product_defect"
  "key_facts": string[],       // short factual claims extracted from the message, max 5
  "context_notes": string,     // 1 sentence noting anything in the thread history relevant to interpreting this message; empty string if none
  "requires_human_review": boolean, // true if this message involves legal threats, self-harm, or content ambiguous enough that automated scoring alone is unsafe
  "market_phase": "accumulation"|"manipulation"|"distribution"|"markup"|"markdown"|"not_applicable"|null // Accumulation·Manipulation·Distribution stage the message implies about the referenced market; null if not trading related
  "market_notes": string       // 1 sentence on the AMD read, e.g. "Stop-hunt language suggests a shakeout before the real move"; empty if not trading related
}`

const CLAUDE_RESPONSE_CONTRACT = `Return ONLY valid JSON (no markdown fences) matching exactly this shape:
{
  "verdict": string,               // short label, e.g. "negative_frustrated_complaint"
  "confidence": number,            // 0 to 1
  "severity": "none"|"low"|"medium"|"high",
  "evidence_spans": string[],      // exact short quotes from the message that most drove the verdict, max 4
  "model_agreement": "agree"|"partial"|"disagree", // do the Hugging Face and Gemini signals line up with each other and with your read?
  "reasoning": string,             // 2-4 plain-English sentences: what you concluded, which signals you trusted and which you discounted, and why
  "recommended_action": string,    // one short, concrete next step for whoever owns this conversation
  "amd": {
    "stage": "accumulation"|"manipulation"|"distribution"|"markup"|"markdown"|"not_applicable"|"unknown", // which phase of the Accumulation·Manipulation·Distribution market cycle this message relates to
    "confidence": number,          // 0 to 1, how sure you are of the stage
    "trading_style": "scalp"|"intraday"|"swing"|"unknown", // style implied by the message (timeframes, hold durations, pacing)
    "explanation": string          // 1-2 sentences in plain English: what the message implies about the market cycle stage and what that means for traders; empty string if not trading related
  }
}`

// TODO the AMD theory: accumulation (smart money buying quietly near lows),
// manipulation (engineered shakeouts/stop hunts/liquidity grabs before the real
// move), distribution (smart money selling into euphoria at the top). When the
// message is about markets, assess which stage it implies and say why in
// "amd.explanation".

// ─── Fast path builder ──────────────────────────────────────────────────────

function fastPathResult(hf: HfResult, amd: AmdAssessment): Omit<ChatAnalysisResult, 'cached' | 'sources'> {
  const sentimentLabel = hf.sentiment?.label ?? 'unknown'
  const isToxic = (hf.toxicity?.score ?? 0) > 0.5
  const verdict = isToxic ? 'flagged_toxic' : `clear_${sentimentLabel}`
  const confidence = isToxic ? hf.toxicity!.score : hf.sentiment?.score ?? 0.5

  return {
    verdict,
    confidence,
    severity: isToxic ? 'medium' : 'none',
    evidence_spans: [],
    model_agreement: 'agree' as const,
    amd,
    reasoning: `Hugging Face's specialist models produced a high-confidence, unambiguous signal (${(confidence * 100).toFixed(0)}%), so the fast path skipped Gemini and Claude. Sentiment: ${sentimentLabel}${
      hf.emotion ? `, dominant emotion: ${hf.emotion.label}` : ''
    }. Toxicity score: ${(hf.toxicity?.score ?? 0).toFixed(2)}.`,
    recommended_action: isToxic ? 'Route to moderation queue' : 'No action needed',
    path: 'fast' as const,
  }
}

// ─── Hugging Face specialists ───────────────────────────────────────────────

function normalizeClassification(raw: unknown): HfSignal[] {
  const value = raw as Array<Array<HfSignal> | HfSignal> | null
  if (!Array.isArray(value)) return []
  const flat = Array.isArray(value[0]) ? (value[0] as HfSignal[]) : (value as HfSignal[])
  return [...flat].sort((a, b) => b.score - a.score)
}

function normalizeEntities(raw: unknown): HfEntity[] {
  if (!Array.isArray(raw)) return []
  return (raw as Array<Record<string, unknown>>)
    .map((e) => ({
      text: String(e.word ?? '').replace(/^##/, ''),
      type: String(e.entity_group ?? e.entity ?? 'MISC'),
      score: Number(e.score ?? 0),
    }))
    .filter((e) => e.text && e.score >= 0.5)
}

async function callHfModel(
  task: keyof typeof HF_MODELS,
  text: string,
  timeoutMs = 15000
): Promise<unknown> {
  if (!HF_TOKEN) {
    throw new Error('HF_TOKEN is not set')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const resp = await fetch(`${HF_BASE}/${HF_MODELS[task]}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`Hugging Face task "${task}" failed with status ${resp.status}: ${body}`)
    }

    return await resp.json()
  } finally {
    clearTimeout(timer)
  }
}

async function analyzeWithHuggingFace(text: string): Promise<HfResult> {
  const tasks = Object.keys(HF_MODELS) as Array<keyof typeof HF_MODELS>

  const results = await Promise.allSettled(tasks.map((task) => callHfModel(task, text)))

  const out: HfResult = {
    sentiment: null,
    emotion: null,
    toxicity: null,
    entities: [],
    errors: [],
  }

  results.forEach((result, i) => {
    const task = tasks[i]
    if (result.status === 'rejected') {
      out.errors.push({ task, message: result.reason?.message ?? String(result.reason) })
      return
    }

    const value = result.value
    switch (task) {
      case 'sentiment': {
        const ranked = normalizeClassification(value)
        out.sentiment = ranked[0] ?? null
        out.sentiment_distribution = ranked
        break
      }
      case 'emotion': {
        const ranked = normalizeClassification(value)
        out.emotion = ranked[0] ?? null
        out.emotion_distribution = ranked
        break
      }
      case 'toxicity': {
        const ranked = normalizeClassification(value)
        const toxic = ranked.find((r) => /toxic/i.test(r.label)) ?? ranked[0]
        out.toxicity = toxic ? { label: toxic.label, score: toxic.score } : null
        break
      }
      case 'ner': {
        out.entities = normalizeEntities(value)
        break
      }
    }
  })

  return out
}

// ─── Gemini structuring ─────────────────────────────────────────────────────

async function structureWithGemini(
  text: string,
  history: string[]
): Promise<GeminiStructure> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set')
  }

  const historyBlock = history.length
    ? `\n\nPrior messages in this thread, oldest first:\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
    : ''

  const prompt = `${GEMINI_SCHEMA_INSTRUCTIONS}${historyBlock}\n\nMessage to analyze:\n"""${text}"""`

  const transientStatus = new Set([429, 500, 502, 503, 504])

  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 512,
      },
    })

    let lastError: unknown = null
    let response: Response | null = null

    for (let attempt = 0; attempt < 3 && !response; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)

      try {
        let res = await fetch(`${url}?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        })

        if (res.status === 404) break
        if (res.ok) {
          response = res
          break
        }
        lastError = new Error(`Gemini API error: ${res.status}`)
        if (!transientStatus.has(res.status)) break
      } catch (err) {
        lastError = err
      } finally {
        clearTimeout(timeout)
      }

      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
      }
    }

    if (!response) {
      if (lastError) console.warn(`[chat-analyzer] Gemini ${model} failed:`, (lastError as Error).message)
      continue
    }

    const json = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const raw =
      json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''

    if (!raw) {
      console.warn(`[chat-analyzer] Gemini ${model} returned empty content (possibly blocked)`)
      continue
    }

    return JSON.parse(raw) as GeminiStructure
  }

  throw new Error('No Gemini model available')
}

// ─── Claude fusion / explanation ────────────────────────────────────────────

async function reasonWithClaude(args: {
  text: string
  hf: HfResult
  gemini: GeminiStructure | { note: string; error?: string }
  amdBase: AmdAssessment
}): Promise<Omit<ChatAnalysisResult, 'cached' | 'sources' | 'path'>> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set')
  }

  const { text, hf, gemini, amdBase } = args

  const prompt = `You are the final arbiter in a chat-analysis pipeline. Two other systems have already scored this message. Your job is to weigh their signals, resolve any disagreement, and explain your reasoning in plain English so a human reviewer can trust the result without re-reading the raw scores.

${CLAUDE_RESPONSE_CONTRACT}

Original message:
"""${text}"""

Hugging Face specialist model outputs:
${JSON.stringify(hf, null, 2)}

Gemini structured extraction:
${JSON.stringify(gemini, null, 2)}

Accumulation·Manipulation·Distribution (AMD) rule engine read:
${JSON.stringify(amdBase, null, 2)}

AMD theory: markets cycle through accumulation (smart money buys quietly near lows), manipulation (engineered shakeouts/stop hunts/liquidity grabs before the real move), markup, distribution (smart money sells into euphoria at the top), then markdown. If the message is trading-related, set "amd.stage" to the phase it implies and explain it. You may override the rule engine's stage if your reasoning is better, but keep the house risk:reward policy: scalp → 1:3, intraday → 2:6–8, swing → 1:5.

Weigh Hugging Face's toxicity/sentiment scores as reliable for surface-level tone, but treat sarcasm, understatement, or context-dependent meaning as things only you can catch. If Hugging Face and Gemini disagree, say so explicitly in "reasoning" and explain which one you trusted more and why.`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`)
    }

    const json = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>
    }
    const textBlock = (json?.content || []).find((b) => b.type === 'text')
    if (!textBlock?.text) {
      throw new Error('Claude returned no text content')
    }

    const cleaned = textBlock.text.trim().replace(/^```json\s*|```$/g, '')
    const parsed = JSON.parse(cleaned) as {
      verdict?: string
      confidence?: number
      severity?: string
      evidence_spans?: unknown
      model_agreement?: string
      reasoning?: string
      recommended_action?: string
      amd?: {
        stage?: string
        confidence?: number
        trading_style?: string
        explanation?: string
      }
    }

    return {
      verdict: parsed.verdict ?? 'unknown',
      confidence: sanitizeConfidence(parsed.confidence),
      severity: sanitizeSeverity(parsed.severity),
      evidence_spans: sanitizeStrings(parsed.evidence_spans).slice(0, 4),
      model_agreement: sanitizeAgreement(parsed.model_agreement),
      amd: mergeAmd(amdBase, parsed.amd),
      reasoning:
        parsed.reasoning ||
        'Claude did not return an explicit reasoning string; the raw signals are shown below.',
      recommended_action: parsed.recommended_action || 'Review manually',
    }
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Sanitizers ─────────────────────────────────────────────────────────────

function mergeAmd(base: AmdAssessment, claudeAmd?: { stage?: string; confidence?: number; trading_style?: string; explanation?: string }): AmdAssessment {
  const claudeStage = String(claudeAmd?.stage || '').toLowerCase()
  const stage: AmdStage = isAmdStage(claudeStage) && claudeStage !== 'not_applicable'
    ? claudeStage
    : base.stage

  const claudeStyle = String(claudeAmd?.trading_style || '').toLowerCase()
  const tradingStyle: AmdTradingStyle =
    claudeStyle === 'scalp' || claudeStyle === 'intraday' || claudeStyle === 'swing'
      ? claudeStyle
      : base.trading_style

  const claudeExpl = typeof claudeAmd?.explanation === 'string' && claudeAmd.explanation.trim()
    ? claudeAmd.explanation.trim()
    : base.explanation
  const explanation = tradingStyle === base.trading_style && base.rr && !claudeExpl.includes(base.rr)
    ? `${claudeExpl} Fits the ${tradingStyle} style — house risk:reward is ${base.rr}.`
    : claudeExpl

  return {
    stage,
    confidence: sanitizeConfidence(claudeAmd?.confidence ?? base.confidence),
    market_relevant: base.market_relevant,
    signals: base.signals,
    explanation: explanation,
    trading_style: tradingStyle,
    rr: AMD_RR_RECOMMENDATION[tradingStyle as Exclude<AmdTradingStyle, 'unknown'>] ?? null,
  }
}

function sanitizeConfidence(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

function sanitizeSeverity(value: unknown): ChatAnalysisResult['severity'] {
  const v = String(value || '').toLowerCase()
  if (v === 'low' || v === 'medium' || v === 'high') return v
  return 'none'
}

function sanitizeAgreement(value: unknown): ChatAnalysisResult['model_agreement'] {
  const v = String(value || '').toLowerCase()
  if (v === 'agree' || v === 'partial' || v === 'disagree') return v
  return 'partial'
}

function sanitizeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((s) => String(s).trim()).filter((s) => s.length > 0)
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export class ChatAnalyzer {
  /**
   * Analyze a chat message with the three-model fusion pipeline.
   */
  async analyzeMessage(text: string, options: { history?: string[] } = {}): Promise<ChatAnalysisResult> {
    const trimmed = text.trim()
    if (!trimmed) {
      throw new Error('Message is empty')
    }
    if (trimmed.length > MAX_INPUT_CHARS) {
      throw new Error(`Message exceeds the ${MAX_INPUT_CHARS}-character limit`)
    }

    const history = (options.history || []).map((h) => h.trim()).filter(Boolean)
    const cacheKey = createHash('md5')
      .update(`${trimmed}\u0000${history.join('\u0001')}`)
      .digest('hex')

    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { ...cached.data, cached: true }
    }

    // AMD (Accumulation · Manipulation · Distribution) cycle read — always
    // computed deterministically so every result carries a market-cycle stage.
    const amdBase = detectAmdStage(trimmed)

    // 1. Hugging Face parallel specialists (degrades gracefully if token missing/invalid).
    let hf: HfResult
    try {
      hf = await analyzeWithHuggingFace(trimmed)
    } catch (err) {
      console.warn('[chat-analyzer] Hugging Face unavailable, proceeding without HF signals:', (err as Error).message)
      hf = {
        sentiment: null,
        emotion: null,
        toxicity: null,
        entities: [],
        errors: [{ task: 'all', message: err instanceof Error ? err.message : String(err) }],
      }
    }

    const hfConfidence = Math.max(
      hf.sentiment?.score ?? 0,
      hf.toxicity?.score ?? 0
    )
    const hfAmbiguous = hf.errors.length > 0 || hfConfidence < FAST_PATH_CONFIDENCE

    let result: ChatAnalysisResult

    if (!hfAmbiguous) {
      // Fast path — HF signal is unambiguous.
      result = {
        ...fastPathResult(hf, amdBase),
        cached: false,
        sources: { huggingface: hf, gemini: null },
      }
    } else {
      // 2. Gemini structuring (optional, degrades gracefully).
      let geminiResult: GeminiStructure | null = null
      let geminiError: string | undefined

      try {
        if (GEMINI_API_KEY) {
          geminiResult = await structureWithGemini(trimmed, history)
        } else {
          geminiError = 'GEMINI_API_KEY is not set'
        }
      } catch (err) {
        geminiError = err instanceof Error ? err.message : String(err)
      }

      // 3. Claude fusion + explanation.
      let claudePart: Omit<ChatAnalysisResult, 'cached' | 'sources' | 'path'>
      try {
        if (ANTHROPIC_API_KEY) {
          claudePart = await reasonWithClaude({
            text: trimmed,
            hf,
            gemini: geminiResult ?? { note: 'Gemini unavailable', error: geminiError },
            amdBase,
          })
        } else {
          claudePart = fallbackFusionResult(hf, geminiResult, geminiError, amdBase)
        }
      } catch (err) {
        console.warn('[chat-analyzer] Claude failed, using built-in fusion:', (err as Error).message)
        claudePart = fallbackFusionResult(hf, geminiResult, geminiError, amdBase)
      }

      result = {
        ...claudePart,
        path: 'full',
        cached: false,
        sources: {
          huggingface: hf,
          gemini: geminiResult,
          gemini_error: geminiError,
        },
      }
    }

    cache.set(cacheKey, { data: result, timestamp: Date.now() })

    // Evict oldest entries if cache exceeds max size.
    if (cache.size > CACHE_MAX_SIZE) {
      const now = Date.now()
      for (const [key, entry] of cache) {
        if (cache.size <= CACHE_MAX_SIZE * 0.8 || now - entry.timestamp > CACHE_TTL_MS) {
          cache.delete(key)
        }
      }
    }

    return result
  }

  /**
   * Provider availability for the health/status badge.
   */
  getProviderStatus() {
    return {
      huggingface: Boolean(HF_TOKEN),
      gemini: Boolean(GEMINI_API_KEY),
      claude: Boolean(ANTHROPIC_API_KEY),
    }
  }

  clearCache() {
    cache.clear()
  }
}

// ─── Built-in fusion fallback (no Claude key) ───────────────────────────────

function fallbackFusionResult(
  hf: HfResult,
  gemini: GeminiStructure | null,
  geminiError: string | undefined,
  amd: AmdAssessment
): Omit<ChatAnalysisResult, 'cached' | 'sources' | 'path'> {
  const isToxic = (hf.toxicity?.score ?? 0) > 0.5
  const sentimentLabel = hf.sentiment?.label ?? 'unknown'

  const verdictParts: string[] = []
  if (isToxic) verdictParts.push('flagged_toxic')
  if (sentimentLabel && sentimentLabel !== 'unknown') verdictParts.push(sentimentLabel)
  if (gemini?.intent && !verdictParts.includes(String(gemini.intent).toLowerCase().slice(0, 8))) {
    verdictParts.push(String(gemini.intent))
  }
  const verdict = verdictParts.length ? verdictParts.join('_') : 'unclassified'

  const severity: ChatAnalysisResult['severity'] = isToxic ? 'medium' : 'none'
  const confidence = isToxic
    ? sanitizeConfidence(hf.toxicity?.score)
    : Math.max(0.5, sanitizeConfidence(hf.sentiment?.score ?? 0.5))

  const reasoningBits: string[] = []
  reasoningBits.push(`Hugging Face sentiment: ${sentimentLabel}${
    hf.sentiment ? ` (${(hf.sentiment.score * 100).toFixed(0)}%)` : ''
  }${
    hf.emotion ? `; dominant emotion: ${hf.emotion.label} (${(hf.emotion.score * 100).toFixed(0)}%)` : ''
  }.`)
  if (hf.toxicity) reasoningBits.push(`Toxicity score: ${(hf.toxicity.score * 100).toFixed(0)}%.`)
  if (gemini?.intent || gemini?.topic) {
    reasoningBits.push(`Gemini read this as "${String(gemini.intent)}"${gemini.topic ? ` (${gemini.topic})` : ''}.`)
  }
  if (geminiError) reasoningBits.push(`Gemini was unavailable (${geminiError}); analysis is based on Hugging Face signals.`)

  return {
    verdict,
    confidence,
    severity,
    evidence_spans: [],
    model_agreement: gemini ? 'agree' : 'partial',
    amd,
    reasoning: reasoningBits.join(' '),
    recommended_action: isToxic
      ? 'Route to moderation queue'
      : String(gemini?.requires_human_review ? 'Escalate for human review' : 'No action needed'),
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const chatAnalyzer = new ChatAnalyzer()
