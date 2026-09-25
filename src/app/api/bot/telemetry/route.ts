import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { hasBotAccess, BOT_PAYWALL_MESSAGE } from '@/lib/entitlements'

// GET /api/bot/telemetry?connectionId=&limit=
// Equity/balance/open-position history for the user's bot connection(s),
// recorded from status webhooks (see /api/bot/webhook). Returns the latest
// `limit` samples oldest→newest so the chart can draw a growing curve.
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    if (!(await hasBotAccess(userId))) {
      return errorResponse(BOT_PAYWALL_MESSAGE, 403, undefined, 'bot_paywall')
    }

    const { searchParams } = new URL(request.url)
    const connectionId = searchParams.get('connectionId')
    const limit = Math.min(Number(searchParams.get('limit') || '400'), 1000)

    const snapshots = await db.botSnapshot.findMany({
      where: {
        userId,
        ...(connectionId ? { instance: { connectionId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    snapshots.reverse()

    const series = snapshots.map((s) => ({
      t: s.createdAt.toISOString(),
      equity: s.equity,
      balance: s.balance,
      positionCount: s.positionCount,
      openPl: s.openPl,
      currency: s.currency,
    }))

    return successResponse({ series })
  } catch (error) {
    console.error('Bot telemetry GET error:', error)
    return errorResponse('Failed to load telemetry', 500)
  }
}