import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { grantReferralCashMilestones } from '@/lib/services/referral-rewards'
import { deriveEntitlements } from '@/lib/entitlements'

// ─── Plan catalogue (kept in sync with /api/subscriptions) ─────────────────
const PLAN_CATALOG = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'USD',
    interval: null,
    color: 'slate',
    features: ['FREE screenshot analysis (ad-supported)', 'Community access', 'Economic calendar', 'Market coverage'],
  },
  {
    id: 'trial',
    name: '7-Day Trial',
    price: 0,
    currency: 'USD',
    interval: '7_days',
    color: 'amber',
    features: ['All features unlocked', 'Signals access', 'Trading bot access', 'No ads', 'Screenshot analysis'],
  },
  {
    id: 'signals_monthly',
    name: 'Signals',
    price: 20,
    currency: 'USD',
    interval: 'month',
    color: 'violet',
    features: ['The 2 best signals every day', 'Highest-confidence picks', 'Forex, crypto, indices & more', 'Full trade ideas with SL/TP'],
  },
  {
    id: 'bot_quarterly',
    name: 'Trading Bot',
    price: 100,
    currency: 'USD',
    interval: '3_months',
    color: 'emerald',
    features: ['Automated MT5/MT4 bot', 'Runs continuously while active', 'Profit-share settlements', '4 instances per account'],
  },
  {
    id: 'remove_ads',
    name: 'Remove Ads',
    price: 5,
    currency: 'USD',
    interval: 'lifetime',
    color: 'rose',
    features: ['No ads anywhere in the app', 'Removes banners, popups & interstitials', 'One-time payment, permanent'],
  },
  {
    id: 'mentorship_physical',
    name: '1-on-1 Mentorship (In Person)',
    price: 150,
    currency: 'USD',
    interval: '2_months',
    color: 'indigo',
    features: ['Face-to-face 1-on-1 trading mentorship', 'Personalized strategy & trade plan', 'Live Q&A mentoring sessions', 'Valid for 2 months'],
  },
  {
    id: 'mentorship_online',
    name: '1-on-1 Mentorship (Online)',
    price: 100,
    currency: 'USD',
    interval: '2_months',
    color: 'cyan',
    features: ['Remote 1-on-1 trading mentorship', 'Personalized strategy & trade plan', 'Online mentoring calls & chat support', 'Valid for 2 months'],
  },
]

const PLAN_DURATIONS_DAYS: Record<string, number> = {
  trial: 7,
  premium_daily: 1,
  premium_weekly: 7,
  premium_quarterly: 90,
  premium_annual: 365,
  premium_monthly: 30,
  lifetime: 36500, // ~100 years
  one_day: 1,
  three_day: 3,
  one_week: 7,
  two_week: 14,
  quarterly: 90,
  signals_monthly: 30,
  bot_quarterly: 90,
  remove_ads: 36500,
  mentorship_physical: 60,
  mentorship_online: 60,
}

const TIER_LABELS: Record<string, string> = {
  free: 'Free',
  trial: 'Trial',
  premium: 'Premium',
  premium_with_ads: 'Premium (with ads)',
  lifetime: 'Lifetime',
  pro: 'Pro',
}

