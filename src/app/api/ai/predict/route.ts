import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { PricePredictionService } from '@/lib/services/trading-ai'

// GET /api/ai/predict?symbol=BTC/USD&timeframe=1d  — generate a fresh prediction
// GET /api/ai/predict?history=1                   — list user's past predictions
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)

    if (searchParams.get('history') === '1') {
      const predictions = await PricePredictionService.getUserPredictions(userId)
      return successResponse({ predictions })
    }

    const symbol = searchParams.get('symbol')
    if (!symbol) return errorResponse('symbol is required', 400)
    const timeframe = (searchParams.get('timeframe') as '1h' | '4h' | '1d') || '1d'

    const result = await PricePredictionService.predict(symbol, timeframe)
    await PricePredictionService.savePrediction(userId, result)
    return successResponse({ prediction: result })
  } catch (error) {
    console.error('AI predict GET error:', error)
    return errorResponse('Failed to generate prediction', 500)
  }
}
