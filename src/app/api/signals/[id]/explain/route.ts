import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

/**
 * GET /api/signals/[id]/explain
 * AI analyst (ported from files-5 ai_analyst.py + chat_cli.py): takes a
 * structured, already-computed signal from the DB and asks Claude for a short
 * plain-English trade breakdown grounded ONLY in the real stored numbers —
 * entry, stop, targets, risk:reward, confidence, engine (confluence or AMD
 * sniper) and the AMD phase. Claude never invents price levels or overrides
 * the computed ones.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const { id } = await params
    const signal = await db.signal.findUnique({ where: { id } })
    if (!signal) {
      return errorResponse('Signal not found', 404)
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return errorResponse('AI analyst is not configured (ANTHROPIC_API_KEY missing)', 503)
    }

    const amdLabel = signal.amdPhase
      ? signal.strategyType === 'amd_sniper'
        ? `AMD ${signal.amdPhase === 'accumulation' ? 'Accumulation' : signal.amdPhase === 'distribution' ? 'Distribution' : 'Manipulation-only'}`
        : undefined
      : undefined

    const context = {
      symbol: signal.asset,
      style: signal.style,
      strategyType: signal.strategyType,
      amdPhase: amdLabel,
      direction: signal.type,
      entry: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit1: signal.takeProfit1,
      takeProfit2: signal.takeProfit2,
      takeProfit3: signal.takeProfit3,
      riskRewardRatio: signal.riskRewardRatio,
      confidenceScore: signal.confidence,
      timeframe: signal.timeframe,
      marketType: signal.marketType,
      inMacroWindow: signal.inMacroWindow,
      macroWindowName: signal.macroWindowName,
      reason: signal.reason,
    }

    const systemPrompt =
      'You are a trading desk analyst embedded in a signal-generation app. ' +
      'You are given a structured, already-computed trade signal (entry, stop, target, ' +
      'risk:reward, confidence score, and which engine produced it — confluence ' +
      'trend/momentum/breakout, or an AMD accumulation-manipulation-distribution sniper ' +
      'entry). You do NOT invent new price levels or override the numbers given to you.\n' +
      'Your job: 1) Explain in plain English WHY this setup triggered, referencing the ' +
      'specific numbers and phase you were given. 2) If a macro time window is present ' +
      '(inMacroWindow true with a macroWindowName like london_macro_1 or ny_am_macro_1), ' +
      'weigh in briefly on whether the setup fired at a convention high-volatility ' +
      'session window. 3) State clearly what would invalidate ' +
      'the trade (the stop, or a specific condition). 4) Be honest about confidence — do ' +
      'not oversell; never claim a signal is guaranteed to work. 5) Keep it tight: a trader ' +
      'is reading this in seconds before a live decision. 6) Never give personalized ' +
      'financial advice framed as certainty. Frame everything as "the system flagged X ' +
      'because Y" — the trader makes the final call.'

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
          max_tokens: 500,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: `Here is a signal my system just generated:\n\n${JSON.stringify(context, null, 2)}\n\nExplain this setup to a trader in 3-5 sentences.`,
            },
          ],
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`)
      }

      const json = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>
      }
      const explanation = ((json?.content || []).find((b) => b.type === 'text')?.text || '').trim()
      if (!explanation) {
        throw new Error('Claude returned no explanation')
      }

      return successResponse({ explanation })
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    console.error('Signal explain error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (message.includes('429')) {
      return errorResponse('AI analyst rate limit reached, try again shortly', 429)
    }
    if (message.includes('ANTHROPIC_API_KEY') || message.includes('not configured')) {
      return errorResponse(message, 503)
    }
    return errorResponse('AI analysis failed. Please try again.', 500)
  }
}