import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return successResponse({
        overview: {
          totalSignals: 0, wins: 0, losses: 0, expired: 0, winRate: 0,
          lossRate: 0, breakevenRate: 0, avgConfidence: 0, avgRiskReward: 0,
          monthlySignals: 0, consecutiveWins: 0, longestWinStreak: 0,
          consecutiveLosses: 0, longestLossStreak: 0, avgOutcome: 0,
          acceptedCount: 0, ignoredCount: 0,
        },
        marketBreakdown: {}, strategyBreakdown: {}, assetBreakdown: {},
        timeframeBreakdown: {}, sessionBreakdown: {},
        monthlyPerformance: [], winRateTrend: [], marketPerformance: [],
        period: 'all',
      })
    }

    const { searchParams } = new URL(request.url)
    const market = searchParams.get('market')
    const strategy = searchParams.get('strategy')
    const period = searchParams.get('period') || 'all'

    const now = new Date()
    let startDate: Date | null = null
    if (period === 'week') startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    if (period === 'month') startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    if (period === 'quarter') startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    // Fetch all signals for this user (accepted or not) + resolved signals
    const [acceptedSignals, allUserSignals] = await Promise.all([
      db.signal.findMany({
        where: { userId, status: { in: ['hit_tp', 'hit_sl', 'expired'] } },
        select: { id: true },
      }),
      db.signal.findMany({
        where: { userId, createdAt: { gte: startDate || new Date(0) } },
        select: { id: true },
      }),
    ])

    const acceptedIds = acceptedSignals.map(s => s.id)

    if (acceptedIds.length === 0) {
      return successResponse({
        overview: {
          totalSignals: 0, wins: 0, losses: 0, expired: 0, winRate: 0,
          lossRate: 0, breakevenRate: 0, avgConfidence: 0, avgRiskReward: 0,
          monthlySignals: allUserSignals.length,
          consecutiveWins: 0, longestWinStreak: 0,
          consecutiveLosses: 0, longestLossStreak: 0,
          avgOutcome: 0, acceptedCount: 0, ignoredCount: 0,
        },
        marketBreakdown: {}, strategyBreakdown: {}, assetBreakdown: {},
        timeframeBreakdown: {}, sessionBreakdown: {},
        monthlyPerformance: [], winRateTrend: [], marketPerformance: [],
        period,
      })
    }

    const where: Record<string, unknown> = {
      id: { in: acceptedIds },
      status: { in: ['hit_tp', 'hit_sl', 'expired'] },
    }

    if (market) where.marketType = market
    if (strategy) where.strategy = strategy
    if (startDate) where.resolvedAt = { gte: startDate }

    const resolvedSignals = await db.signal.findMany({
      where,
      select: {
        id: true, type: true, asset: true, marketType: true, strategy: true,
        status: true, resultType: true, confidence: true,
        riskRewardRatio: true, createdAt: true, resolvedAt: true,
        timeframe: true, session: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const totalSignals = resolvedSignals.length
    const wins = resolvedSignals.filter(s => s.status === 'hit_tp').length
    const losses = resolvedSignals.filter(s => s.status === 'hit_sl').length
    const expired = resolvedSignals.filter(s => s.status === 'expired').length
    const winRate = totalSignals > 0 ? Math.round((wins / totalSignals) * 100) : 0
    const lossRate = totalSignals > 0 ? Math.round((losses / totalSignals) * 100) : 0
    const breakevenRate = totalSignals > 0 ? Math.round((expired / totalSignals) * 100) : 0

    const avgConfidence = totalSignals > 0
      ? Math.round(resolvedSignals.reduce((sum, s) => sum + s.confidence, 0) / totalSignals)
      : 0

    const avgRiskReward = totalSignals > 0
      ? Number((resolvedSignals.reduce((sum, s) => sum + s.riskRewardRatio, 0) / totalSignals).toFixed(2))
      : 0

    // Monthly signals count (for current period)
    const monthlySignals = resolvedSignals.length

    // Consecutive wins/losses (most recent streak)
    let consecutiveWins = 0, longestWinStreak = 0
    let consecutiveLosses = 0, longestLossStreak = 0
    let currentWinStreak = 0, currentLossStreak = 0

    for (let i = resolvedSignals.length - 1; i >= 0; i--) {
      const s = resolvedSignals[i]
      if (i === resolvedSignals.length - 1) {
        // Start counting from the most recent
        if (s.status === 'hit_tp') { currentWinStreak++; currentLossStreak = 0 }
        else if (s.status === 'hit_sl') { currentLossStreak++; currentWinStreak = 0 }
        else { currentWinStreak = 0; currentLossStreak = 0 }
      } else {
        if (s.status === 'hit_tp') {
          if (currentLossStreak > 0) break // streak broken
          currentWinStreak++
        } else if (s.status === 'hit_sl') {
          if (currentWinStreak > 0) break // streak broken
          currentLossStreak++
        } else {
          break // expired breaks streak
        }
      }
    }
    consecutiveWins = currentWinStreak
    consecutiveLosses = currentLossStreak

    // Longest win/loss streak (full history scan)
    let tempWin = 0, tempLoss = 0
    for (const s of resolvedSignals) {
      if (s.status === 'hit_tp') { tempWin++; tempLoss = 0; longestWinStreak = Math.max(longestWinStreak, tempWin) }
      else if (s.status === 'hit_sl') { tempLoss++; tempWin = 0; longestLossStreak = Math.max(longestLossStreak, tempLoss) }
      else { tempWin = 0; tempLoss = 0 }
    }

    const avgOutcome = winRate
    const acceptedCount = allUserSignals.length
    const ignoredCount = Math.max(0, acceptedCount - totalSignals)

    // ─── Monthly Performance (last 6 months) ────────────────────────────────
    const monthlyPerformance: { month: string; wins: number; losses: number }[] = []
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      const monthSignals = resolvedSignals.filter(s => {
        const dt = s.createdAt
        return dt >= d && dt < nextD
      })
      monthlyPerformance.push({
        month: monthNames[d.getMonth()],
        wins: monthSignals.filter(s => s.status === 'hit_tp').length,
        losses: monthSignals.filter(s => s.status === 'hit_sl').length,
      })
    }

    // ─── Win Rate Trend (last 8 weeks) ─────────────────────────────────────
    const winRateTrend: { week: string; winRate: number }[] = []
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000)
      const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000)
      const weekSignals = resolvedSignals.filter(s => s.createdAt >= weekStart && s.createdAt < weekEnd)
      const wWins = weekSignals.filter(s => s.status === 'hit_tp').length
      const wRate = weekSignals.length > 0 ? Math.round((wWins / weekSignals.length) * 100) : 50
      const weekLabel = `W${8 - i}`
      winRateTrend.push({ week: weekLabel, winRate: wRate })
    }

    // ─── Per-market breakdown ────────────────────────────────────────────────
    const marketBreakdown: Record<string, { total: number; wins: number; losses: number; winRate: number; avgRR: string; profit: string }> = {}
    for (const signal of resolvedSignals) {
      const mk = signal.marketType || 'Unknown'
      if (!marketBreakdown[mk]) {
        marketBreakdown[mk] = { total: 0, wins: 0, losses: 0, winRate: 0, avgRR: '1:0', profit: '$0' }
      }
      marketBreakdown[mk].total++
      if (signal.status === 'hit_tp') marketBreakdown[mk].wins++
      if (signal.status === 'hit_sl') marketBreakdown[mk].losses++
    }
    for (const mk of Object.keys(marketBreakdown)) {
      const mb = marketBreakdown[mk]
      mb.winRate = mb.total > 0 ? Math.round((mb.wins / mb.total) * 100) : 0
      mb.avgRR = mb.total > 0 ? `1:${(mb.wins / Math.max(mb.losses, 1)).toFixed(1)}` : '1:0'
      mb.profit = `$${(mb.wins * 100 - mb.losses * 60).toFixed(0)}`
    }

    // Market performance (for pie chart)
    const marketColors: Record<string, string> = {
      forex: '#10b981', crypto: '#f59e0b', stocks: '#6366f1',
      indices: '#ec4899', commodities: '#14b8a6',
    }
    const defaultColors = ['#10b981', '#f59e0b', '#6366f1', '#ec4899', '#14b8a6']
    const marketPerformance = Object.entries(marketBreakdown).map(([name, data], i) => ({
      name,
      value: data.winRate,
      color: marketColors[name.toLowerCase()] || defaultColors[i % defaultColors.length],
    }))

    // ─── Per-strategy breakdown ──────────────────────────────────────────────
    const strategyBreakdown: Record<string, { total: number; wins: number; losses: number; winRate: number; avgRR: string; profit: string }> = {}
    for (const signal of resolvedSignals) {
      const st = signal.strategy || 'Unknown'
      if (!strategyBreakdown[st]) {
        strategyBreakdown[st] = { total: 0, wins: 0, losses: 0, winRate: 0, avgRR: '1:0', profit: '$0' }
      }
      strategyBreakdown[st].total++
      if (signal.status === 'hit_tp') strategyBreakdown[st].wins++
      if (signal.status === 'hit_sl') strategyBreakdown[st].losses++
    }
    for (const st of Object.keys(strategyBreakdown)) {
      const sb = strategyBreakdown[st]
      sb.winRate = sb.total > 0 ? Math.round((sb.wins / sb.total) * 100) : 0
      sb.avgRR = sb.total > 0 ? `1:${(sb.wins / Math.max(sb.losses, 1)).toFixed(1)}` : '1:0'
      sb.profit = `$${(sb.wins * 100 - sb.losses * 60).toFixed(0)}`
    }

    // ─── Per-asset breakdown ────────────────────────────────────────────────
    const assetBreakdown: Record<string, { total: number; wins: number; losses: number; winRate: number; avgRR: string }> = {}
    for (const signal of resolvedSignals) {
      const a = signal.asset || 'Unknown'
      if (!assetBreakdown[a]) {
        assetBreakdown[a] = { total: 0, wins: 0, losses: 0, winRate: 0, avgRR: '1:0' }
      }
      assetBreakdown[a].total++
      if (signal.status === 'hit_tp') assetBreakdown[a].wins++
      if (signal.status === 'hit_sl') assetBreakdown[a].losses++
    }
    for (const a of Object.keys(assetBreakdown)) {
      const ab = assetBreakdown[a]
      ab.winRate = ab.total > 0 ? Math.round((ab.wins / ab.total) * 100) : 0
      ab.avgRR = ab.total > 0 ? `1:${(ab.wins / Math.max(ab.losses, 1)).toFixed(1)}` : '1:0'
    }

    // ─── Per-timeframe breakdown ────────────────────────────────────────────
    const timeframeBreakdown: Record<string, { total: number; wins: number; losses: number; winRate: number; avgRR: string }> = {}
    for (const signal of resolvedSignals) {
      const tf = (signal as any).timeframe || 'Unknown'
      if (!timeframeBreakdown[tf]) {
        timeframeBreakdown[tf] = { total: 0, wins: 0, losses: 0, winRate: 0, avgRR: '1:0' }
      }
      timeframeBreakdown[tf].total++
      if (signal.status === 'hit_tp') timeframeBreakdown[tf].wins++
      if (signal.status === 'hit_sl') timeframeBreakdown[tf].losses++
    }
    for (const tf of Object.keys(timeframeBreakdown)) {
      const tb = timeframeBreakdown[tf]
      tb.winRate = tb.total > 0 ? Math.round((tb.wins / tb.total) * 100) : 0
      tb.avgRR = tb.total > 0 ? `1:${(tb.wins / Math.max(tb.losses, 1)).toFixed(1)}` : '1:0'
    }

    // ─── Per-session breakdown ──────────────────────────────────────────────
    const sessionBreakdown: Record<string, { total: number; wins: number; losses: number; winRate: number; avgRR: string; peakHours: string }> = {}
    for (const signal of resolvedSignals) {
      const sess = (signal as any).session || 'Unknown'
      if (!sessionBreakdown[sess]) {
        sessionBreakdown[sess] = { total: 0, wins: 0, losses: 0, winRate: 0, avgRR: '1:0', peakHours: '' }
      }
      sessionBreakdown[sess].total++
      if (signal.status === 'hit_tp') sessionBreakdown[sess].wins++
      if (signal.status === 'hit_sl') sessionBreakdown[sess].losses++
    }
    for (const sess of Object.keys(sessionBreakdown)) {
      const ss = sessionBreakdown[sess]
      ss.winRate = ss.total > 0 ? Math.round((ss.wins / ss.total) * 100) : 0
      ss.avgRR = ss.total > 0 ? `1:${(ss.wins / Math.max(ss.losses, 1)).toFixed(1)}` : '1:0'
      // Derive peak hours from session name
      const peakMap: Record<string, string> = {
        london: '08:00 – 12:00 UTC',
        newyork: '13:00 – 17:00 UTC',
        asian: '00:00 – 06:00 UTC',
        overlap: '13:00 – 16:00 UTC',
      }
      ss.peakHours = peakMap[sess.toLowerCase()] || ''
    }

    return successResponse({
      overview: {
        totalSignals, wins, losses, expired, winRate, lossRate, breakevenRate,
        avgConfidence, avgRiskReward, monthlySignals, consecutiveWins,
        longestWinStreak, consecutiveLosses, longestLossStreak, avgOutcome,
        acceptedCount, ignoredCount,
      },
      marketBreakdown,
      strategyBreakdown,
      assetBreakdown,
      timeframeBreakdown,
      sessionBreakdown,
      monthlyPerformance,
      winRateTrend,
      marketPerformance,
      period,
    })
  } catch (error) {
    console.error('Performance GET error:', error)
    return successResponse({
      overview: {
        totalSignals: 0, wins: 0, losses: 0, expired: 0, winRate: 0,
        lossRate: 0, breakevenRate: 0, avgConfidence: 0, avgRiskReward: 0,
        monthlySignals: 0, consecutiveWins: 0, longestWinStreak: 0,
        consecutiveLosses: 0, longestLossStreak: 0, avgOutcome: 0,
        acceptedCount: 0, ignoredCount: 0,
      },
      marketBreakdown: {}, strategyBreakdown: {}, assetBreakdown: {},
      timeframeBreakdown: {}, sessionBreakdown: {},
      monthlyPerformance: [], winRateTrend: [], marketPerformance: [],
      period: 'all',
    })
  }
}
