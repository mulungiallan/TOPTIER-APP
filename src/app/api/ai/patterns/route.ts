import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { PatternRecognitionService } from '@/lib/services/trading-ai'

// GET /api/ai/patterns?symbol=BTC/USD&timeframe=1d  — detect patterns
// GET /api/ai/patterns?history=1                    — list user's past detections
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)

    if (searchParams.get('history') === '1') {
      const detections = await PatternRecognitionService.getUserDetections(userId)
      return successResponse({ detections })
    }

    const symbol = searchParams.get('symbol')
    if (!symbol) return errorResponse('symbol is required', 400)
    const timeframe = searchParams.get('timeframe') || '1d'

    const results = await PatternRecognitionService.detect(symbol, timeframe)
    // Save each detection
    for (const r of results) {
      await PatternRecognitionService.saveDetection(userId, r)
    }
    return successResponse({ patterns: results })
  } catch (error) {
    console.error('AI patterns GET error:', error)
    return errorResponse('Failed to detect patterns', 500)
  }
}
