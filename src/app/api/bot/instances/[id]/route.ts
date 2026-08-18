import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { BotInstanceManager } from '@/lib/services/bot-instance-manager'
import { botService, BotServiceOfflineError } from '@/lib/services/bot-service'

async function ownedInstanceOrNull(userId: string, instanceId: string) {
  return db.botInstance.findFirst({ where: { id: instanceId, userId }, include: { connection: true } })
}

// GET /api/bot/instances/[id] — live status + latest snapshot + log tail
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)
    const { id } = await params

    const instance = await ownedInstanceOrNull(userId, id)
    if (!instance) return errorResponse('Not found', 404)

    const { searchParams } = new URL(request.url)
    const tail = Number(searchParams.get('tail') || '200')

    let online = true
    try {
      await BotInstanceManager.refreshStatus(id)
    } catch (err) {
      if (!(err instanceof BotServiceOfflineError)) {
        console.error('Bot instance status refresh error:', err)
      }
      online = false
    }

    let logs: string[] = []
    try {
      const res = await botService.logs(id, tail)
      logs = res.lines || []
    } catch {
      logs = []
    }

    const fresh = await db.botInstance.findUnique({ where: { id } })
    let snapshot: unknown = null
    try {
      snapshot = fresh?.lastSnapshot ? JSON.parse(fresh.lastSnapshot) : null
    } catch {
      snapshot = fresh?.lastSnapshot || null
    }

    return successResponse({ instance: fresh, snapshot, logs, online })
  } catch (error) {
    console.error('Bot instance GET error:', error)
    return errorResponse('Failed to load instance', 500)
  }
}
