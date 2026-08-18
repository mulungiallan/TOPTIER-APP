import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

// GET /api/profile — real activity, achievements, and trading stats for the profile page
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const [activityLogs, badges, closedSignals, signalsTracked, user] = await Promise.all([
      db.activityLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      db.userBadge.findMany({
        where: { userId },
        orderBy: { earnedAt: 'desc' },
      }),
      db.signal.findMany({
        where: {
          userId,
          status: { in: ['hit_tp', 'hit_sl', 'expired'] },
          resultPrice: { not: null },
        },
        select: {
          id: true,
          type: true,
          status: true,
          entryPrice: true,
          resultPrice: true,
        },
      }),
      db.signal.count({ where: { userId } }),
      db.user.findUnique({
        where: { id: userId },
        select: { createdAt: true },
      }),
    ])

    const total = closedSignals.length
    const wins = closedSignals.filter((s) => s.status === 'hit_tp').length
    const winRate = total ? Math.round((wins / total) * 100) : 0

    let totalReturn = 0
    for (const s of closedSignals) {
      if (!s.resultPrice) continue
      const diff = (s.resultPrice - s.entryPrice) / s.entryPrice * 100
      const signed = s.status === 'hit_tp' ? Math.abs(diff) : -Math.abs(diff)
      totalReturn += signed
    }
    const avgReturn = total ? Math.round((totalReturn / total) * 100) / 100 : 0

    return successResponse({
      recentActivity: activityLogs.map((a) => ({
        id: a.id,
        action: a.action,
        detail: a.details,
        time: a.createdAt,
      })),
      achievements: badges.map((b) => ({
        id: b.id,
        badgeType: b.badgeType,
        badgeName: b.badgeName,
        earnedAt: b.earnedAt,
      })),
      stats: {
        signalsTracked,
        winRate,
        trades: total,
        avgReturn,
      },
      memberSince: user?.createdAt ?? null,
    })
  } catch (error) {
    console.error('Profile GET error:', error)
    return errorResponse('Failed to load profile data', 500)
  }
}
