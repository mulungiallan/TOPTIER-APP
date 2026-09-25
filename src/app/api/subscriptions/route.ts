import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { notifyUser } from '@/lib/services/notifications'
import { PAYMENTS_ENABLED } from '@/lib/flags'

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'USD',
    interval: null,
    features: [
      'FREE screenshot analysis (ad-supported)',
      'Community access',
      'Economic calendar',
      'Market coverage',
    ],
    limitations: [
      'No trading signals',
      'No trading bot',
      'Ads included',
    ],
  },
  {
    id: 'trial',
    name: '7-Day Trial',
    price: 0,
    currency: 'USD',
    interval: '7_days',
    features: [
      'All features unlocked',
      'Signals access',
      'Trading bot access',
      'No ads',
      'Screenshot analysis',
    ],
    limitations: [
      'Limited to 7 days',
      'One-time only',
    ],
  },
  {
    id: 'signals_monthly',
    name: 'Signals',
    price: 20,
    currency: 'USD',
    interval: 'month',
    features: [
      'The 2 best signals every day',
      'Highest-confidence picks',
      'Forex, crypto, indices & more',
      'Full trade ideas with SL/TP',
    ],
    limitations: [
      'Limited to top 2 signals/day',
    ],
  },
  {
    id: 'bot_quarterly',
    name: 'Trading Bot',
    price: 100,
    currency: 'USD',
    interval: '3_months',
    features: [
      'Automated MT5/MT4 bot',
      'Runs continuously while active',
      'Profit-share settlements',
      '4 instances per account',
    ],
    limitations: [
      'Valid for 3 months',
    ],
  },
  {
    id: 'remove_ads',
    name: 'Remove Ads',
    price: 5,
    currency: 'USD',
    interval: 'lifetime',
    features: [
      'No ads anywhere in the app',
      'Removes banners, popups & interstitials',
      'One-time payment, permanent',
    ],
    limitations: [
      'One-time purchase',
    ],
  },
]

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)

    let currentSubscription: {
      tier: string | null
      startDate: Date | null
      endDate: Date | null
      isActive: boolean
    } | null = null
    if (userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: {
          subscriptionTier: true,
          subscriptionStartDate: true,
          subscriptionEndDate: true,
          trialStartDate: true,
          trialEndDate: true,
        },
      })

      if (user) {
        currentSubscription = {
          tier: user.subscriptionTier,
          startDate: user.subscriptionStartDate || user.trialStartDate,
          endDate: user.subscriptionEndDate || user.trialEndDate,
          isActive: user.subscriptionTier !== 'free' && 
            (user.subscriptionEndDate ? new Date() < user.subscriptionEndDate : true),
        }
      }
    }

    return successResponse({
      plans: PLANS,
      currentSubscription,
    })
  } catch (error) {
    console.error('Subscriptions GET error:', error)
    return errorResponse('Failed to fetch subscription plans', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!PAYMENTS_ENABLED) {
      return errorResponse('Premium subscriptions are not open yet.', 503)
    }

    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { planType } = body

    if (!planType) {
      return errorResponse('planType is required', 400)
    }

    // Paid plans can NEVER be granted through this endpoint. They must go
    // through a real payment via /api/payments/init (provider checkout).
    const paidPlan = PLANS.find(p => p.id === planType && p.price > 0)
    if (paidPlan) {
      return errorResponse('Paid plans require a real payment. Please check out via the pricing page.', 400)
    }

    // Only the free trial is allowed here, and it is strictly one-time.
    const validPlan = PLANS.find(p => p.id === 'trial')
    if (planType !== 'trial' || !validPlan) {
      return errorResponse('Invalid plan type', 400)
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { trialStartDate: true, subscriptionTier: true, subscriptionEndDate: true },
    })
    if (!user) {
      return errorResponse('User not found', 404)
    }

    if (user.trialStartDate) {
      return errorResponse('You have already used your free trial. It can only be activated once.', 400)
    }
    if (user.subscriptionTier === 'premium' || user.subscriptionTier === 'lifetime') {
      return errorResponse('You already have an active subscription.', 400)
    }
    if (user.subscriptionEndDate && new Date() < user.subscriptionEndDate) {
      return errorResponse('You already have an active subscription.', 400)
    }

    const now = new Date()
    const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    // Update user subscription
    const updatedUser = await db.user.update({
      where: { id: userId },
      data: {
        subscriptionTier: 'trial',
        subscriptionStartDate: now,
        subscriptionEndDate: trialEnd,
        trialStartDate: now,
        trialEndDate: trialEnd,
      },
    })

    // Create notification
    await notifyUser(userId, {
      type: 'subscription',
      title: 'Free Trial Activated',
      message: `Your 7-day free trial is active until ${trialEnd.toLocaleDateString()}. Enjoy all Premium features!`,
    })

    // Log activity
    await db.activityLog.create({
      data: {
        userId,
        action: 'subscribe',
        details: 'Started 7-day free trial',
      },
    })

    return successResponse({
      subscription: {
        tier: updatedUser.subscriptionTier,
        startDate: now,
        endDate: trialEnd,
        isActive: true,
      },
    }, 201)
  } catch (error) {
    console.error('Subscriptions POST error:', error)
    return errorResponse('Failed to process subscription', 500)
  }
}
