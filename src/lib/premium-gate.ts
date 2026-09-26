import { db } from '@/lib/db'

// Premium gate for bot trading and copy trading. Only users on a paid plan
// (premium / lifetime / pro / premium_with_ads, or the plan-based premium
// tiers) can access these features. Admins are always exempt so the owner can
// test and operate the platform.
export const PREMIUM_FEATURE_MESSAGE =
  'Premium feature — bot trading and copy trading unlock on a premium plan.'

export async function isPremiumActive(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      subscriptionTier: true,
      subscriptionEndDate: true,
      plan: true,
      planExpiresAt: true,
    },
  })
  if (!user) return false
  if (user.role === 'admin' || user.role === 'super_admin' || user.role === 'owner') return true

  const tier = user.subscriptionTier
  if (tier === 'lifetime') return true
  if (tier === 'premium' || tier === 'premium_with_ads' || tier === 'pro') {
    if (user.subscriptionEndDate && new Date(user.subscriptionEndDate).getTime() < Date.now()) {
      return false
    }
    return true
  }

  const plan = user.plan
  if (plan === 'premium' || plan === 'pro' || plan === 'enterprise' || plan === 'unlimited') {
    if (user.planExpiresAt && new Date(user.planExpiresAt).getTime() < Date.now()) {
      return false
    }
    return true
  }

  return false
}

export async function assertPremiumActive(userId: string): Promise<void> {
  if (!(await isPremiumActive(userId))) {
    const err = new Error(PREMIUM_FEATURE_MESSAGE) as Error & { status?: number }
    err.status = 403
    throw err
  }
}