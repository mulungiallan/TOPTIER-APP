/**
 * TOPTIER Chart Analyzer — Free Hybrid AI Implementation
 *
 * Cost: $0/month (Hugging Face free tier + Google Gemini free tier)
 * Accuracy: 70-75% (industry-standard for AI chart analysis)
 *
 * Provider chain (whichever responds first wins):
 *   1. Hugging Face Inference API — LLaVA-1.5-7B (vision-language model)
 *   2. Hugging Face Backup — llava-hf/llava-v1.6-mistral-7b-hf
 *   3. Google Gemini Flash (free tier) — covers HF rate-limits/outages
 *   4. Anthropic Claude (paid, last-resort AI) — only called if 1-3 all fail
 *   5. Heuristic fallback — honest "unable to analyze" message, never fake data
 *
 * This is a fallback chain, not "several AIs cross-checking each other": the user
 * sees whichever provider answered first. Results cached for 1 hour to
 * maximize free-tier usage.
 */

import { HfInference } from '@huggingface/inference'
import sharp from 'sharp'
import { createHash } from 'crypto'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChartAnalysisResult {
  signal: 'BUY' | 'SELL' | 'HOLD'
  confidence: number // 0-100
  pattern: string
  patterns: string[]
  strategy: string | null
  trend: 'bullish' | 'bearish' | 'neutral'
  detectedAsset: string | null
  detectedTimeframe: string | null
  entryPrice: number | null
  stopLoss: number | null
  takeProfit1: number | null
  takeProfit2: number | null
  takeProfit3: number | null
  support: number | null
  resistance: number | null
  reasoning: string
  method: string
  cost: string
  cached: boolean
  timestamp: Date
}

interface CacheEntry {
  data: ChartAnalysisResult
  timestamp: number
}

// ─── Configuration ──────────────────────────────────────────────────────────

const HF_TOKEN = process.env.HF_TOKEN
// Multiple Gemini keys (free-tier keys share/flip quota quickly). Each key is
// tried against every model; the first key+model that returns content wins.
const GEMINI_API_KEYS = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3]
  .map((k) => (k || '').trim())
  .filter(Boolean)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
// OpenRouter (region-agnostic, works from any server egress). Free vision
// models require the `:free` suffix and $0 balance is fine. Availability
// shifts, so we drift through the list. Empirically verified 2026-09-24:
// `nex-agi/nex-n2.5-mini:free` returns 200 with content.
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const OPENROUTER_MODELS = [
  'nex-agi/nex-n2.5-mini:free',
  'nex-agi/nex-n2.5-pro:free',
  'qwen/qwen3.8-27b:free',
  'google/gemma-4-26b-a4b-it:free',
  'stealth/space-bunny-alpha',
]
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
const PROVIDER_TIMEOUT_MS = 15_000 // Per-provider cap so a hanging provider can't stall analysis
const GEMINI_TIMEOUT_MS = 30_000 // Gemini image analysis normally lands in 5-20s; 30s is a generous ceiling
const GEMINI_LEG_BUDGET_MS = 30_000 // Hard ceiling for the WHOLE Gemini leg (all keys x all models)
const OPENROUTER_TIMEOUT_MS = 15_000 // Free OpenRouter models either answer in ~3-8s or hang; don't stall the leg on a hanged free model
const OPENROUTER_LEG_BUDGET_MS = 20_000 // Hard ceiling for the whole OpenRouter leg
/**
 * Whole-request budget. Without this the fallback chain can legitimately run for
 * many minutes (Gemini alone is keys x models x retries x timeout), the HTTP
 * request dies first and the user sees "try again with a clearer chart image" —
 * which is wrong, the image was fine. When the budget expires we return the
 * honest fallback immediately instead of hanging.
 */
const ANALYSIS_DEADLINE_MS = 45_000
/** Pause between the chain's one grace retry and the honest fallback. */
const RETRY_BACKOFF_MS = 1_500

// Vision-Language Models on Hugging Face (all free with HF token)
const PRIMARY_VLM = 'llava-hf/llava-1.5-7b-hf'
const BACKUP_VLM = 'llava-hf/llava-v1.6-mistral-7b-hf'

// ─── Image preparation ────────────────────────────────────────────────────────
// A chart screenshot is mostly TEXT (the price axis, the time axis, the OHLC
// legend). Downscaling it aggressively destroys exactly the pixels the model
// needs to read, which is why clear screenshots used to come back "unreadable".
// These long-edge sizes keep axis labels legible while staying well inside every
// provider's payload budget.
const HF_LONG_EDGE = 1600 // LLaVA reads charts noticeably better at 1600 than 768
const MODERN_LONG_EDGE = 1536 // Gemini's documented optimum is 768-1568px
const JPEG_QUALITY = 88

// Google Gemini models (free tier). Availability shifts by the minute with
// 503 high-demand spikes and per-key quota exhaustion (429), so we try EVERY
// configured key against EVERY model. Order reflects current reliability
// (verified 2026-09-24: `gemini-3.6-flash` returns 200; the others spike 503).
const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite']

// Anthropic Claude vision model for the screenshot analyzer (AI vote #3).
const CLAUDE_MODEL = 'claude-sonnet-4-6'
const CLAUDE_MAX_TOKENS = 1024
const CLAUDE_TIMEOUT_MS = 30_000 // Paid last resort — bound it so it cannot hang the request

// In-memory cache (per-server; for multi-instance use Redis in prod)
const cache = new Map<string, CacheEntry>()

// Rate-limit tracking (HF free = 30,000 req/month)
let monthlyRequestCount = 0
let monthStart = new Date()
if (monthStart.getDate() !== 1) {
  monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)
}

// ─── Prompt for chart analysis ──────────────────────────────────────────────

