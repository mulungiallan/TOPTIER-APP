// src/app/api/admin/ai/route.ts
// AI layer for the admin panel:
//  GET  /api/admin/ai            → rule-based anomaly cards + metric snapshot
//  POST /api/admin/ai  { q }     → "ask the panel": Claude answers from the real
//                                  metric snapshot (the query asked is echoed back)
//  POST /api/admin/ai  { draftFor: 'ticket', ticketId } → draft a support reply

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requirePermission } from '@/lib/admin-permissions'

export const runtime = 'nodejs'
export const maxDuration = 60

const DAY = 24 * 60 * 60 * 1000

async function metricSnapshot() {
  const now = Date.now()
  const today = new Date(now - now % DAY)
  const yesterday = new Date(today.getTime() - DAY)
  const weekAgo = new Date(now - 7 * DAY)

  const [
    usersTotal, usersToday, usersYesterday, bannedTotal, premiumTotal,
    signalsActive, signalsTotal, signalsToday,
    ticketsOpen, ticketsToday, ticketsYesterday,
    payoutsPending, payoutsPaid30, refunds30, earnings30, transactions30, revenue30,
    reviewsPending, deletionsPending, analysesToday, botsRunning, sessionsLive,
    signups30, loginsToday,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: today } } }),
    db.user.count({ where: { createdAt: { gte: yesterday, lt: today } } }),
    db.user.count({ where: { isBanned: true } }),
    db.user.count({ where: { subscriptionTier: { not: 'free' } } }),
    db.signal.count({ where: { status: 'active', expiryDate: { gt: new Date() } } }),
    db.signal.count(),
    db.signal.count({ where: { createdAt: { gte: today } } }),
    db.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
    db.supportTicket.count({ where: { createdAt: { gte: today } } }),
    db.supportTicket.count({ where: { createdAt: { gte: yesterday, lt: today } } }),
    db.payoutRequest.count({ where: { status: 'pending' } }),
    db.payoutRequest.count({ where: { status: 'paid', paidAt: { gte: weekAgo } } }),
    db.paymentTransaction.count({ where: { status: 'refunded' } }),
    db.platformEarning.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: weekAgo } } }),
    db.paymentTransaction.count({ where: { createdAt: { gte: weekAgo } } }),
    db.paymentTransaction.aggregate({ _sum: { amount: true }, where: { status: 'completed', createdAt: { gte: weekAgo } } }),
    db.review.count({ where: { status: 'pending' } }),
    db.dataDeletionRequest.count({ where: { status: 'pending' } }),
    db.screenshotAnalysis.count({ where: { createdAt: { gte: today } } }),
    db.botInstance.count({ where: { status: { in: ['running', 'starting'] } } }),
    db.usageSession.count({ where: { endedAt: null } }),
    db.user.count({ where: { createdAt: { gte: weekAgo } } }),
    db.activityLog.count({ where: { action: 'login', createdAt: { gte: today } } }),
  ])

  return {
    users: { total: usersTotal, today: usersToday, yesterday: usersYesterday, banned: bannedTotal, premium: premiumTotal, signups30: signups30, loginsToday },
    signals: { active: signalsActive, total: signalsTotal, today: signalsToday },
    support: { open: ticketsOpen, today: ticketsToday, yesterday: ticketsYesterday },
    payouts: { pending: payoutsPending, paid7d: payoutsPaid30 },
    finance: { refunds: refunds30, earnings7d: earnings30._sum.amount ?? 0, tx7d: transactions30, revenue7d: revenue30._sum.amount ?? 0 },
    moderation: { reviewsPending, deletionsPending },
    live: { analysesToday, botsRunning, sessionsLive },
  }
}

