// TOPTIER Payment Fulfillment
// Shared, idempotent completion logic used by every payment provider's
// webhook / callback / verify path. Guards against replay attacks:
// a transaction is only fulfilled once (status must be 'pending'), and the
// user upgrade happens only if the pending transaction was actually claimed.

import { db } from '@/lib/db'
import { notifyUser } from '@/lib/services/notifications'

export interface FulfillmentMatch {
  id?: string
  stripeSessionId?: string
  userId?: string
  planType?: string
}

export interface FulfillmentResult {
  fulfilled: boolean
  tier?: string
  endDate?: Date | null
}

export async function fulfillPendingPayment(
  match: FulfillmentMatch,
  extra?: { paymentMethod?: string; provider?: string }
): Promise<FulfillmentResult> {
  const where: Record<string, unknown> = { status: 'pending' }
  if (match.id) where.id = match.id
  if (match.stripeSessionId) where.stripeSessionId = match.stripeSessionId
  if (match.userId) where.userId = match.userId
  if (match.planType) where.planType = match.planType

  const transaction = await db.paymentTransaction.findFirst({ where })
  if (!transaction) {
    // Nothing pending to fulfill — already completed, cancelled, or never existed.
    return { fulfilled: false }
  }

  // Idempotency guard: only one caller can flip this transaction to completed.
  const claimed = await db.paymentTransaction.updateMany({
    where: { id: transaction.id, status: 'pending' },
    data: {
      status: 'completed',
      ...(extra?.paymentMethod ? { paymentMethod: extra.paymentMethod } : {}),
    },
  })
  if (claimed.count === 0) {
    return { fulfilled: false }
  }

  // Consume the coupon only now that the payment actually completed.
  const couponMatch = transaction.description?.match(/\|coupon:([A-Z0-9]+)/i)
  if (couponMatch) {
    await db.couponCode
      .update({
        where: { code: couponMatch[1] },
        data: { usedCount: { increment: 1 } },
      })
      .catch((e: any) => {
        console.warn('[Fulfillment] Failed to increment coupon usedCount:', e?.message)
      })
  }

  const now = new Date()
  const planType = match.planType || transaction.planType
  let endDate: Date | null = null
  if (planType === 'premium_monthly') {
    endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  } else if (planType === 'premium_annual') {
    endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
  }
  // lifetime has no end date

  const tier = planType === 'lifetime' ? 'lifetime' : planType === 'trial' ? 'trial' : 'premium'

  await db.user.update({
    where: { id: transaction.userId },
    data: {
      subscriptionTier: tier,
      subscriptionStartDate: now,
      subscriptionEndDate: endDate,
    },
  })

  // Referral reward: when a referred user pays for premium, grant the
  // referrer the pending reward (premium days) and extend their subscription.
  const payingUser = await db.user.findUnique({
    where: { id: transaction.userId },
    select: { referredBy: true },
  })
  if (payingUser?.referredBy) {
    const pendingReward = await db.referralReward.findFirst({
      where: { referredUserId: transaction.userId, status: 'pending' },
    })
    if (pendingReward) {
      const rewardDays = pendingReward.rewardAmount
      const referrer = await db.user.findUnique({
        where: { id: pendingReward.userId },
        select: { subscriptionEndDate: true, subscriptionTier: true },
      })
      // Extend the referrer's subscription by the reward days
      const now = new Date()
      const base = referrer?.subscriptionEndDate && referrer.subscriptionEndDate > now
        ? referrer.subscriptionEndDate
        : now
      const newEndDate = new Date(base.getTime() + rewardDays * 24 * 60 * 60 * 1000)
      const newTier = referrer?.subscriptionTier === 'free' ? 'premium' : referrer?.subscriptionTier

      await db.$transaction([
        db.referralReward.update({
          where: { id: pendingReward.id },
          data: { status: 'granted' },
        }),
        db.user.update({
          where: { id: pendingReward.userId },
          data: {
            earnedPremiumDays: { increment: rewardDays },
            subscriptionEndDate: newEndDate,
            ...(newTier && { subscriptionTier: newTier }),
          },
        }),
      ])
    }
  }

  await notifyUser(transaction.userId, {
    type: 'subscription',
    title: 'Payment Confirmed',
    message: `Your subscription is now active${endDate ? ` until ${endDate.toLocaleDateString()}` : ''}!`,
  })

  await db.activityLog.create({
    data: {
      userId: transaction.userId,
      action: 'payment_completed',
      details: `Payment completed via ${extra?.provider || transaction.paymentProvider || 'gateway'} for ${planType}`,
    },
  })

  return { fulfilled: true, tier, endDate }
}