function tierLabel(tier: string): string {
  return TIER_LABELS[tier] || tier.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

// GET /api/billing/dashboard
// Returns a consolidated bundle of pricing/billing data for the Pricing Dashboard page.
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    // ─── User + subscription state ─────────────────────────────────────────
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        subscriptionTier: true,
        plan: true,
        analysesLimit: true,
        analysesUsed: true,
        analysesResetAt: true,
        planExpiresAt: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true,
        trialStartDate: true,
        trialEndDate: true,
        referralCode: true,
        referralCount: true,
        earnedPremiumDays: true,
        role: true,
        signalsUnlocked: true,
        signalsExpiresAt: true,
        botExpiresAt: true,
        adsRemoved: true,
        mentorshipExpiresAt: true,
        mentorshipType: true,
        createdAt: true,
      },
    })

    if (!user) {
      return errorResponse('User not found', 404)
    }

    // Backfill referral cash milestones (existing users who already crossed
    // 100+ referrals get their $10 wallet reward automatically).
    await grantReferralCashMilestones(userId)

    // ─── Payment transactions (billing history) ───────────────────────────
    const transactions = await db.paymentTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        amount: true,
        currency: true,
        planType: true,
        paymentMethod: true,
        paymentProvider: true,
        status: true,
        description: true,
        invoiceUrl: true,
        createdAt: true,
      },
    })

    // ─── Referral rewards (history + total earned) ────────────────────────
    const referralRewards = await db.referralReward.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        rewardType: true,
        rewardAmount: true,
        status: true,
        reason: true,
        createdAt: true,
      },
    })

    // ─── Aggregate stats ──────────────────────────────────────────────────
    const completedTx = transactions.filter((t) => t.status === 'completed')
    const totalSpent = completedTx.reduce((sum, t) => sum + t.amount, 0)
    const lifetimeValue = totalSpent

    // Monthly spend for last 6 months
    const now = new Date()
    const monthlySpend: { month: string; amount: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      const monthTx = completedTx.filter((t) => {
        const d = new Date(t.createdAt)
        return d >= monthStart && d < monthEnd
      })
      const amount = monthTx.reduce((sum, t) => sum + t.amount, 0)
      monthlySpend.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short' }),
        amount: Math.round(amount * 100) / 100,
      })
    }

    // Plan breakdown by count of transactions
    const planBreakdown: { plan: string; count: number; total: number }[] = []
    for (const plan of PLAN_CATALOG) {
      const planTx = completedTx.filter((t) => t.planType === plan.id)
      if (planTx.length > 0) {
        planBreakdown.push({
          plan: plan.name,
          count: planTx.length,
          total: planTx.reduce((s, t) => s + t.amount, 0),
        })
      }
    }

    // ─── Current plan derivation ──────────────────────────────────────────
    const now2 = new Date()
    const isTrial = user.subscriptionTier === 'trial' || (user.trialEndDate != null && user.trialEndDate > now2 && user.subscriptionTier !== 'premium' && user.subscriptionTier !== 'lifetime')
    const planExpiresAt = user.planExpiresAt || user.subscriptionEndDate || user.trialEndDate
    const daysRemaining = planExpiresAt ? Math.max(0, daysBetween(now2, planExpiresAt)) : null
    const planDurationDays = user.subscriptionTier && user.subscriptionTier !== 'free'
      ? PLAN_DURATIONS_DAYS[user.plan || user.subscriptionTier] || 30
      : null
    const progressPct = planDurationDays && daysRemaining !== null
      ? Math.min(100, Math.max(0, ((planDurationDays - daysRemaining) / planDurationDays) * 100))
      : 0

    // ─── A-la-carte entitlements (signals / bot / ads) ────────────────────
    const entitlements = deriveEntitlements(user)

    const analysesLimit = user.analysesLimit || 0
    const analysesUsed = user.analysesUsed || 0
    const analysesRemaining = analysesLimit === 0 ? null : Math.max(0, analysesLimit - analysesUsed)
    const analysesPct = analysesLimit === 0 ? 0 : Math.min(100, (analysesUsed / analysesLimit) * 100)

    // Trial status
    const trialStatus = {
      isEligible: user.subscriptionTier === 'free' && !user.trialStartDate,
      isTrial,
      hasUsed: !!user.trialStartDate,
      startDate: user.trialStartDate,
      endDate: user.trialEndDate,
      daysRemaining: isTrial && user.trialEndDate ? daysBetween(now2, user.trialEndDate) : null,
    }

    // ─── Referral tier ladder (mirrors referral-service tiers) ────────────
    const REFERRAL_TIERS = [
      { count: 5, days: 1, name: 'Bronze', emoji: '🥉' },
      { count: 10, days: 1, name: 'Silver', emoji: '🥈' },
      { count: 20, days: 2, name: 'Gold', emoji: '🥇' },
      { count: 50, days: 7, name: 'Platinum', emoji: '💎' },
      { count: 100, days: 0, name: 'Diamond', emoji: '💠', cashReward: 10 },
      { count: 500, days: 36500, name: 'Legendary', emoji: '👑' },
    ]
    const referralCount = user.referralCount || 0
    let currentTier: (typeof REFERRAL_TIERS)[number] | null = null
    let nextTier: (typeof REFERRAL_TIERS)[number] | null = null
    for (let i = 0; i < REFERRAL_TIERS.length; i++) {
      if (referralCount >= REFERRAL_TIERS[i].count) {
        currentTier = REFERRAL_TIERS[i]
        nextTier = REFERRAL_TIERS[i + 1] || null
      } else if (!nextTier) {
        nextTier = REFERRAL_TIERS[i]
      }
    }
    const progressToNext = nextTier
      ? Math.min(100, Math.round(((referralCount - (currentTier?.count || 0)) / (nextTier.count - (currentTier?.count || 0))) * 100))
      : 100

    // ─── Build response ───────────────────────────────────────────────────
    return successResponse({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tier: user.subscriptionTier,
        tierLabel: tierLabel(user.subscriptionTier),
        plan: user.plan,
        createdAt: user.createdAt,
        referralCode: user.referralCode,
      },
      currentPlan: {
        tier: user.subscriptionTier,
        tierLabel: tierLabel(user.subscriptionTier),
        plan: user.plan || user.subscriptionTier,
        startDate: user.subscriptionStartDate || user.trialStartDate,
        endDate: planExpiresAt,
        daysRemaining,
        planDurationDays,
        progressPct: Math.round(progressPct),
        isTrial,
        isLifetime: user.subscriptionTier === 'lifetime',
        isFree: user.subscriptionTier === 'free',
        isPremium: entitlements.legacyPremium,
        hasAds: !entitlements.adFree,
      },
      entitlements: {
        signals: entitlements.signals,
        signalsExpiresAt: entitlements.signals ? user.signalsExpiresAt : null,
        bot: entitlements.bot,
        botExpiresAt: entitlements.bot ? user.botExpiresAt : null,
        adFree: entitlements.adFree,
        adsRemoved: user.adsRemoved === true,
        mentorship: entitlements.mentorship,
        mentorshipExpiresAt: entitlements.mentorship ? user.mentorshipExpiresAt : null,
        mentorshipType: user.mentorshipType,
      },
      usage: {
        analysesLimit,
        analysesUsed,
        analysesRemaining,
        analysesPct: Math.round(analysesPct),
        analysesResetAt: user.analysesResetAt,
        isUnlimited: analysesLimit === 0,
      },
      trial: trialStatus,
      referral: {
        code: user.referralCode,
        count: referralCount,
        earnedPremiumDays: user.earnedPremiumDays || 0,
        currentTier,
        nextTier,
        progressToNext,
        recentRewards: referralRewards,
      },
      billing: {
        totalSpent: Math.round(totalSpent * 100) / 100,
        lifetimeValue: Math.round(lifetimeValue * 100) / 100,
        currency: 'USD',
        transactionCount: completedTx.length,
        monthlySpend,
        planBreakdown,
        recentTransactions: transactions.slice(0, 10).map((t) => ({
          id: t.id,
          amount: t.amount,
          currency: t.currency,
          planType: t.planType,
          paymentMethod: t.paymentMethod,
          paymentProvider: t.paymentProvider,
          status: t.status,
          description: t.description,
          invoiceUrl: t.invoiceUrl,
          date: t.createdAt,
        })),
      },
      availablePlans: PLAN_CATALOG,
    })
  } catch (error) {
    console.error('Billing dashboard GET error:', error)
    return errorResponse('Failed to fetch billing dashboard data', 500)
  }
}
