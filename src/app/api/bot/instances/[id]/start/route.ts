import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { BotInstanceManager } from '@/lib/services/bot-instance-manager'
import { BotServiceOfflineError } from '@/lib/services/bot-service'
import { hasBotAccess, BOT_PAYWALL_MESSAGE } from '@/lib/entitlements'

// POST /api/bot/instances/[id]/start — (re)start an instance
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)
    if (!(await hasBotAccess(userId))) return errorResponse(BOT_PAYWALL_MESSAGE, 403, undefined, 'bot_paywall')
    const { id } = await params

    const instance = await db.botInstance.findFirst({ where: { id, userId }, include: { connection: true } })
    if (!instance) return errorResponse('Not found', 404)

    const { serviceStatus } = await BotInstanceManager.start(instance.connectionId)
    return successResponse({ serviceStatus })
  } catch (error) {
    if (error instanceof BotServiceOfflineError) {
      return errorResponse('The bot service is not running.', 503)
    }
    console.error('Bot instance start error:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to start bot', 500)
  }
}
