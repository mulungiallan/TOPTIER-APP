import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { isReferralUnlocked, referralLockEnabled, getReferralUrl, REFERRAL_LOCK_MESSAGE } from '@/lib/referral-gate'

// GET /api/referral/status — tells the client whether the current user is
// allowed to use bot trading / copy trading (referral-gated features).
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const unlocked = await isReferralUnlocked(userId)
    return successResponse({
      lockEnabled: referralLockEnabled(),
      unlocked,
      referralUrl: getReferralUrl(),
      message: REFERRAL_LOCK_MESSAGE,
    })
  } catch (error) {
    console.error('Referral status error:', error)
    return errorResponse('Failed to load referral status', 500)
  }
}
