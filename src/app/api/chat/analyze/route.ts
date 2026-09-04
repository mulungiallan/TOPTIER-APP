import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { chatAnalyzer } from '@/lib/chat-analyzer'

/**
 * POST /api/chat/analyze
 * Multi-model chat/message analysis (Hugging Face specialists → Gemini
 * structure → Claude fusion). Returns a verdict with confidence, severity,
 * evidence spans, model agreement, recommended action, and per-model sources.
 *
 * Body (application/json):
 *   {
 *     "text": string,            // required, the message to analyze
 *     "history": string[]        // optional, prior thread messages (oldest first)
 *   }
 *
 * Quota: shared with the general AI analysis allowance; free tier limited.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      return errorResponse('Content-Type must be application/json', 400)
    }

    const body = await request.json()
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const history =
      Array.isArray(body?.history)
        ? body.history.filter((h: unknown): h is string => typeof h === 'string')
        : []

    if (!text) {
      return errorResponse('No message text provided', 400)
    }

    const result = await chatAnalyzer.analyzeMessage(text, { history })

    await db.activityLog.create({
      data: {
        userId,
        action: 'analyze_chat',
        details: `${result.verdict} (${result.path} path, ${(result.confidence * 100).toFixed(0)}%)`,
      },
    })

    return successResponse(
      {
        result,
        providers: chatAnalyzer.getProviderStatus(),
      },
      201
    )
  } catch (error) {
    console.error('Chat analyze POST error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (message.includes('limit') || message.includes('429')) {
      return errorResponse(message, 429)
    }
    if (message.includes('empty') || message.includes('limit') || message.includes('exceeds')) {
      return errorResponse(message, 400)
    }
    return errorResponse(message || 'Chat analysis failed. Please try again.', 500)
  }
}

/**
 * GET /api/chat/analyze
 * Returns provider availability for the status badge.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }
    return successResponse({ providers: chatAnalyzer.getProviderStatus() })
  } catch (error) {
    console.error('Chat analyze GET error:', error)
    return errorResponse('Failed to fetch provider status', 500)
  }
}