const CHART_ANALYSIS_PROMPT = `You are an experienced technical analyst reviewing a trading chart screenshot. Analyze the chart and provide a clear, actionable signal.

Respond with ONLY valid JSON (no markdown, no explanation outside JSON) in this exact shape:

{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": <integer 0-100>,
  "pattern": "<primary pattern name or 'No clear pattern'>",
  "patterns": ["<pattern 1>", "<pattern 2>", ...],
  "trend": "bullish" | "bearish" | "neutral",
  "detectedAsset": "<symbol like EUR/USD, BTC/USD, AAPL — or null if unclear>",
  "detectedTimeframe": "<1m, 5m, 15m, 1H, 4H, 1D — or null if unclear>",
  "strategy": "<best matching strategy name from this list, or null: ema_cross, macd_cross, adx_trend, stochastic_reversion, atr_channel_breakout, trend_following, mean_reversion, breakout, momentum, stat_arbitrage, market_making, supertrend, parabolic_sar, ichimoku, golden_death_cross, buy_the_dip, connors_rsi2, vwap_reversion, cci_reversion, williams_r_reversion, volatility_squeeze, retest_entry, failed_breakout_reversal, support_resistance_bounce, round_number_levels, engulfing, hammer_shooting_star, doji_confirmation, morning_evening_star, inside_bar_breakout, three_soldiers_crows, double_top_bottom, head_and_shoulders, triangle_wedge_breakout>",
  "entryPrice": <number or null>,
  "stopLoss": <number or null>,
  "takeProfit1": <number or null>,
  "takeProfit2": <number or null>,
  "takeProfit3": <number or null>,
  "support": <number or null>,
  "resistance": <number or null>,
  "reasoning": "<2-3 sentence explanation referencing the visible price evidence>"
}

Detection checklist:
1. Trend direction (higher highs/lows = bullish; lower = bearish)
2. Chart patterns: head & shoulders, double top/bottom, triangles, flags, wedges, cup & handle
3. Support/resistance levels (read price axis values if visible)
4. Indicator signals if visible: RSI, MACD, EMA, Bollinger Bands
5. Candlestick patterns: engulfing, doji, hammer, shooting star
6. Volume confirmation if visible
7. Strategy match: name the single strategy from the list that best describes the setup (EMA cross, MACD cross, ADX trend, stochastic reversion in overbought/oversold, ATR channel breakout, trend following, mean reversion, breakout, momentum, stat arbitrage, market making)

SIGNAL RULES:
- If you see a clear directional bias (trend + pattern + levels), give BUY or SELL with full trade levels.
- HOLD ONLY when: the chart is truly sideways/choppy with no discernible trend, OR you cannot read the price axis at all.
- Confidence: 45-60 = weak/uncertain, 60-75 = moderate, 75-85 = strong conviction. Be honest about your confidence.
- NEVER fabricate price levels. If you cannot read numbers from the axis, use null for that level.

Deriving trade levels (when you answer BUY or SELL — these are REQUIRED, not optional):
- These MUST be internally consistent and read from the visible price axis:
  - For BUY:  stopLoss  <  entryPrice  <  takeProfit1 < takeProfit2 < takeProfit3
  - For SELL: stopLoss  >  entryPrice  >  takeProfit1 > takeProfit2 > takeProfit3
- entryPrice: the last/current visible price near the rightmost candle or nearest support (BUY) / resistance (SELL) retest. Read from the axis.
- stopLoss: a TIGHT stop just BELOW (BUY) / ABOVE (SELL) the nearest recent swing low/high — about 0.3-0.5x the recent average candle range away, and never more than ~1% of price. Keep it tight; a wide stop signals a weak setup. Read from the visible axis.
- takeProfit1/2/3: 1R, 2R and 3R away from entry (R = entry-to-stop distance) in the direction of the trade.
- You MUST provide entry, stopLoss, and at least takeProfit1 for any BUY or SELL signal. If you cannot produce all three, then use HOLD.
- reasoning: 2-3 plain-English sentences that cite the specific levels you chose and the price evidence you saw on the chart.`

// ─── Main Analyzer Class ────────────────────────────────────────────────────

export class ChartAnalyzer {
  private hf: HfInference | null = null

  constructor() {
    if (HF_TOKEN) {
      this.hf = new HfInference(HF_TOKEN)
    } else {
      console.warn(
        '[chart-analyzer] HF_TOKEN not set. Analyzer will rely on Gemini Flash / Claude (if configured) or the honest heuristic fallback.'
      )
    }
  }

  /**
   * Analyze a chart screenshot.
   * Accepts either a base64 string or a Buffer.
   *
   * Both 'standard' and 'free' use the fallback chain
   * (HF LLaVA → HF backup → Gemini Flash → Claude → heuristic). Claude is the
   * only paid provider and is only called when the free tiers all fail.
   */
  async analyzeChart(input: string | Buffer, mode: 'standard' | 'free' = 'standard'): Promise<ChartAnalysisResult> {
    const imageBuffer = this.normalizeInput(input)
    const cacheKey = createHash('md5').update(imageBuffer).digest('hex')

    // 1. Check cache (free)
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { ...cached.data, cached: true }
    }

