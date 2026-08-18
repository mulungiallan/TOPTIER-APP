import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'
import { referralLockEnabled, getReferralLockCode, getReferralUrl } from '@/lib/referral-gate'
import { getEarningsBySource } from '@/lib/payouts'

// GET /api/admin/overview — comprehensive, real, read-only monitoring data.
// Every number here comes straight from the database. No mock values.

export async function GET(request: NextRequest) {
  try {
    const { error, user } = await requireAdmin(request)
    if (error) return error
    if (!user) return errorResponse('Forbidden: Admin access required', 403)

    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const twelveMonthsAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

    const [
      totalUsers,
      premiumUsers,
      trialUsers,
      activeToday,
      bannedUsers,
      totalSignals,
      activeSignals,
      revenueAgg,
      totalTransactions,
      pendingTransactions,
      openTickets,
      analysesCount,
      analysesToday,
      botConnections,
      botInstancesRunning,
      newsCount,
      couponsCount,
      pushSubCount,
      copyTradesCount,
      competitionsCount,
      backtestsCount,
      paperTradesCount,
      referralRewardsGranted,
      educationModulesCompleted,
      groupsCount,
      postsCount,
      commentsCount,
      conversationsCount,
      messagesCount,
      copyTraders,
      copyFollowers,
      copyMasters,
      copySettlementsDue,
      copySettlementsPaid,
      platformCopyFees,
    ] = await Promise.all([
      db.user.count({ where: { deletedAt: null } }),
      db.user.count({ where: { subscriptionTier: { in: ['premium', 'lifetime'] }, deletedAt: null } }),
      db.user.count({ where: { subscriptionTier: 'trial', deletedAt: null } }),
      db.user.count({
        where: {
          deletedAt: null,
          activityLogs: { some: { action: 'login', createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } },
        },
      }),
      db.user.count({ where: { isBanned: true, deletedAt: null } }),
      db.signal.count(),
      db.signal.count({ where: { status: 'active' } }),
      db.paymentTransaction.aggregate({
        where: { status: 'completed' },
        _sum: { amount: true },
      }),
      db.paymentTransaction.count({ where: { status: 'completed' } }),
      db.paymentTransaction.count({ where: { status: 'pending' } }),
      db.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
      db.screenshotAnalysis.count(),
      db.screenshotAnalysis.count({ where: { createdAt: { gte: new Date(now.setHours(0, 0, 0, 0)) } } }),
      db.botConnection.count({ where: { isActive: true } }),
      db.botInstance.count({ where: { status: 'running' } }),
      db.newsArticle.count(),
      db.couponCode.count(),
      db.pushSubscription.count(),
      db.copyTrade.count(),
      db.competition.count(),
      db.backtest.count(),
      db.paperTrade.count(),
      db.referralReward.count({ where: { status: 'granted' } }),
      db.educationProgress.count({ where: { completed: true } }),
      db.group.count(),
      db.post.count(),
      db.comment.count(),
      db.conversation.count(),
      db.directMessage.count(),
      db.copyTrader.count(),
      db.follow.count({ where: { status: 'active' } }),
      db.copyTrader.count({ where: { masterConnectionId: { not: null } } }),
      db.copySettlement.aggregate({ where: { status: 'due' }, _sum: { providerAmount: true } }),
      db.copySettlement.aggregate({ where: { status: 'paid' }, _sum: { providerAmount: true } }),
      db.platformEarning.aggregate({ where: { source: 'copy_fee' }, _sum: { amount: true } }),
    ])

    // Revenue breakdown by source (premium, copy, bot, referral, ads)
    const revenueBySource = await getEarningsBySource()

    const [recentUsers, recentPayments, recentSignals, recentNews, upcomingEvents, recentAnalyses, recentTickets, coupons, auditLog, activityFeed, botConnectionsList, recentBotTrades, copySettlements] =
      await Promise.all([
        db.user.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true, name: true, email: true, role: true, subscriptionTier: true, plan: true,
            isBanned: true, banReason: true, referralCount: true, createdAt: true,
          },
        }),
        db.paymentTransaction.findMany({
          where: { status: 'completed' },
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: { user: { select: { name: true, email: true } } },
        }),
        db.signal.findMany({ orderBy: { createdAt: 'desc' }, take: 25 }),
        db.newsArticle.findMany({ orderBy: { publishedAt: 'desc' }, take: 25 }),
        db.economicEvent.findMany({
          where: { eventDate: { gte: now } },
          orderBy: { eventDate: 'asc' },
          take: 25,
        }),
        db.screenshotAnalysis.findMany({
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: { user: { select: { name: true, email: true } } },
        }),
        db.supportTicket.findMany({
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: { user: { select: { name: true, email: true } } },
        }),
        db.couponCode.findMany({ orderBy: { createdAt: 'desc' }, take: 25 }),
        db.adminAuditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        db.activityLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, action: true, details: true, createdAt: true, userId: true },
        }),
        db.botConnection.findMany({
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: {
            user: { select: { name: true, email: true } },
            instances: { select: { id: true, status: true, lastHeartbeatAt: true, lastError: true, pid: true } },
          },
        }),
        db.botTrade.findMany({ orderBy: { closedAt: 'desc' }, take: 25 }),
        db.copySettlement.findMany({
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: {
            trader: { include: { user: { select: { id: true, name: true, email: true } } } },
            follower: { select: { name: true, email: true } },
          },
        }),
      ])

    // Revenue by month (completed transactions, last 12 months)
    const completedInWindow = await db.paymentTransaction.findMany({
      where: { status: 'completed', createdAt: { gte: twelveMonthsAgo } },
      select: { amount: true, currency: true, createdAt: true, planType: true },
    })
    const revenueByMonth: Record<string, { revenue: number; count: number }> = {}
    for (const tx of completedInWindow) {
      const key = tx.createdAt.toISOString().slice(0, 7)
      const cur = revenueByMonth[key] || { revenue: 0, count: 0 }
      cur.revenue += tx.amount
      cur.count += 1
      revenueByMonth[key] = cur
    }

    // User growth by day (last 30 days)
    const recentUsersForGrowth = await db.user.findMany({
      where: { createdAt: { gte: thirtyDaysAgo }, deletedAt: null },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    const userGrowth: Record<string, number> = {}
    for (const u of recentUsersForGrowth) {
      const day = u.createdAt.toISOString().split('T')[0]
      userGrowth[day] = (userGrowth[day] || 0) + 1
    }

    const subscriptionDistribution = (await db.user.groupBy({
      by: ['subscriptionTier'],
      _count: { id: true },
      where: { deletedAt: null },
    })).map((s) => ({ tier: s.subscriptionTier, count: s._count.id }))

    const signalPerformance = await db.signal.groupBy({ by: ['status'], _count: { id: true } })

    return successResponse({
      generatedAt: new Date().toISOString(),
      admin: { id: user.id, email: user.email, name: user.name, role: user.role },
      platform: {
        paymentsEnabled: process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === 'true',
        // NOTE: Individual service presence is intentionally NOT exposed.
        // If an admin account is compromised, leaking which API keys are
        // configured reveals infrastructure details that aid further attacks.
        nodeEnv: process.env.NODE_ENV || 'development',
      },
      stats: {
        users: { total: totalUsers, premium: premiumUsers, trial: trialUsers, activeToday, banned: bannedUsers },
        signals: { total: totalSignals, active: activeSignals },
        revenue: {
          totalTransactions,
          pendingTransactions,
          totalRevenue: Math.round((revenueAgg._sum.amount || 0) * 100) / 100,
          summaryBySource: revenueBySource,
        },
        support: { openTickets },
        analyses: { total: analysesCount, today: analysesToday },
        bots: { connections: botConnections, running: botInstancesRunning },
        copyTrading: {
          traders: copyTraders,
          followers: copyFollowers,
          masters: copyMasters,
          brokerProfitShareDue: Math.round((copySettlementsDue._sum.providerAmount || 0) * 100) / 100,
          brokerProfitSharePaid: Math.round((copySettlementsPaid._sum.providerAmount || 0) * 100) / 100,
          platformCopyFees: Math.round((platformCopyFees._sum.amount || 0) * 100) / 100,
        },
        referralGate: {
          enabled: referralLockEnabled(),
          codeConfigured: !!getReferralLockCode(),
          urlConfigured: !!getReferralUrl(),
        },
        content: { news: newsCount, coupons: couponsCount },
        engagement: {
          pushSubscriptions: pushSubCount,
          copyTrades: copyTradesCount,
          competitions: competitionsCount,
          backtests: backtestsCount,
          paperTrades: paperTradesCount,
          referralRewardsGranted: referralRewardsGranted,
          educationCompleted: educationModulesCompleted,
          groups: groupsCount,
          posts: postsCount,
          comments: commentsCount,
          conversations: conversationsCount,
          messages: messagesCount,
        },
      },
      revenueByMonth: Object.entries(revenueByMonth)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([month, v]) => ({ month, ...v })),
      userGrowth,
      subscriptionDistribution,
      signalPerformance: signalPerformance.map((s) => ({ status: s.status, count: s._count.id })),
      recentUsers,
      recentPayments,
      recentSignals,
      recentNews,
      upcomingEvents,
      recentAnalyses,
      recentTickets,
      coupons,
      auditLog,
      activityFeed,
      bots: botConnectionsList.map((b) => ({
        ...b,
        dueAmount: Math.max(0, (b.grossProfit || 0) * ((b.providerSharePct || 30) / 100) - (b.settledProviderAmount || 0)),
      })),
      copySettlements,
      recentBotTrades,
    })
  } catch (error) {
    console.error('Admin overview GET error:', error)
    return errorResponse('Failed to fetch admin overview', 500)
  }
}
