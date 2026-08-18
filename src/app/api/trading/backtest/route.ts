import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { BacktestingService } from '@/lib/services/trading-ai'

// GET /api/trading/backtest?history=1 — list user's past backtests
// POST /api/trading/backtest          — run a new backtest
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const backtests = await BacktestingService.getUserBacktests(userId)
    return successResponse({ backtests })
  } catch (error) {
    console.error('Backtest GET error:', error)
    return errorResponse('Failed to fetch backtests', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { symbol, strategy, startDate, endDate, initialCapital } = body

    if (!symbol || !strategy || !startDate || !endDate) {
      return errorResponse('symbol, strategy, startDate, endDate are required', 400)
    }

    const result = await BacktestingService.run(userId, {
      symbol, strategy, startDate, endDate, initialCapital,
    })
    return successResponse({ backtest: result }, 201)
  } catch (error) {
    console.error('Backtest POST error:', error)
    return errorResponse('Failed to run backtest', 500)
  }
}