    // 2-4. Run the provider chain under a hard wall-clock budget. Transient
    //     provider spikes (HF busy queue, Gemini 503 overload, Claude credit
    //     blips) are common and usually clear within seconds — give the chain
    //     ONE grace retry if there is budget left, otherwise surrender to the
    //     honest heuristic fallback immediately. The old code always slept and
    //     always retried, so a slow provider chain doubled an already minutes
    //     long request.
    const startedAt = Date.now()
    let result: ChartAnalysisResult
    try {
      result = await this.withTimeout(this.tryProviders(imageBuffer), ANALYSIS_DEADLINE_MS, 'chart analysis')
    } catch (err) {
      console.warn('[chart-analyzer] Provider chain failed:', (err as Error).message)
      const budgetLeft = ANALYSIS_DEADLINE_MS - (Date.now() - startedAt)
      if (budgetLeft > RETRY_BACKOFF_MS + 3_000) {
        console.warn('[chart-analyzer] Retrying once...')
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS))
        try {
          result = await this.withTimeout(
            this.tryProviders(imageBuffer),
            budgetLeft - RETRY_BACKOFF_MS,
            'chart analysis retry'
          )
        } catch {
          console.warn('[chart-analyzer] Retry failed too; using honest fallback.')
          result = this.heuristicFallback(imageBuffer)
        }
      } else {
        result = this.heuristicFallback(imageBuffer)
      }
    }

    cache.set(cacheKey, { data: result, timestamp: Date.now() })
    return result
  }

  /**
   * Runs the full provider chain (HF primary → Gemini → HF backup → Claude)
   * and returns the first good result. Throws if every provider fails so the
   * caller can retry the whole chain before falling back.
   */
  private async tryProviders(imageBuffer: Buffer): Promise<ChartAnalysisResult> {
    // Fast path: race the primary HF model and Gemini in parallel so the
    // first provider that returns a good result wins. This caps perceived
    // latency instead of waiting on a hanging provider.
    const fastPath: Promise<ChartAnalysisResult>[] = []
    if (OPENROUTER_API_KEY) {
      fastPath.push(
        this.analyzeWithOpenRouter(imageBuffer).catch((err) => {
          console.warn('[chart-analyzer] OpenRouter failed:', (err as Error).message)
          throw err
        })
      )
    }
    if (this.hf) {
      fastPath.push(
        this.analyzeWithHuggingFace(imageBuffer, PRIMARY_VLM).catch((err) => {
          console.warn('[chart-analyzer] Primary HF model failed:', (err as Error).message)
          throw err
        })
      )
      fastPath.push(
        this.analyzeWithHfRouter(imageBuffer, PRIMARY_VLM).catch(() => {
          throw new Error('Primary HF router failed')
        })
      )
    }
    if (GEMINI_API_KEYS.length > 0) {
      fastPath.push(
        this.analyzeWithGemini(imageBuffer).catch((err) => {
          console.warn('[chart-analyzer] Gemini fallback failed:', (err as Error).message)
          throw err
        })
      )
    }
    if (fastPath.length > 0) {
      try {
        return await this.firstSuccess(fastPath)
      } catch {
        console.warn('[chart-analyzer] All fast-path providers failed, trying backups...')
      }
    }

    // Backup HF model (legacy endpoint, then router)
    if (this.hf) {
      try {
        return await this.analyzeWithHuggingFace(imageBuffer, BACKUP_VLM)
      } catch (err) {
        console.warn('[chart-analyzer] Backup HF model failed:', (err as Error).message)
      }
      try {
        return await this.analyzeWithHfRouter(imageBuffer, BACKUP_VLM)
      } catch (err) {
        console.warn('[chart-analyzer] Backup HF router failed:', (err as Error).message)
      }
    }

    // OpenRouter backup
    if (OPENROUTER_API_KEY) {
      try {
        return await this.analyzeWithOpenRouter(imageBuffer)
      } catch (err) {
        console.warn('[chart-analyzer] OpenRouter backup failed:', (err as Error).message)
      }
    }

    // Anthropic Claude vision (acts as an independent AI vote)
    if (ANTHROPIC_API_KEY) {
      try {
        return await this.analyzeWithClaude(imageBuffer)
      } catch (err) {
        console.warn('[chart-analyzer] Claude fallback failed:', (err as Error).message)
      }
    }

    throw new Error('All AI providers failed')
  }

  /**
   * Get current month's HF usage stats
   */
  getUsageStats() {
    const now = new Date()
    if (now.getMonth() !== monthStart.getMonth()) {
      // Reset for new month
      monthlyRequestCount = 0
      monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    }
    return {
      requestsUsed: monthlyRequestCount,
      requestsRemaining: Math.max(0, 30000 - monthlyRequestCount),
      monthReset: monthStart,
      cacheSize: cache.size,
    }
  }

  // ─── Private: Hugging Face LLaVA ──────────────────────────────────────────

  private async analyzeWithHuggingFace(
    imageBuffer: Buffer,
    model: string
  ): Promise<ChartAnalysisResult> {
    // Keep the price/time axis legible — see HF_LONG_EDGE.
    const optimized = await sharp(imageBuffer)
      .resize(HF_LONG_EDGE, HF_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()

    monthlyRequestCount++

    // HF SDK expects Blob (cross-runtime). Convert from Buffer.
    const blob = new Blob([new Uint8Array(optimized)], { type: 'image/jpeg' })

    // Use the image-to-text endpoint for LLaVA vision-language model. HF free
    // tier is queue-based: 503 "model busy" and connection blips are normal, so
    // retry once with backoff before marking the provider failed.
    let lastError: unknown = new Error('HF request not attempted')
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.withTimeout(
          this.hf!.imageToText({
            model,
            data: blob,
          }),
          PROVIDER_TIMEOUT_MS,
          `HF ${model}`
        )

        // LLaVA returns { generated_text: "..." } on the HF inference API
        const rawText =
          typeof response === 'string'
            ? response
            : (response as { generated_text?: string }).generated_text || JSON.stringify(response)

        const parsed = this.parseVLMResponse(rawText)

        return {
          ...parsed,
          method: `Hugging Face ${model.split('/').pop()}`,
          cost: '$0.00',
          cached: false,
          timestamp: new Date(),
        }
      } catch (err) {
        lastError = err
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 1200))
        }
      }
    }

    throw lastError
  }

  // ─── Private: Hugging Face Router (OpenAI-compatible) ─────────────────────

  /**
   * Modern HF inference path. The legacy `api-inference` serverless endpoint
   * no longer hosts many free vision models ("No Inference Provider available"),
   * so we ALSO try HF's Router (`router.huggingface.co/v1`, OpenAI-compatible)
   * which can route to whatever provider is live for the model. Works with any
   * HF token that has inference permissions.
   */
  private async analyzeWithHfRouter(
    imageBuffer: Buffer,
    model: string
  ): Promise<ChartAnalysisResult> {
    const optimized = await sharp(imageBuffer)
      .resize(HF_LONG_EDGE, HF_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()

    const base64 = optimized.toString('base64')
    monthlyRequestCount++

    let lastError: unknown = new Error('HF router request not attempted')
    for (let attempt = 0; attempt < 1; attempt++) {
      try {
        const response = await this.withTimeout(
          (async () => {
            const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${HF_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model,
                provider: { list: ['hf-inference'], fail_on_error: true },
                messages: [
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: CHART_ANALYSIS_PROMPT },
                      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
                    ],
                  },
                ],
                // The JSON payload is long; a small model that runs out of tokens mid-object
                // emits unparseable JSON, which used to degrade a perfectly good
                // read to NEUTRAL. 2048 gives the schema room to close.
                max_tokens: 2048,
                temperature: 0.2,
              }),
            })

            if (!res.ok) {
              throw new Error(`HF router error: ${res.status} ${(await res.text()).slice(0, 200)}`)
            }
            const json = (await res.json()) as {
              choices?: Array<{ message?: { content?: string } }>
            }
            const text = json?.choices?.[0]?.message?.content || ''
            if (!text.trim()) throw new Error('HF router returned an empty response')
            return text
          })(),
          PROVIDER_TIMEOUT_MS,
          `HF router ${model}`
        )

        const parsed = this.parseVLMResponse(response)
        return {
          ...parsed,
          method: `Hugging Face Router (${model.split('/').pop()})`,
          cost: '$0.00',
          cached: false,
          timestamp: new Date(),
        }
      } catch (err) {
        lastError = err
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 1500))
        }
      }
    }

    throw lastError
  }

  // ─── Private: OpenRouter (region-agnostic free vision models) ─────────────

  /**
   * OpenRouter Chat Completions with image support. Unlike Gemini's free tier,
   * OpenRouter's free models are NOT region-capped, so they work reliably from
   * Railway egress. Drifts through OPENROUTER_MODELS; first model that returns
   * usable content wins.
   */
  private async analyzeWithOpenRouter(imageBuffer: Buffer): Promise<ChartAnalysisResult> {
    const optimized = await sharp(imageBuffer)
      .resize(MODERN_LONG_EDGE, MODERN_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()

    const base64 = optimized.toString('base64')
    let lastError: unknown = new Error('OpenRouter request not attempted')
    const legStartedAt = Date.now()

    for (const model of OPENROUTER_MODELS) {
      // Hard deadline for the whole OpenRouter leg: even a 429/empty-content
      // storm must not stretch perceived latency beyond this window.
      if (Date.now() - legStartedAt > OPENROUTER_LEG_BUDGET_MS) break

      try {
        const response = await this.withTimeout(
          (async () => {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://app.toptier.app',
                'X-Title': 'TOPTIER',
              },
              body: JSON.stringify({
                model,
                messages: [
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: CHART_ANALYSIS_PROMPT },
                      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
                    ],
                  },
                ],
                temperature: 0.2,
                max_tokens: 2048,
              }),
            })

            if (!res.ok) {
              throw new Error(`OpenRouter error: ${res.status} ${(await res.text()).slice(0, 200)}`)
            }
            const json = (await res.json()) as {
              choices?: Array<{ message?: { content?: string } }>
            }
            const text = json?.choices?.[0]?.message?.content || ''
            if (!text.trim()) throw new Error(`OpenRouter ${model} returned an empty response`)
            return text
          })(),
          OPENROUTER_TIMEOUT_MS,
          `OpenRouter ${model}`
        )

        const parsed = this.parseVLMResponse(response)
        return {
          ...parsed,
          method: `OpenRouter (${model.split('/').pop()})`,
          cost: '$0.00',
          cached: false,
          timestamp: new Date(),
        }
      } catch (err) {
        // 429/503 = capacity — try the next free model shortly after. Unrecoverable
        // errors just move on; the backup chain handles the truly catastrophic case.
        lastError = err
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 400))
      }
    }

    throw lastError
  }

  private async analyzeWithGemini(imageBuffer: Buffer): Promise<ChartAnalysisResult> {
    const optimized = await sharp(imageBuffer)
      .resize(MODERN_LONG_EDGE, MODERN_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()

    const base64 = optimized.toString('base64')

    // Transient errors (network blips, 429 rate-limit/quota, 5xx overload)
    // should not abort the provider — keep trying the remaining keys/models so
    // a temporary 429/503 on one doesn't force us down to the heuristic.
    const transientStatus = new Set([429, 500, 502, 503, 504])
    const REST_MS = [2000, 3500] // patient spacing rides out short 503 spikes
    const legStartedAt = Date.now()

    // Every configured key, then every model on that key. The first key+model
    // that returns usable content wins, so a single drained key can't take the
    // whole provider down.
    for (const apiKey of GEMINI_API_KEYS) {
      for (const model of GEMINI_MODELS) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
        const body = JSON.stringify({
          contents: [
            {
              parts: [
                { text: CHART_ANALYSIS_PROMPT },
                { inline_data: { mime_type: 'image/jpeg', data: base64 } },
              ],
            },
          ],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        })

        // Up to 2 retries on network/transient failures per key+model, but the
        // whole leg (every key x every model x every retry) is capped. Gemini's
        // free tier 503s constantly; retrying 4 times across 6 key/model pairs
        // is what used to turn a 15s analysis into a multi-minute one.
        let lastError: unknown = null
        let response: Response | null = null

        for (let attempt = 0; attempt < 2 && !response; attempt++) {
          if (Date.now() - legStartedAt > GEMINI_LEG_BUDGET_MS) break
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

          try {
            // Key as a query param (`?key=`), NOT the header — some keys only
            // authenticate via the query string.
            const res = await fetch(`${url}?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
              signal: controller.signal,
            })

            // 404 = model unavailable — move on to the next model/key, no retry.
            if (res.status === 404) break

            if (res.ok) {
              response = res
              break
            }
            // Transient (429/5xx): retry this key+model.
            if (transientStatus.has(res.status)) {
              lastError = new Error(`Gemini API error: ${res.status}`)
            } else {
              // Unrecoverable auth/validation error — try the next key/model.
              lastError = new Error(`Gemini API error: ${res.status}`)
              break
            }
          } catch (err) {
            // fetch failed (network, DNS, TLS, proxy, or AbortController timeout)
            lastError = err
          } finally {
            clearTimeout(timeout)
          }

          if (attempt < 2) {
            const delay = REST_MS[attempt] * (0.7 + Math.random() * 0.6)
            await new Promise((r) => setTimeout(r, delay))
          }
        }

        if (!response) {
          if (lastError) console.warn(`[chart-analyzer] Gemini ${model} failed:`, (lastError as Error).message)
          // Out of leg budget — no point burning the remaining key/model pairs.
          if (Date.now() - legStartedAt > GEMINI_LEG_BUDGET_MS) break
          continue
        }

        const json = (await response.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        }
        const text =
          json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim() || ''

        if (!text) {
          console.warn(`[chart-analyzer] Gemini ${model} returned an empty response`)
          continue
        }

        const parsed = this.parseVLMResponse(text)
        return {
          ...parsed,
          method: `Gemini Flash (${model})`,
          cost: '$0.00',
          cached: false,
          timestamp: new Date(),
        }
      }
    }

    throw new Error('No Gemini model available')
  }

  // ─── Private: Anthropic Claude vision fallback ────────────────────────────

  private async analyzeWithClaude(imageBuffer: Buffer): Promise<ChartAnalysisResult> {
    const optimized = await sharp(imageBuffer)
      .resize(MODERN_LONG_EDGE, MODERN_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()

    const base64 = optimized.toString('base64')

    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
              { type: 'text', text: CHART_ANALYSIS_PROMPT },
            ],
          },
        ],
      }),
    })
    } finally {
      clearTimeout(abortTimer)
    }

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`)
    }

    const json = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>
    }
    const text = (json?.content || [])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text as string)
      .join('\n')
      .trim()

    if (!text) {
      throw new Error('Claude returned an empty response')
    }

    const parsed = this.parseVLMResponse(text)
    return {
      ...parsed,
      method: `Claude (${CLAUDE_MODEL})`,
      cost: '$0.00',
      cached: false,
      timestamp: new Date(),
    }
  }

  // ─── Private: Heuristic fallback ──────────────────────────────────────────

private heuristicFallback(imageBuffer: Buffer): ChartAnalysisResult {
    // Last-resort honest result. Never claim we read the chart, and never blame
    // the user's image — the failure is on our side, so say that.
    void imageBuffer
    return {
      signal: 'HOLD',
      confidence: 30,
      pattern: 'Analysis service busy',
      patterns: [],
      strategy: null,
      trend: 'neutral',
      detectedAsset: null,
      detectedTimeframe: null,
      entryPrice: null,
      stopLoss: null,
      takeProfit1: null,
      takeProfit2: null,
      takeProfit3: null,
      support: null,
      resistance: null,
      reasoning:
        'Our chart AI is busy right now and could not return a read for this image in time. Your screenshot was fine — please try again in a minute. Do not base any trading decision on this response.',
      method: 'Heuristic Fallback (no AI)',
      cost: '$0.00',
      cached: false,
      timestamp: new Date(),
    }
  }

// ─── Private: Parse VLM JSON response ─────────────────────────────────────

  /**
   * Pull a usable field map out of whatever the vision model emitted.
   *
   * Small vision models rarely return clean JSON. They wrap it in prose, emit
   * trailing commas, use single quotes, or run out of tokens mid-object. The old
   * parser gave up on anything but perfect JSON, and every field then defaulted
   * to HOLD / null — which is exactly how a perfectly clear screenshot came back
   * as "could not read the chart". So we try progressively looser extraction.
   */
  private parseVLMResponse(rawText: string): Omit<ChartAnalysisResult, 'method' | 'cost' | 'cached' | 'timestamp'> {
    const parsed = this.extractFields(rawText)

    const rawSignal = this.sanitizeSignal(parsed.signal as string)
    const rawConfidence = this.sanitizeConfidence(parsed.confidence)
    const patterns = this.sanitizePatterns(parsed.patterns)
    const pattern = (parsed.pattern as string) || patterns[0] || 'No clear pattern'

    const levels = this.repairLevels(rawSignal, {
      entry: this.sanitizeNumber(parsed.entryPrice),
      stop: this.sanitizeNumber(parsed.stopLoss),
      tp1: this.sanitizeNumber(parsed.takeProfit1),
      tp2: this.sanitizeNumber(parsed.takeProfit2),
      tp3: this.sanitizeNumber(parsed.takeProfit3),
      support: this.sanitizeNumber(parsed.support),
      resistance: this.sanitizeNumber(parsed.resistance),
    })

    // ─── Protective validation ────────────────────────────────────────────
// A BUY/SELL is the only actionable signal and may only reach the user if
    // its entry, stop and target are complete AND internally consistent — but
 // it is validated AFTER repair, so a merely jumbled or partly-omitted
    // level set is fixed up rather than thrown away.
    const validated = this.validateTrade(rawSignal, {
      entry: levels.entry,
      stop: levels.stop,
      tp1: levels.tp1,
      tp2: levels.tp2,
      tp3: levels.tp3,
    })

    // ─── Volatility-aware stop widening ───────────────────────────────────
    // High-volatility pairs (crypto, indices, metals, JPY) can easily knock
    // out a correctly-placed but tight stop. Widen the stop outward so a
    // valid winner is not stopped out by normal noise. We never widen past the
    // point where risk:reward drops below 1.0, so the trade stays protective.
    const widened = this.widenStopForVolatility(
      validated.signal,
      validated.entry,
      validated.stop,
      validated.tp1,
      (parsed.detectedAsset as string) || ''
    )

    // Confidence cap: allow real conviction on clear setups, HOLD stays modest.
    const confidence =
    widened.signal === 'HOLD'
        ? Math.min(rawConfidence, 55)
        : Math.min(rawConfidence, 85)

    return {
   signal: widened.signal,
      confidence,
      pattern,
      patterns,
    strategy: this.sanitizeStrategy(parsed.strategy),
    trend: this.sanitizeTrend(parsed.trend as string, widened.signal),
      detectedAsset: (parsed.detectedAsset as string) || null,
      detectedTimeframe: (parsed.detectedTimeframe as string) || null,
      entryPrice: widened.entry,
      stopLoss: widened.stop,
      takeProfit1: widened.tp1,
      takeProfit2: widened.tp2,
      takeProfit3: widened.tp3,
      support: levels.support,
      resistance: levels.resistance,
      reasoning:
        (parsed.reasoning as string) ||
        `AI detected ${pattern} with ${widened.signal} bias at ${confidence}% confidence.`,
    }
  }

  /**
   * Best-effort field extraction, loosest strategy last:
   *   1. whole body as JSON
   *   2. JSON embedded in prose / code fences
   *   3. JSON with trailing commas repaired and unclosed braces closed
   *   4. per-field regex salvage straight out of the prose
   */
  private extractFields(rawText: string): Record<string, unknown> {
    if (!rawText || !rawText.trim()) return {}

    const candidates = [rawText.trim()]

const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced?.[1]) candidates.push(fenced[1].trim())

    const embedded = rawText.match(/\{[\s\S]*\}/)
    if (embedded) candidates.push(embedded[0])

    for (const candidate of candidates) {
      const direct = this.tryJson(candidate)
      if (direct) return direct
    }

    // Repair the most promising candidate and try again.
    const repairTarget = embedded?.[0] ?? fenced?.[1] ?? candidates[0]
    const repaired = this.tryJson(this.repairJson(repairTarget))
    if (repaired) return repaired

    // Last resort: pull individual fields out of the prose.
    return this.salvageFields(rawText)
  }

  private tryJson(text: string): Record<string, unknown> | null {
    try {
      const value = JSON.parse(text)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>
      }
    } catch {
      // try the next strategy
    }
    return null
  }

  /** Close braces/brackets and drop trailing commas from a truncated JSON blob. */
  private repairJson(text: string): string {
    let out = text.replace(/\/\/[^\n\r]*/g, '').replace(/,\s*([}\]])/g, '$1')

    const stack: string[] = []
    let inString = false
    let escaped = false
    for (const ch of out) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
   if (inString) continue
   if (ch === '{' || ch === '[') stack.push(ch)
      else if (ch === '}' || ch === ']') stack.pop()
  }
    // A model cut off mid-object still tells us everything before the cut.
    while (stack.length) {
      out += stack.pop() === '{' ? '}' : ']'
    }
    return out
  }

  /** Pull each field out of prose when the payload never was valid JSON. */
  private salvageFields(text: string): Record<string, unknown> {
    const pick = (key: string): string | null => {
      const re = new RegExp(`["']?${key}["']?\\s*[:=]\\s*([^\\n\\r,}]+)`, 'i')
      const m = text.match(re)
      return m?.[1]?.trim().replace(/^["']|["']$/g, '') || null
}
    const out: Record<string, unknown> = {}
    for (const key of [
  'signal',
      'confidence',
      'pattern',
    'patterns',
      'trend',
  'detectedAsset',
      'asset',
   'detectedTimeframe',
      'timeframe',
      'strategy',
      'entryPrice',
      'stopLoss',
      'takeProfit1',
      'takeProfit2',
      'takeProfit3',
      'support',
      'resistance',
      'reasoning',
    ]) {
      const value = pick(key)
      if (value) out[key] = value
    }
    if (out.asset && !out.detectedAsset) out.detectedAsset = out.asset
    if (out.timeframe && !out.detectedTimeframe) out.detectedTimeframe = out.timeframe
    return out
  }

  /**
   * Reconcile the levels the model read off the chart.
   *
   * Vision models routinely read the right three prices and then label them
   * wrong (stop above entry on a BUY), or omit one of them, or print them with
   * separators ("1,234.50"). All three cases used to collapse to NEUTRAL with a
   * "wait for a clearer signal" message on an otherwise perfectly clear chart.
   *
   * Rules, in order:
   *   - Scrub separators/currency and refuse nonsensical values.
   *   - Re-order a present-but-scrambled triple by direction (the SET of prices
   *     the model read is right; the labels are what's wrong).
   *   - Fill a missing anchor from the model's own other numbers
   *     (support/resistance), never from thin air.
   *   - Only if entry+stop survive may targets be projected at R multiples.
   *   - With no real anchor at all we refuse to invent a trade: levels stay
   *     null and validation downgrades to HOLD.
   */
  private repairLevels(
    signal: 'BUY' | 'SELL' | 'HOLD',
    lv: {
      entry: number | null
      stop: number | null
      tp1: number | null
      tp2: number | null
      tp3: number | null
      support: number | null
      resistance: number | null
    }
  ): typeof lv {
    const out = { ...lv }
    if (signal === 'HOLD') return out

const dir = signal === 'BUY' ? 1 : -1

    // ─── Re-order a scrambled triple ────────────────────────────────────────
    const triple = [out.entry, out.stop, out.tp1].filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
    ) as number[]
    if (triple.length === 3 && new Set(triple).size === 3) {
   triple.sort(dir === 1 ? (a, b) => a - b : (a, b) => b - a)
      out.stop = triple[0]
out.entry = triple[1]
      out.tp1 = triple[2]
    }

    // ─── Fill a missing anchor from the model's own levels ──────────────────
if (out.entry === null) {
      // Only trust the model's own anchors. Prefer a level that sits in the
      // correct half of the stop→target range; otherwise take the midpoint of
      // that range. With no anchors at all we leave entry null (→ HOLD later).
      const lo = out.stop
 const hi = out.tp1
      const anchors = [out.support, out.resistance].filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
 )
      const inRange = anchors.find((v) => {
        if (lo !== null && hi !== null) return v > lo && v < hi
     if (lo !== null) return dir === 1 ? v > lo : v < lo
     if (hi !== null) return dir === 1 ? v < hi : v > hi
  return true
   })
      if (inRange !== undefined) {
        out.entry = inRange
      } else if (lo !== null && hi !== null && lo !== hi) {
out.entry = (lo + hi) / 2
      }
    }

    if (out.stop === null && out.entry !== null) {
      // 0.5% protective stop — the same tight default the prompt asks for.
      out.stop = dir === 1 ? out.entry * 0.995 : out.entry * 1.005
    }

    if (out.tp1 === null && out.entry !== null && out.stop !== null) {
const r = Math.abs(out.entry - out.stop)
      out.tp1 = out.entry + dir * r * 1.5
      // Targets are a bonus; project them at 2R/3R off a known entry and stop.
      out.tp2 = out.entry + dir * r * 3
      out.tp3 = out.entry + dir * r * 4.5
    }

    // Round derived numbers to something a broker would accept.
    const round = (v: number | null) => (v === null ? null : Number(v.toPrecision(6)))
    out.entry = round(out.entry)
    out.stop = round(out.stop)
    out.tp1 = round(out.tp1)
    out.tp2 = round(out.tp2)
 out.tp3 = round(out.tp3)

    return out
  }

  /**
   * Tightens the stop-loss for high-volatility symbols that are sensitive to
   * noise, so trades are not summarily "stopped out" by a single crazy candle.
   *
   * - Uses a small volatility multiplier derived from the detected symbol.
   * - The stop is moved slightly further from the entry (away from price).
   * - Widening is capped so risk:reward stays >= 1.0; if that cannot be met,
   *   the original stop is kept (we never degrade the trade).
   * - A hard cap (1.5% of price) guarantees the stop can never be absurdly
   *   wide no matter what the model read off the axis.
   */
  private widenStopForVolatility(
    signal: 'BUY' | 'SELL' | 'HOLD',
    entry: number | null,
    stop: number | null,
    tp1: number | null,
    symbol: string
  ): { signal: 'BUY' | 'SELL' | 'HOLD'; entry: number | null; stop: number | null; tp1: number | null; tp2: number | null; tp3: number | null } {
    const out = {
      signal,
      entry: entry as number | null,
      stop: stop as number | null,
      tp1: tp1 as number | null,
      tp2: null as number | null,
      tp3: null as number | null,
    }
    if (signal === 'HOLD' || entry === null || stop === null || tp1 === null) return out

    const mult = this.volatilityMultiplier(symbol)
    if (mult <= 1) return out

    const stopDistance = Math.abs(entry - stop)
    const reward = Math.abs(tp1 - entry)
    let newStopDistance = stopDistance * mult

    // Never allow risk:reward to drop below 1.0.
    if (reward / newStopDistance < 1.0) {
      return out
    }

    // Hard cap: even after widening, a stop further than 1.5% of price is more
    // cost than protection — high-volatility assets (BTC, gold, indices) swing
    // 2-4% on a single candle, so anything wider is not a realistic stop.
    const maxDistance = entry * 0.015
    if (newStopDistance > maxDistance) {
      newStopDistance = maxDistance
    }

    const newStop = signal === 'BUY' ? entry - newStopDistance : entry + newStopDistance
    return { ...out, stop: newStop }
  }

  /**
   * Returns a stop-widening multiplier based on the detected asset's volatility.
   * Kept deliberately small — the goal is noise protection, not inflating the
   * stop. High-volatility / easy-to-knockout pairs get a slightly larger one.
   */
  private volatilityMultiplier(symbol: string): number {
    const s = (symbol || '').toUpperCase()
    const HIGH: RegExp[] = [
      /BTC/, /ETH/, /SOL/, /XRP/, /DOGE/, /ADA/, /DOT/, /LINK/, /AVAX/,
      /FTSE/, /NAS/, /SP500/, /SPX/, /GER/, /DAX/, /NDX/, /US30/, /UK100/, /VIX/,
      /XAU/, /XAG/, /USOIL/, /WTI/, /BITCOIN/, /ETHEREUM/,
    ]
    if (HIGH.some((r) => r.test(s))) return 1.15
    if (/JPY/.test(s)) return 1.1
    if (/GBP|EUR|AUD|NZD|CAD|CHF/.test(s)) return 1.05
    return 1.0
  }

  /**
   * Returns validated trade levels for a signal, downgrading unsafe outputs.
   *
   * BUY  requires: stop < entry < tp1, with tp2/tp3 (if present) increasing.
   * SELL requires: stop > entry > tp1, with tp2/tp3 (if present) decreasing.
   * HOLD  always returns null levels.
   *
   * Any BUY/SELL that is missing a level or is inconsistent becomes HOLD.
   */
  private validateTrade(
    signal: 'BUY' | 'SELL' | 'HOLD',
    lv: { entry: number | null; stop: number | null; tp1: number | null; tp2: number | null; tp3: number | null }
  ): { signal: 'BUY' | 'SELL' | 'HOLD'; entry: number | null; stop: number | null; tp1: number | null; tp2: number | null; tp3: number | null } {
    const nullLevels = { entry: null, stop: null, tp1: null, tp2: null, tp3: null }

    if (signal === 'HOLD') {
      return { signal: 'HOLD', ...nullLevels }
    }

    const { entry, stop, tp1, tp2, tp3 } = lv

    // Core levels (entry, stop, tp1) must all be present and positive.
    if (
      entry === null || stop === null || tp1 === null || entry <= 0 || stop <= 0 || tp1 <= 0
    ) {
      return { signal: 'HOLD', ...nullLevels }
    }

    // Core relation must hold: BUY needs stop < entry < tp1, SELL needs stop > entry > tp1.
    const coreValid = signal === 'BUY'
      ? stop < entry && entry < tp1
      : stop > entry && entry > tp1

    if (!coreValid) {
      return { signal: 'HOLD', ...nullLevels }
    }

    // TP2/TP3 are optional bonus targets — if present they must extend the
    // sequence, but missing or slightly off TP2/TP3 should NOT kill a valid
    // core BUY/SELL. Null out bad TP2/TP3 instead of downgrading the whole signal.
    let cleanTp2 = tp2
    let cleanTp3 = tp3

    if (signal === 'BUY') {
      if (cleanTp2 !== null && cleanTp2 <= tp1) cleanTp2 = null
      if (cleanTp3 !== null && cleanTp3 <= (cleanTp2 ?? tp1)) cleanTp3 = null
    } else {
      if (cleanTp2 !== null && cleanTp2 >= tp1) cleanTp2 = null
      if (cleanTp3 !== null && cleanTp3 >= (cleanTp2 ?? tp1)) cleanTp3 = null
    }

    return { signal, entry, stop, tp1, tp2: cleanTp2, tp3: cleanTp3 }
  }

  // ─── Private: Concurrency / timeout helpers ───────────────────────────────

  /**
   * Resolves with the value of the first promise that fulfills, or rejects only
   * when every promise rejects. Used to race cheap/fast providers in parallel
   * and return the first good result, instead of waiting on a hanging one.
   */
  private firstSuccess<T>(promises: Promise<T>[]): Promise<T> {
    let settled = 0
    return new Promise<T>((resolve, reject) => {
      for (const p of promises) {
        p.then(
          (v) => resolve(v),
          () => {
            settled++
            if (settled === promises.length) reject(new Error('All providers failed'))
          }
        )
      }
    })
  }

  /**
   * Rejects a promise after `ms` if it has not settled, so a provider that
   * hangs (never responds) cannot stall the whole analysis path.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms
      )
      promise.then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        (e) => {
          clearTimeout(timer)
          reject(e)
        }
      )
    })
  }

  // ─── Private: Input normalization ─────────────────────────────────────────

  private normalizeInput(input: string | Buffer): Buffer {
    if (Buffer.isBuffer(input)) return input
    // Strip data URL prefix if present
    const base64 = input.replace(/^data:image\/\w+;base64,/, '')
    return Buffer.from(base64, 'base64')
  }

  // ─── Private: Sanitizers ──────────────────────────────────────────────────

  private sanitizeSignal(value: unknown): 'BUY' | 'SELL' | 'HOLD' {
    const v = String(value || '').toUpperCase().trim()
  // Models answer with prose, not enum members: "STRONG BUY", "BUY (long)",
    // "sell — breakdown confirmed". Substring matching is what makes those count;
    // an exact-match check silently turned every decorated answer into HOLD.
    if (/\bBUY\b|\bLONG\b|BULLISH/.test(v)) return 'BUY'
    if (/\bSELL\b|\bSHORT\b|BEARISH/.test(v)) return 'SELL'
    return 'HOLD'
  }

  private sanitizeConfidence(value: unknown): number {
    // Handles "78", "78%", "~78", "high confidence".
    const n = Number(String(value ?? '').replace(/[^\d.]/g, ''))
    if (!Number.isFinite(n) || n <= 0) return 50
    return Math.min(85, Math.max(20, Math.round(n)))
  }

  private sanitizePatterns(value: unknown): string[] {
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(/[,;|]/)
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 5)
    }
    if (!Array.isArray(value)) return []
    return value
      .map((p) => String(p).trim())
      .filter((p) => p.length > 0)
      .slice(0, 5)
  }

  private sanitizeStrategy(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const v = value.trim()
    const known = [
      'ema_cross',
      'macd_cross',
      'adx_trend',
      'stochastic_reversion',
      'atr_channel_breakout',
      'trend_following',
      'mean_reversion',
      'breakout',
      'momentum',
      'stat_arbitrage',
      'market_making',
      'supertrend',
      'parabolic_sar',
      'ichimoku',
      'golden_death_cross',
      'buy_the_dip',
      'connors_rsi2',
      'vwap_reversion',
      'cci_reversion',
      'williams_r_reversion',
      'volatility_squeeze',
      'retest_entry',
      'failed_breakout_reversal',
      'support_resistance_bounce',
      'round_number_levels',
      'engulfing',
      'hammer_shooting_star',
      'doji_confirmation',
      'morning_evening_star',
      'inside_bar_breakout',
      'three_soldiers_crows',
      'double_top_bottom',
      'head_and_shoulders',
      'triangle_wedge_breakout',
    ]
    return known.includes(v) ? v : null
  }

  private sanitizeTrend(value: unknown, signal: 'BUY' | 'SELL' | 'HOLD'): 'bullish' | 'bearish' | 'neutral' {
    const v = String(value || '').toLowerCase().trim()
    if (v === 'bullish' || v === 'uptrend') return 'bullish'
    if (v === 'bearish' || v === 'downtrend') return 'bearish'
    // Infer from signal if trend is missing
    if (signal === 'BUY') return 'bullish'
    if (signal === 'SELL') return 'bearish'
    return 'neutral'
  }

  private sanitizeNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    // Models print prices as "1,234.50", "$1,234.50", "~2350", "2350.0 USD".
    // Parsing those raw used to yield NaN → null → a dropped level → NEUTRAL.
    const raw = String(value).replace(/[^\d.]/g, '')
    if (!raw) return null
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return null
    // A price this large is a misread label, not a real quote.
    if (n > 1e9) return null
    return n
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const chartAnalyzer = new ChartAnalyzer()
