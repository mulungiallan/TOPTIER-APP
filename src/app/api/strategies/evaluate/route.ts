import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { StrategyBuilderService } from '@/lib/services/trading-ai'

// POST /api/strategies/evaluate — run a saved strategy against real data
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { strategyId, symbol, startDate, endDate, initialCapital } = body

    if (!strategyId || !symbol || !startDate || !endDate) {
      return errorResponse('strategyId, symbol, startDate, endDate are required', 400)
    }
    if (!/^[A-Z0-9:._-]+$/.test(String(symbol))) {
      return errorResponse('Invalid symbol', 400)
    }

    const result = await StrategyBuilderService.evaluate(userId, {
      strategyId: String(strategyId),
      symbol: String(symbol).toUpperCase(),
      startDate: String(startDate),
      endDate: String(endDate),
      initialCapital: typeof initialCapital === 'number' ? initialCapital : 10000,
    })

    return successResponse(result)
  } catch (error: any) {
    const message = error?.message || 'Failed to evaluate strategy'
    const isExpected = message.includes('not enough') || message.includes('Strategy') || message.includes('No')
    console.error('Strategies evaluate error:', error)
    return errorResponse(message, isExpected ? 400 : 500)
  }
}
