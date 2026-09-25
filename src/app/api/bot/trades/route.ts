import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { hasBotAccess, BOT_PAYWALL_MESSAGE } from '@/lib/entitlements'

// GET /api/bot/trades?connectionId=&limit=&symbol=&timeline=
// Closed trades for the user (newest first). With timeline=1, open trades are
// prepended newest-first so the page can show a single activity timeline.
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    if (!(await hasBotAccess(userId))) {
      return errorResponse(BOT_PAYWALL_MESSAGE, 403, undefined, 'bot_paywall')
    }

    const { searchParams } = new URL(request.url)
    const connectionId = searchParams.get('connectionId')
    const symbol = searchParams.get('symbol')
    const limit = Math.min(Number(searchParams.get('limit') || '100'), 500)
    const timeline = searchParams.get('timeline') === '1'

    const baseWhere = {
      userId,
      ...(connectionId ? { connectionId } : {}),
      ...(symbol ? { symbol } : {}),
    }

    if (timeline) {
      const [open, closed] = await Promise.all([
        db.botTrade.findMany({
          where: { ...baseWhere, closePrice: null, closedAt: null },
          orderBy: { openedAt: 'desc' },
          take: limit,
        }),
        db.botTrade.findMany({
          where: { ...baseWhere, NOT: { closedAt: null } },
          orderBy: { closedAt: 'desc' },
          take: limit,
        }),
      ])
      return successResponse({ trades: [...open, ...closed] })
    }

    const trades = await db.botTrade.findMany({
      where: baseWhere,
      orderBy: { openedAt: 'desc' },
      take: limit,
    })

    return successResponse({ trades })
  } catch (error) {
    console.error('Bot trades GET error:', error)
    return errorResponse('Failed to load trades', 500)
  }
}
