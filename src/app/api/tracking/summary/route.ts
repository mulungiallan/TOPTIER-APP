import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

function startOfDay(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const now = new Date()
    const todayStart = startOfDay(now)
    const weekStart = new Date(todayStart)
    weekStart.setDate(weekStart.getDate() - 6)
    const monthStart = new Date(todayStart)
    monthStart.setDate(monthStart.getDate() - 29)

    const [sessions, sessionsToday, sessionsWeek, events, botTrades, paperTrades, user] = await Promise.all([
      db.usageSession.findMany({
        where: { userId },
        select: { startedAt: true, durationSec: true },
      }),
      db.usageSession.findMany({
        where: { userId, startedAt: { gte: todayStart } },
        select: { durationSec: true },
      }),
      db.usageSession.findMany({
        where: { userId, startedAt: { gte: weekStart } },
        select: { startedAt: true },
      }),
      db.usageEvent.findMany({
        where: { userId, createdAt: { gte: monthStart } },
        select: { feature: true, createdAt: true },
      }),
      db.botTrade.findMany({
        where: { userId, result: { not: null }, closedAt: { not: null } },
        select: { result: true, closedAt: true },
      }),
      db.paperTrade.findMany({
        where: { userId, status: 'closed', pnl: { not: null } },
        select: { pnl: true, closedAt: true },
      }),
      db.user.findUnique({
        where: { id: userId },
        select: { analyticsOptOut: true },
      }),
    ])

    const sum = (list: { durationSec: number }[]) => list.reduce((acc, s) => acc + s.durationSec, 0)

    const todayMinutes = Math.round(sum(sessionsToday) / 60)
    const allTimeMinutes = Math.round(sum(sessions) / 60)
    const weekMinutes = Math.round(
      sessions
        .filter((s) => s.startedAt >= weekStart)
        .reduce((acc, s) => acc + s.durationSec, 0) / 60
    )

    const activeDays = new Set(sessions.map((s) => s.startedAt.toISOString().slice(0, 10)))
    let streak = 0
    const cursor = new Date(todayStart)
    for (let i = 0; i < 365; i++) {
      if (activeDays.has(cursor.toISOString().slice(0, 10))) {
        streak++
      } else if (i > 0) {
        break
      }
      cursor.setDate(cursor.getDate() - 1)
    }

    const featureCounts: Record<string, number> = {}
    for (const e of events) {
      featureCounts[e.feature] = (featureCounts[e.feature] || 0) + 1
    }
    const topFeatures = Object.entries(featureCounts)
      .map(([feature, count]) => ({ feature, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    const countWins = (list: string[]) => list.filter((r) => r === 'WIN').length
    const botResults = botTrades.map((t) => t.result as string)
    const botWins = countWins(botResults)
    const paperWins = paperTrades.filter((t) => t.pnl !== null && t.pnl > 0).length
    const total = botResults.length + paperTrades.length
    const wins = botWins + paperWins

    return successResponse({
      optedOut: user?.analyticsOptOut ?? false,
      usage: {
        todayMinutes,
        todaySessions: sessionsToday.length,
        weekMinutes,
        weekSessions: sessionsWeek.length,
        allTimeMinutes,
        totalSessions: sessions.length,
        avgSessionMinutes: sessions.length ? Math.round(allTimeMinutes / sessions.length) : 0,
        streakDays: streak,
      },
      winRate: {
        botTrades: botResults.length,
        botWinRate: botResults.length ? Math.round((botWins / botResults.length) * 100) : 0,
        paperTrades: paperTrades.length,
        paperWinRate: paperTrades.length ? Math.round((paperWins / paperTrades.length) * 100) : 0,
        total,
        overallWinRate: total ? Math.round((wins / total) * 100) : 0,
      },
      topFeatures,
    })
  } catch (error) {
    console.error('Tracking summary error:', error)
    return errorResponse('Failed to load tracking summary', 500)
  }
}
