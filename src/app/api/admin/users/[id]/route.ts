import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'

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

    const [payments, activity, notifications, botConnections, analyses, badges, referrals] = await Promise.all([
      db.paymentTransaction.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.activityLog.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
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
    })
  } catch (error) {
    console.error('Admin user detail GET error:', error)
    return errorResponse('Failed to fetch user details', 500)
  }
}
