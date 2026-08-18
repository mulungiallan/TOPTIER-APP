import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

function startOfDay(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const range = request.nextUrl.searchParams.get('range') === '30d' ? 30 : 7
    const start = startOfDay(new Date())
    start.setDate(start.getDate() - (range - 1))

    const [sessions, botTrades, paperTrades] = await Promise.all([
      db.usageSession.findMany({
        where: { userId, startedAt: { gte: start } },
        select: { startedAt: true, durationSec: true },
      }),
      db.botTrade.findMany({
        where: { userId, result: { not: null }, closedAt: { gte: start } },
        select: { result: true, closedAt: true },
      }),
      db.paperTrade.findMany({
        where: { userId, status: 'closed', pnl: { not: null }, closedAt: { gte: start } },
        select: { pnl: true, closedAt: true },
      }),
    ])

    const dayMin = new Map<string, number>()
    const daySessions = new Map<string, number>()
    const dayWins = new Map<string, number>()
    const dayTotal = new Map<string, number>()

    for (const s of sessions) {
      const key = fmt(s.startedAt)
      dayMin.set(key, (dayMin.get(key) || 0) + s.durationSec / 60)
      daySessions.set(key, (daySessions.get(key) || 0) + 1)
    }

    for (const t of botTrades) {
      const key = fmt(t.closedAt as Date)
      dayTotal.set(key, (dayTotal.get(key) || 0) + 1)
      if (t.result === 'WIN') dayWins.set(key, (dayWins.get(key) || 0) + 1)
    }

    for (const t of paperTrades) {
      const key = fmt(t.closedAt as Date)
      dayTotal.set(key, (dayTotal.get(key) || 0) + 1)
      if ((t.pnl as number) > 0) dayWins.set(key, (dayWins.get(key) || 0) + 1)
    }

    const series: Array<{ date: string; minutes: number; sessions: number; trades: number; winRate: number | null }> = []
    const cursor = new Date(start)
    for (let i = 0; i < range; i++) {
      const key = fmt(cursor)
      const total = dayTotal.get(key) || 0
      series.push({
        date: key,
        minutes: Math.round((dayMin.get(key) || 0) * 10) / 10,
        sessions: daySessions.get(key) || 0,
        trades: total,
        winRate: total ? Math.round(((dayWins.get(key) || 0) / total) * 100) : null,
      })
      cursor.setDate(cursor.getDate() + 1)
    }

    return successResponse({ range, series })
  } catch (error) {
    console.error('Tracking timeseries error:', error)
    return errorResponse('Failed to load tracking timeseries', 500)
  }
}
