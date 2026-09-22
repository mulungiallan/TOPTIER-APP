import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'
import { getAllBalances, getTransactionHistory } from '@/lib/services/wallet'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error, user } = await requireAdmin(request)
    if (error) return error
    if (!user) return errorResponse('Forbidden: Admin access required', 403)

    const { id } = await params

    const target = await db.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, name: true, phone: true, country: true, role: true,
        subscriptionTier: true, plan: true, trialStartDate: true, trialEndDate: true,
        subscriptionStartDate: true, subscriptionEndDate: true, planExpiresAt: true,
        analysesLimit: true, analysesUsed: true, isEmailVerified: true, twoFactorEnabled: true,
        onboardingCompleted: true, referralCode: true, referredBy: true, referralCount: true,
        earnedPremiumDays: true, isBanned: true, banReason: true, language: true, darkMode: true,
        createdAt: true, updatedAt: true,
      },
    })
    if (!target) return errorResponse('User not found', 404)

    const [payments, activity, notifications, botConnections, analyses, badges, referrals, balances, walletTx, usage, featureUsage, recentEvents, ads, recentAds] = await Promise.all([
      db.paymentTransaction.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.activityLog.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      db.notification.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, type: true, title: true, message: true, isRead: true, createdAt: true },
      }),
      db.botConnection.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, userId: true, platform: true, label: true, brokerName: true,
          login: true, server: true, terminalPath: true, riskPerTradePct: true,
          providerSharePct: true, createdAt: true, updatedAt: true,
          instances: { orderBy: { updatedAt: 'desc' } },
          settlements: { orderBy: { createdAt: 'desc' }, take: 10 },
          _count: { select: { trades: true } },
        },
      }),
      db.screenshotAnalysis.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      db.userBadge.findMany({ where: { userId: id }, orderBy: { earnedAt: 'desc' } }),
      db.referralReward.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      getAllBalances(id),
      getTransactionHistory(id, undefined, 25),
      db.usageSession.aggregate({
        where: { userId: id },
        _count: true,
        _sum: { durationSec: true },
        _avg: { durationSec: true },
        _max: { startedAt: true },
        _min: { startedAt: true },
      }),
      db.usageEvent.groupBy({
        by: ['feature'],
        where: { userId: id },
        _count: { _all: true },
        orderBy: { _count: { feature: 'desc' } },
        take: 25,
      }),
      db.usageEvent.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.usageEvent.groupBy({
        by: ['action'],
        where: { userId: id, feature: 'ad' },
        _count: { _all: true },
        orderBy: { _count: { action: 'desc' } },
      }),
      db.usageEvent.findMany({
        where: { userId: id, feature: 'ad' },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
    ])

    return successResponse({
      user: target,
      payments,
      activity,
      notifications,
      botConnections,
      analyses,
      badges,
      referrals,
      wallet: { balances, transactions: walletTx },
      usage: {
        sessions: usage._count,
        totalDurationSec: usage._sum.durationSec || 0,
        avgDurationSec: usage._avg.durationSec || 0,
        firstActiveAt: usage._min.startedAt,
        lastActiveAt: usage._max.startedAt,
      },
      featureUsage,
      recentEvents,
      ads: { byAction: ads, recent: recentAds },
    })
  } catch (error) {
    console.error('Admin user detail GET error:', error)
    return errorResponse('Failed to fetch user details', 500)
  }
}
