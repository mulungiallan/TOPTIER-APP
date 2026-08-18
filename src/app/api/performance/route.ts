import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const { searchParams } = new URL(request.url)
    const market = searchParams.get('market')
    const strategy = searchParams.get('strategy')
    const period = searchParams.get('period') || 'all' // week, month, quarter, all

    // Build date filter based on period
    const now = new Date()
    let startDate: Date | null = null
    if (period === 'week') startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    if (period === 'month') startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    if (period === 'quarter') startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    const where: Record<string, unknown> = {
      status: { in: ['hit_tp', 'hit_sl', 'expired'] },
    }

    if (market) where.marketType = market
    if (strategy) where.strategy = strategy
    if (startDate) where.resolvedAt = { gte: startDate }

    // Performance is per-user: only count signals the user accepted or acted on.
    const acceptedSignals = await db.signal.findMany({
      where: {
        userId,
        status: { in: ['hit_tp', 'hit_sl', 'expired'] },
      },
      select: { id: true },
    })
    const acceptedIds = acceptedSignals.map(s => s.id)

    if (acceptedIds.length === 0) {
      return successResponse({
        overview: {
          totalSignals: 0,
          wins: 0,
          losses: 0,
          expired: 0,
          winRate: 0,
          lossRate: 0,
          avgConfidence: 0,
          avgRiskReward: 0,
        },
        marketBreakdown: {},
        strategyBreakdown: {},
        period,
      })
    }

    where.id = { in: acceptedIds }

    // Get resolved signals for performance analysis
    const resolvedSignals = await db.signal.findMany({
      where,
      select: {
        id: true,
        type: true,
        asset: true,
        marketType: true,
        strategy: true,
        status: true,
        resultType: true,
        confidence: true,
        riskRewardRatio: true,
        createdAt: true,
        resolvedAt: true,
      },
    })

    // Calculate overall stats
    const totalSignals = resolvedSignals.length
    const wins = resolvedSignals.filter(s => s.status === 'hit_tp').length
    const losses = resolvedSignals.filter(s => s.status === 'hit_sl').length
    const expired = resolvedSignals.filter(s => s.status === 'expired').length
    const winRate = totalSignals > 0 ? Math.round((wins / totalSignals) * 100) : 0
    const lossRate = totalSignals > 0 ? Math.round((losses / totalSignals) * 100) : 0

    // Per-market breakdown
    const marketBreakdown: Record<string, { total: number; wins: number; losses: number; winRate: number }> = {}
    for (const signal of resolvedSignals) {
      const mk = signal.marketType
      if (!marketBreakdown[mk]) {
        marketBreakdown[mk] = { total: 0, wins: 0, losses: 0, winRate: 0 }
      }
      marketBreakdown[mk].total++
      if (signal.status === 'hit_tp') marketBreakdown[mk].wins++
      if (signal.status === 'hit_sl') marketBreakdown[mk].losses++
    }
    for (const mk of Object.keys(marketBreakdown)) {
      const mb = marketBreakdown[mk]
      mb.winRate = mb.total > 0 ? Math.round((mb.wins / mb.total) * 100) : 0
    }

    // Per-strategy breakdown
    const strategyBreakdown: Record<string, { total: number; wins: number; losses: number; winRate: number }> = {}
    for (const signal of resolvedSignals) {
      const st = signal.strategy
      if (!strategyBreakdown[st]) {
        strategyBreakdown[st] = { total: 0, wins: 0, losses: 0, winRate: 0 }
      }
      strategyBreakdown[st].total++
      if (signal.status === 'hit_tp') strategyBreakdown[st].wins++
      if (signal.status === 'hit_sl') strategyBreakdown[st].losses++
    }
    for (const st of Object.keys(strategyBreakdown)) {
      const sb = strategyBreakdown[st]
      sb.winRate = sb.total > 0 ? Math.round((sb.wins / sb.total) * 100) : 0
    }

    // Average confidence
    const avgConfidence = totalSignals > 0
      ? Math.round(resolvedSignals.reduce((sum, s) => sum + s.confidence, 0) / totalSignals)
      : 0

    // Average risk/reward
    const avgRiskReward = totalSignals > 0
      ? Number((resolvedSignals.reduce((sum, s) => sum + s.riskRewardRatio, 0) / totalSignals).toFixed(2))
      : 0

    return successResponse({
      overview: {
        totalSignals,
        wins,
        losses,
        expired,
        winRate,
        lossRate,
        avgConfidence,
        avgRiskReward,
      },
      marketBreakdown,
      strategyBreakdown,
      period,
    })
  } catch (error) {
    console.error('Performance GET error:', error)
    return successResponse({
      overview: {
        totalSignals: 0,
        wins: 0,
        losses: 0,
        expired: 0,
        winRate: 0,
        lossRate: 0,
        avgConfidence: 0,
        avgRiskReward: 0,
      },
      marketBreakdown: {},
      strategyBreakdown: {},
      period: 'all',
    })
  }
}
