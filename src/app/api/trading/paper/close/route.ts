import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { PaperTradingService } from '@/lib/services/trading-ai'

// POST /api/trading/paper/close — close a paper trade at a given exit price
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { tradeId, exitPrice } = body

    if (!tradeId || !exitPrice) {
      return errorResponse('tradeId and exitPrice are required', 400)
    }

    const trade = await PaperTradingService.closeTrade(tradeId, userId, exitPrice)
    return successResponse({ trade })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to close trade'
    return errorResponse(msg, 400)
  }
}
