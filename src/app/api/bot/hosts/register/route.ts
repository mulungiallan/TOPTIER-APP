import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/bot-crypto'
import { validateBody, botHostRegisterSchema } from '@/lib/validation'

// POST /api/bot/hosts/register — called by the self-hosted agent to claim a
// pairing code generated in the app. No JWT: the pairing code IS the credential
// (short-lived, single-use). The agent supplies its public URL and the shared
// key it will expect as `x-bot-service-key`; the app stores the key encrypted
// and clears the code so it cannot be reused.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const parsed = validateBody(botHostRegisterSchema, body)
    if (!parsed.success) return errorResponse(parsed.error, 400)

    const { pairingCode, url, key, name, platform, version, capacity } = parsed.data

    const host = await db.botHost.findUnique({ where: { pairingCode } })
    if (!host) return errorResponse('Invalid pairing code', 404)
    if (!host.pairingExpiresAt || host.pairingExpiresAt.getTime() < Date.now()) {
      return errorResponse('Pairing code has expired — generate a new one in the app', 410)
    }

    const updated = await db.botHost.update({
      where: { id: host.id },
      data: {
        url: url.replace(/\/+$/, ''),
        keyEnc: encryptSecret(key),
        name: name?.trim() || host.name,
        platform: platform || host.platform,
        version: version || null,
        capacity: capacity ?? host.capacity,
        status: 'online',
        lastSeenAt: new Date(),
        pairingCode: null,
        pairingExpiresAt: null,
      },
      select: { id: true, name: true, status: true },
    })

    return successResponse({ hostId: updated.id, name: updated.name, status: updated.status })
  } catch (error) {
    console.error('Bot host register error:', error)
    return errorResponse('Failed to register host', 500)
  }
}
