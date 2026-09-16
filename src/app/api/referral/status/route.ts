import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { isReferralUnlocked, referralLockEnabled, getReferralUrl, REFERRAL_LOCK_MESSAGE } from '@/lib/referral-gate'
import { isPremiumActive, PREMIUM_FEATURE_MESSAGE } from '@/lib/premium-gate'

// GET /api/referral/status — tells the client whether the current user is
// allowed to use bot trading / copy trading (referral-gated features).
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const unlocked = await isReferralUnlocked(userId)
    const premium = await isPremiumActive(userId)
    return successResponse({
      lockEnabled: referralLockEnabled(),
      unlocked,
      premium,
      priority: premium && unlocked,
      referralUrl: getReferralUrl(),
      message: REFERRAL_LOCK_MESSAGE,
      premiumMessage: PREMIUM_FEATURE_MESSAGE,
    })
  } catch (error) {
    console.error('Referral status error:', error)
    return errorResponse('Failed to load referral status', 500)
  }
}
