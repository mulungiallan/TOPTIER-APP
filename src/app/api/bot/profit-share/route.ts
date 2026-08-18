import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { BotProfitShareService, summarizeConnection } from '@/lib/services/bot-profit-share'
import { isReferralUnlocked, REFERRAL_LOCK_MESSAGE } from '@/lib/referral-gate'

// GET /api/bot/profit-share?connectionId= — settlements + live due amounts
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const connectionId = searchParams.get('connectionId')

    const connections = await db.botConnection.findMany({
      where: { userId, ...(connectionId ? { id: connectionId } : {}) },
      orderBy: { createdAt: 'desc' },
    })
    const settlements = await db.botProfitShare.findMany({
      where: { userId, ...(connectionId ? { connectionId } : {}) },
      orderBy: { periodStart: 'desc' },
    })

    return successResponse({
      connections: connections.map((c) => summarizeConnection(c)),
      settlements,
    })
  } catch (error) {
    console.error('Bot profit-share GET error:', error)
    return errorResponse('Failed to load profit share data', 500)
  }
}

// POST /api/bot/profit-share — finalize the current period for a connection
// Body: { connectionId }
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)
    if (!(await isReferralUnlocked(userId))) return errorResponse(REFERRAL_LOCK_MESSAGE, 403)

    const body = await request.json()
    const { connectionId } = body
    if (!connectionId) return errorResponse('connectionId is required', 400)

    const connection = await db.botConnection.findFirst({ where: { id: connectionId, userId } })
    if (!connection) return errorResponse('Not found', 404)

    const result = await BotProfitShareService.settleNow(connectionId)
    return successResponse(result)
  } catch (error) {
    console.error('Bot profit-share POST error:', error)
    return errorResponse('Failed to settle profit share', 500)
  }
}