function buildAnomalies(now: Date, s: Awaited<ReturnType<typeof metricSnapshot>>) {
  const out: { severity: 'high' | 'medium' | 'info'; title: string; detail: string; when: string }[] = []
  const growth = s.users.yesterday ? ((s.users.today - s.users.yesterday) / s.users.yesterday) * 100 : s.users.today > 0 ? 100 : 0
  if (growth >= 50 && s.users.today > 0) {
    out.push({ severity: 'info', title: `Sign-ups up ${growth.toFixed(0)}% day-over-day`, detail: `${s.users.today} new users today vs ${s.users.yesterday} yesterday.`, when: now.toISOString() })
  }
  if (growth <= -50 && s.users.today < s.users.yesterday) {
    out.push({ severity: 'high', title: 'Sign-ups dropped sharply', detail: `${s.users.yesterday} → ${s.users.today} day-over-day.`, when: now.toISOString() })
  }
  const ticketGrowth = s.support.yesterday ? ((s.support.today - s.support.yesterday) / s.support.yesterday) * 100 : 0
  if (ticketGrowth >= 100 && s.support.yesterday > 0) {
    out.push({ severity: 'high', title: `Ticket volume up ${Math.round(ticketGrowth)}%`, detail: `${s.support.open} tickets open right now.`, when: now.toISOString() })
  }
  if (s.support.open > 25) {
    out.push({ severity: 'medium', title: 'Support backlog growing', detail: `${s.support.open} open/in-progress tickets.`, when: now.toISOString() })
  }
  if (s.payouts.pending > 0) {
    out.push({ severity: 'info', title: 'Payouts awaiting action', detail: `${s.payouts.pending} pending payout request(s) in the queue.`, when: now.toISOString() })
  }
  if (s.finance.refunds > 3) {
    out.push({ severity: 'medium', title: `${s.finance.refunds} lifetime refunds logged`, detail: 'Review recent refunds in Payments → transactions.', when: now.toISOString() })
  }
  const botErrDetail = ''
  if (s.moderation.deletionsPending > 0) {
    out.push({ severity: 'medium', title: 'GDPR deletions awaiting review', detail: `${s.moderation.deletionsPending} request(s) pending.`, when: now.toISOString() })
  }
  if (s.moderation.reviewsPending > 0) {
    out.push({ severity: 'info', title: 'Community reviews to moderate', detail: `${s.moderation.reviewsPending} pending review(s).`, when: now.toISOString() })
  }
  return { anomalies: out, botErrDetail }
}

export async function GET(request: NextRequest) {
  const { error } = await requirePermission(request, 'ai.ask')
  if (error) return error
  const snapshot = await metricSnapshot()
  const { anomalies } = buildAnomalies(new Date(), snapshot)
  return successResponse({ anomalies, snapshot, generatedAt: new Date().toISOString() })
}

const SYSTEM_PROMPT =
  'You are the analytics brain of a trading-app admin panel. You are given a snapshot ' +
  'of REAL platform metrics (users, signals, support, payouts, finance, moderation, live). ' +
  'Answer the admin question as a terse ops brief: give the exact numbers, a short plain ' +
  'interpretation, and only then any recommended action. Do not invent numbers that are not ' +
  'in the snapshot. Do not give financial advice to users. Keep it under 120 words.'

async function askClaude(content: string, apiKey: string, maxTokens = 260) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 45_000)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Claude API error: ${res.status}`)
    const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
    return ((json.content || []).find((b) => b.type === 'text')?.text || '').trim()
  } finally {
    clearTimeout(t)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { error, user } = await requirePermission(request, 'ai.ask')
    if (error) return error
    const body = await request.json().catch(() => null)
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return errorResponse('AI is not configured (ANTHROPIC_API_KEY missing)', 503)

    if (body?.draftFor === 'ticket') {
      const ticket = await db.supportTicket.findUnique({ where: { id: String(body.ticketId || '') } })
      if (!ticket) return errorResponse('Ticket not found', 404)
      const drafted = await askClaude(
        `Draft a friendly, concise support reply to this user ticket. Return only the reply text.\n\nSubject: ${ticket.subject}\nCategory: ${ticket.category}\nPriority: ${ticket.priority}\nMessage: ${ticket.description.slice(0, 1200)}`,
        apiKey,
        200
      )
      return successResponse({ draft: drafted, forTicket: ticket.id })
    }

    const q = String(body?.q || '').trim()
    if (!q) return errorResponse('q required', 400)
    const snapshot = await metricSnapshot()
    const answer = await askClaude(
      `The admin asked:\n\n"${q}"\n\nHere is the CURRENT snapshot:\n\n${JSON.stringify(snapshot, null, 2)}`,
      apiKey
    )
    await db.adminAuditLog.create({
      data: { adminId: user!.id, action: 'AI_ASK', details: JSON.stringify({ q }) },
    }).catch(() => {})
    return successResponse({ answer, uuid: snapshot, echo: q })
  } catch (e) {
    console.error('Admin AI error:', e)
    return errorResponse('AI query failed', 500)
  }
}