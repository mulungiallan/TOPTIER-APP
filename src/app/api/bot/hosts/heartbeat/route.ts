import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { decryptSecret } from '@/lib/bot-crypto'
import { keysMatch } from '@/lib/services/bot-hosts'
import { validateBody, botHostHeartbeatSchema } from '@/lib/validation'

// POST /api/bot/hosts/heartbeat — the agent reports it is alive. Authenticated
// by the shared key the agent registered (`x-bot-service-key`), compared in
// constant time against the encrypted copy on the row. Keeps `status`/lastSeen
// fresh so the app knows which hosts are reachable before routing to them.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const parsed = validateBody(botHostHeartbeatSchema, body)
    if (!parsed.success) return errorResponse(parsed.error, 400)

    const { hostId, url, version, capacity } = parsed.data
    const provided = request.headers.get('x-bot-service-key') || ''

    const host = await db.botHost.findUnique({ where: { id: hostId } })
    if (!host) return errorResponse('Unknown host', 404)

    const expected = decryptSecret(host.keyEnc)
    if (!expected || !keysMatch(provided, expected)) {
      return errorResponse('Unauthorized', 401)
    }

    await db.botHost.update({
      where: { id: host.id },
      data: {
        status: 'online',
        lastSeenAt: new Date(),
        url: url ? url.replace(/\/+$/, '') : host.url,
        version: version ?? host.version,
        capacity: capacity ?? host.capacity,
      },
    })

    return successResponse({ ok: true })
  } catch (error) {
    console.error('Bot host heartbeat error:', error)
    return errorResponse('Heartbeat failed', 500)
  }
}
