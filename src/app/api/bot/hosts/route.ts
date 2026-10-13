import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { encryptSecret } from '@/lib/bot-crypto'
import { hasBotAccess, BOT_PAYWALL_MESSAGE } from '@/lib/entitlements'
import { validateBody, botHostCreateSchema } from '@/lib/validation'

// Pairing codes are short-lived: the user generates one, types it into the
// agent on their machine, and the agent claims the row within this window.
const PAIRING_TTL_MS = 15 * 60 * 1000

function generatePairingCode(): string {
  return randomBytes(4).toString('hex').toUpperCase()
}

// GET /api/bot/hosts — list the current user's execution hosts. The shared key
// is never returned; the agent owns it and the app only stores it encrypted.
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    if (!(await hasBotAccess(userId))) {
      return errorResponse(BOT_PAYWALL_MESSAGE, 403, undefined, 'bot_paywall')
    }

    const hosts = await db.botHost.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        url: true,
        platform: true,
        version: true,
        capacity: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
        pairingCode: true,
        pairingExpiresAt: true,
        _count: { select: { instances: true } },
      },
    })
    return successResponse({ hosts })
  } catch (error) {
    console.error('Bot hosts GET error:', error)
    return errorResponse('Failed to load hosts', 500)
  }
}

// POST /api/bot/hosts — create a host and return a fresh pairing code. The host
// stays offline with no URL until an agent claims the code.
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    if (!(await hasBotAccess(userId))) {
      return errorResponse(BOT_PAYWALL_MESSAGE, 403, undefined, 'bot_paywall')
    }

    const body = await request.json().catch(() => ({}))
    const parsed = validateBody(botHostCreateSchema, body ?? {})
    if (!parsed.success) return errorResponse(parsed.error, 400)

    const name = parsed.data.name?.trim() || 'My PC'
    const pairingCode = generatePairingCode()
    const pairingExpiresAt = new Date(Date.now() + PAIRING_TTL_MS)

    const host = await db.botHost.create({
      data: {
        userId,
        name,
        // Placeholder until the agent claims the code and supplies its real
        // key. The row has no URL yet, so it is never routed to before pairing.
        keyEnc: encryptSecret(randomBytes(32).toString('hex')),
        pairingCode,
        pairingExpiresAt,
        status: 'offline',
      },
      select: {
        id: true,
        name: true,
        status: true,
        pairingCode: true,
        pairingExpiresAt: true,
        createdAt: true,
      },
    })

    return successResponse({ host }, 201)
  } catch (error) {
    console.error('Bot hosts POST error:', error)
    return errorResponse('Failed to create host', 500)
  }
}
