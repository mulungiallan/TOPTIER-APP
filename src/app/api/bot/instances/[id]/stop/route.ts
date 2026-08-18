import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { BotInstanceManager } from '@/lib/services/bot-instance-manager'
import { BotServiceOfflineError } from '@/lib/services/bot-service'

// POST /api/bot/instances/[id]/stop — stop an instance gracefully
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)
    const { id } = await params

    const instance = await db.botInstance.findFirst({ where: { id, userId } })
    if (!instance) return errorResponse('Not found', 404)

    const { instance: stopped } = await BotInstanceManager.stop(id)
    return successResponse({ instance: stopped })
  } catch (error) {
    if (error instanceof BotServiceOfflineError) {
      return errorResponse('The bot service is not running.', 503)
    }
    console.error('Bot instance stop error:', error)
    return errorResponse('Failed to stop bot', 500)
  }
}
