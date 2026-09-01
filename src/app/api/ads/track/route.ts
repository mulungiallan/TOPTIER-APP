import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

// POST /api/ads/track
// Records an ad impression/completion per user using the existing UsageEvent
// model (feature='ad', action=ad type). This powers the admin "Ads usage"
// reporting (ads served, rewarded completions, clicks).
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { type, action, meta } = body || {}

    const adType =
      typeof type === 'string' && ['banner', 'popup', 'interstitial', 'native', 'rewarded'].includes(type)
        ? type
        : 'banner'

    const adAction =
      typeof action === 'string' && ['view', 'complete', 'click'].includes(action) ? action : 'view'

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { analyticsOptOut: true },
    })
    if (!user) return errorResponse('User not found', 404)
    if (user.analyticsOptOut) return successResponse({ tracked: false, reason: 'opt_out' })

    const metaStr =
      meta && typeof meta === 'object'
        ? JSON.stringify(meta).slice(0, 1000)
        : typeof meta === 'string'
          ? meta.slice(0, 1000)
          : null

    await db.usageEvent.create({
      data: {
        userId,
        feature: 'ad',
        action: `${adAction}_${adType}`,
        meta: metaStr,
      },
    })

    return successResponse({ tracked: true })
  } catch (error) {
    console.error('Ads track error:', error)
    return errorResponse('Failed to track ad', 500)
  }
}