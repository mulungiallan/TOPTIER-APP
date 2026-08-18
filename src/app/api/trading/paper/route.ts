import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { PaperTradingService } from '@/lib/services/trading-ai'

// GET /api/trading/paper?status=open — list paper trades
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || undefined

    const [trades, stats] = await Promise.all([
      PaperTradingService.getUserTrades(userId, status),
      PaperTradingService.getStats(userId),
    ])
    return successResponse({ trades, stats })
  } catch (error) {
    console.error('Paper trade GET error:', error)
    return errorResponse('Failed to fetch paper trades', 500)
  }
}

// POST /api/trading/paper — open a new paper trade
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { symbol, direction, quantity, entryPrice, stopLoss, takeProfit, notes } = body

    if (!symbol || !direction || !quantity || !entryPrice) {
      return errorResponse('symbol, direction, quantity, entryPrice are required', 400)
    }
    if (typeof notes === 'string' && notes.length > 1000) {
      return errorResponse('Notes too long (max 1000 characters)', 400)
    }

    const trade = await PaperTradingService.openTrade(userId, {
      symbol, direction, quantity, entryPrice, stopLoss, takeProfit, notes,
    })
    return successResponse({ trade }, 201)
  } catch (error) {
    console.error('Paper trade POST error:', error)
    return errorResponse('Failed to open paper trade', 500)
  }
}
