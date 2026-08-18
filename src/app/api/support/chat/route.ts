import { NextRequest } from 'next/server'
import { getUserIdFromRequest, errorResponse, successResponse } from '@/lib/auth'
import { db } from '@/lib/db'

// POST /api/support/chat
// AI support assistant backed by Anthropic Claude (uses the already-configured
// ANTHROPIC_API_KEY). Falls back to a 503 so the client can degrade to its
// local keyword-based replies when the key is absent or the provider errors.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 500
const MAX_MESSAGES = 20
const MAX_CONTENT_LENGTH = 2000

// Per-user rate limit: one message per 2.5s (in-memory, single-process).
const lastMessageAt = new Map<string, number>()
const RATE_LIMIT_MS = 2500

const SYSTEM_PROMPT = `You are the TOPTIER support assistant, a customer-support chatbot for the TOPTIER trading application (powered by BAGMUL). Be concise, warm and helpful.

What TOPTIER offers (answer questions about these only, never invent features):
- Trading signals (forex, crypto, indices, commodities, stocks) with entry, stop loss, take profit, confidence and risk/reward.
- Screenshot / chart AI analysis (upload a chart, get support/resistance, patterns, trend and a suggested setup). Free tier: limited daily analyses; Premium: unlimited.
- Watchlist with live prices, price alerts and custom indicator alerts.
- Economic calendar, news feed with sentiment, performance analytics, paper trading, backtesting, AI price predictions, pattern recognition, strategy builder, copy trading, social feed, leaderboards, competitions, direct messages and groups, TradingView charts.
- Pricing plans: Free, Premium Monthly, Premium Annual, Lifetime (payment methods: Stripe, PayPal, Paystack, Flutterwave, M-Pesa, RevenueCat — availability depends on the user's region/config).
- Account: password reset (Settings → Security → change password), 2FA (Settings → Security), biometric sign-in (WebAuthn), max 2 concurrent logins, privacy controls, data export/delete.
- The floating support widget + Support Center create support tickets answered within 24h (Free) / 4h (Premium).

Ground rules:
- Do NOT fabricate prices, guarantees, or specific financial advice. Trading involves risk.
- If asked something outside TOPTIER, politely redirect to support@toptier.app.
- Keep answers under ~120 words unless the user needs step-by-step instructions.
- If the user seems frustrated, acknowledge and offer a support ticket.`

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const messages: unknown = body?.messages

    if (!Array.isArray(messages) || messages.length === 0) {
      return errorResponse('messages array is required', 400)
    }

    const last = messages[messages.length - 1] as Record<string, unknown> | undefined
    if (!last || last.role !== 'user' || typeof last.content !== 'string' || !last.content.trim()) {
      return errorResponse('Last message must be from the user with text content', 400)
    }

    const history = messages.slice(-MAX_MESSAGES).map((m) => ({
      role: (m as Record<string, unknown>).role === 'assistant' ? 'assistant' : 'user',
      content: String((m as Record<string, unknown>).content || '').slice(0, MAX_CONTENT_LENGTH),
    }))

    // Rate limit
    const now = Date.now()
    const lastAt = lastMessageAt.get(userId) || 0
    if (now - lastAt < RATE_LIMIT_MS) {
      return errorResponse('Please wait a moment before sending another message.', 429)
    }
    lastMessageAt.set(userId, now)

    // Persist a lightweight support activity record
    await db.activityLog.create({
      data: {
        userId,
        action: 'support_chat',
        details: `Asked: ${String(last.content).slice(0, 120)}`,
      },
    }).catch(() => { /* non-critical logging failure; continue with chat */ })

    if (!ANTHROPIC_API_KEY) {
      return errorResponse('AI assistant is not configured on this server.', 503)
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.4,
        system: SYSTEM_PROMPT,
        messages: history,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error('Support chat provider error:', response.status, text.slice(0, 200))
      return errorResponse('The AI assistant is temporarily unavailable.', 502)
    }

    const json = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>
    }
    const reply = (json?.content || [])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text as string)
      .join('\n')
      .trim()

    if (!reply) {
      return errorResponse('The AI assistant returned an empty response.', 502)
    }

    return successResponse({ reply })
  } catch (error) {
    console.error('Support chat error:', error)
    return errorResponse('Failed to reach the AI assistant.', 500)
  }
}
