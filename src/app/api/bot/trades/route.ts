import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/bot/trades?connectionId=&limit=&symbol= — closed trades for the user
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const connectionId = searchParams.get('connectionId')
    const symbol = searchParams.get('symbol')
    const limit = Math.min(Number(searchParams.get('limit') || '100'), 500)

    const trades = await db.botTrade.findMany({
      where: {
        userId,
        ...(connectionId ? { connectionId } : {}),
        ...(symbol ? { symbol } : {}),
      },
      orderBy: { closedAt: 'desc' },
      take: limit,
    })

    return successResponse({ trades })
  } catch (error) {
    console.error('Bot trades GET error:', error)
    return errorResponse('Failed to load trades', 500)
  }
}
