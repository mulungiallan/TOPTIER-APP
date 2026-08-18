import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'

export async function GET(request: NextRequest) {
  try {
    const { error, user } = await requireAdmin(request)
    if (error) return error
    if (!user) return errorResponse('Admin access required', 403)

    // Get various stats
    const [
      totalUsers,
      premiumUsers,
      activeUsersToday,
      totalSignals,
      activeSignals,
      totalTransactions,
      totalRevenue,
      openTickets,
      premiumInterestCount,
      premiumInterestGroup,
    ] = await Promise.all([
      db.user.count({ where: { deletedAt: null } }),
      db.user.count({ where: { subscriptionTier: { in: ['premium', 'lifetime'] }, deletedAt: null } }),
      db.user.count({
        where: {
          activityLogs: {
            some: {
              action: 'login',
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
          },
        },
      }),
      db.signal.count(),
      db.signal.count({ where: { status: 'active' } }),
      db.paymentTransaction.count({ where: { status: 'completed' } }),
      db.paymentTransaction.aggregate({
        where: { status: 'completed' },
        _sum: { amount: true },
      }),
      db.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
      db.activityLog.count({ where: { action: 'premium_interest' } }),
      db.activityLog.groupBy({
        by: ['userId'],
        where: { action: 'premium_interest' },
        _count: { _all: true },
      }),
    ])

    // Get user growth data (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const recentUsers = await db.user.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    // Group by day
    const userGrowth: Record<string, number> = {}
    for (const u of recentUsers) {
      const day = u.createdAt.toISOString().split('T')[0]
      userGrowth[day] = (userGrowth[day] || 0) + 1
    }

    // Get subscription distribution
    const subscriptionDistribution = await db.user.groupBy({
      by: ['subscriptionTier'],
      _count: { id: true },
      where: { deletedAt: null },
    })

    // Get signal performance summary
    const signalStats = await db.signal.groupBy({
      by: ['status'],
      _count: { id: true },
    })

    return successResponse({
      users: {
        total: totalUsers,
        premium: premiumUsers,
        activeToday: activeUsersToday,
        growth: userGrowth,
      },
      signals: {
        total: totalSignals,
        active: activeSignals,
        performance: signalStats,
      },
      revenue: {
        totalTransactions,
        totalRevenue: totalRevenue._sum.amount || 0,
      },
      support: {
        openTickets,
      },
      premiumInterest: {
        total: premiumInterestCount,
        interestedUsers: premiumInterestGroup.length,
      },
      subscriptionDistribution: subscriptionDistribution.map(s => ({
        tier: s.subscriptionTier,
        count: s._count.id,
      })),
    })
  } catch (error) {
    console.error('Admin GET error:', error)
    return errorResponse('Failed to fetch admin stats', 500)
  }
}
