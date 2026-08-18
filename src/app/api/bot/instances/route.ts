import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { BotInstanceManager } from '@/lib/services/bot-instance-manager'
import { BotServiceOfflineError } from '@/lib/services/bot-service'
import { isReferralUnlocked, REFERRAL_LOCK_MESSAGE } from '@/lib/referral-gate'

// POST /api/bot/instances — start the bot for a linked connection.
// Body: { connectionId }
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)
    if (!(await isReferralUnlocked(userId))) return errorResponse(REFERRAL_LOCK_MESSAGE, 403)

    const body = await request.json()
    const { connectionId } = body
    if (!connectionId) return errorResponse('connectionId is required', 400)

    const connection = await db.botConnection.findUnique({ where: { id: connectionId } })
    if (!connection || connection.userId !== userId) return errorResponse('Not found', 404)

    const { instance, serviceStatus } = await BotInstanceManager.start(connectionId)
    return successResponse({ instance, serviceStatus })
  } catch (error) {
    if (error instanceof BotServiceOfflineError) {
      return errorResponse('The bot service is not running. Start it with: uvicorn server:app --host 0.0.0.0 --port 8765', 503)
    }
    console.error('Bot instances POST error:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to start bot', 500)
  }
}
