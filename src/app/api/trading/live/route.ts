import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { LiveTradingService } from '@/lib/services/trading-ai'

// GET /api/trading/live — list supported brokers
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    return successResponse({
      brokers: LiveTradingService.SUPPORTED_BROKERS,
      note: 'Live trading requires API credentials configured in Settings → Security.',
    })
  } catch (error) {
    console.error('Live trading GET error:', error)
    return errorResponse('Failed to list brokers', 500)
  }
}

// POST /api/trading/live — connect a broker OR place an order
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { action, brokerId, apiKey, apiSecret, accountId, order } = body

    if (action === 'connect') {
      if (!brokerId) return errorResponse('brokerId is required', 400)
      const account = await LiveTradingService.connect(brokerId, apiKey, apiSecret)
      return successResponse({ account }, 201)
    }
    if (action === 'order') {
      if (!accountId || !order) return errorResponse('accountId and order are required', 400)
      const result = await LiveTradingService.placeOrder(accountId, order)
      return successResponse({ order: result }, 201)
    }
    return errorResponse('Invalid action. Use "connect" or "order".', 400)
  } catch (error: any) {
    console.error('Live trading POST error:', error)
    const message = error instanceof Error ? error.message : 'Failed to perform live trading action'
    return errorResponse(message, 500)
  }
}
