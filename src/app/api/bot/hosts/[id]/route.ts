import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { hasBotAccess, BOT_PAYWALL_MESSAGE } from '@/lib/entitlements'

type Params = { params: Promise<{ id: string }> }

// DELETE /api/bot/hosts/[id] — remove a host. Instances pinned to it are
// detached (hostId set to null) rather than deleted, so their history survives;
// they will fall back to the owner host on their next start.
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)
    const { id } = await params

    if (!(await hasBotAccess(userId))) {
      return errorResponse(BOT_PAYWALL_MESSAGE, 403, undefined, 'bot_paywall')
    }

    const host = await db.botHost.findUnique({ where: { id } })
    if (!host || host.userId !== userId) {
      return errorResponse('Host not found', 404)
    }

    await db.botHost.delete({ where: { id: host.id } })
    return successResponse({ deleted: true })
  } catch (error) {
    console.error('Bot host DELETE error:', error)
    return errorResponse('Failed to remove host', 500)
  }
}
