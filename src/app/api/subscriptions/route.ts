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
      '3 signals per day',
      'Basic market coverage',
      'Community access',
      'Economic calendar',
    ],
    limitations: [
      'Limited signals',
      'No screenshot analysis',
      'No custom alerts',
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
      'All premium features',
      'Unlimited signals',
      'Screenshot analysis',
      'Custom alerts',
      'Priority support',
    ],
    limitations: [
      'Limited to 7 days',
      'One-time only',
    ],
  },
  {
    id: 'premium_monthly',
    name: 'Premium Monthly',
    price: 29.99,
    currency: 'USD',
    interval: 'monthly',
    features: [
      'Unlimited signals',
      'All market coverage',
      'Screenshot analysis (AI)',
      'Custom alerts',
      'Advanced filtering',
      'Priority support',
      'No ads',
    ],
    limitations: [],
  },
  {
    id: 'premium_annual',
    name: 'Premium Annual',
    price: 249.99,
    currency: 'USD',
    interval: 'annual',
    features: [
      'Everything in Premium Monthly',
      '2 months free',
      'Early access to features',
      'Exclusive webinars',
    ],
    limitations: [],
  },
  {
    id: 'lifetime',
    name: 'Lifetime Access',
    price: 499.99,
    currency: 'USD',
    interval: 'lifetime',
    features: [
      'Everything in Premium',
      'Lifetime access',
      'One-time payment',
      'VIP support',
      'Beta features access',
      'Personal analyst consultation',
    ],
    limitations: [],
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
