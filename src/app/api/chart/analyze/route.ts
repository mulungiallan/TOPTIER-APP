import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { chartAnalyzer } from '@/lib/chart-analyzer'
import { hybridChartAnalyzer } from '@/lib/hybrid-chart-analyzer'

/**
 * POST /api/chart/analyze
 * Analyzes a trading chart screenshot using the free Hugging Face + LLaVA hybrid.
 *
 * Accepts either:
 *   - multipart/form-data with `image` field (File)
 *   - application/json with `imageBase64` field (string, with or without data URL prefix)
 *
 * Quota:
 *   - Free tier: 3 analyses/day per user (configurable)
 *   - Premium tier: unlimited
 *
 * Cost to operator: $0.00 (Hugging Face free tier)
 */
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    // ─── Extract image from request ──────────────────────────────────────
    let imageBuffer: Buffer | null = null
    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const imageFile = formData.get('image') as File | null
      if (!imageFile) {
        return errorResponse('No image file provided', 400)
      }
      // 10 MB max
      if (imageFile.size > 10 * 1024 * 1024) {
        return errorResponse('Image too large (max 10 MB)', 400)
      }
      const arrayBuffer = await imageFile.arrayBuffer()
      imageBuffer = Buffer.from(arrayBuffer)
    } else if (contentType.includes('application/json')) {
      const body = await request.json()
      const base64 = body.imageBase64 as string | undefined
      if (!base64) {
        return errorResponse('No imageBase64 provided', 400)
      }
      const cleaned = base64.replace(/^data:image\/\w+;base64,/, '')
      imageBuffer = Buffer.from(cleaned, 'base64')
    } else {
      return errorResponse('Unsupported content type. Use multipart/form-data or application/json.', 400)
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      return errorResponse('Empty image data', 400)
    }

    // ─── Quota enforcement (legacy free-tier daily cap; primary enforcement
    // is now inside hybridChartAnalyzer based on per-user analysesLimit) ───
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true, plan: true },
    })

    const isPremium =
      user?.subscriptionTier === 'premium' ||
      user?.subscriptionTier === 'lifetime' ||
      (user?.plan && user.plan !== 'free')

    // ─── Create pending analysis record ──────────────────────────────────
    const analysis = await db.screenshotAnalysis.create({
      data: {
        userId,
        imageUrl: `chart_${Date.now()}`,
        status: 'pending',
      },
    })

    // ─── Run the hybrid analyzer (handles 90/10 split + quota) ──────────
    try {
      const hybridResult = await hybridChartAnalyzer.analyzeChart(imageBuffer, userId)
      const result = hybridResult

      const updated = await db.screenshotAnalysis.update({
        where: { id: analysis.id },
        data: {
          signalType: result.signal,
          entryPrice: result.entryPrice,
          stopLoss: result.stopLoss,
          takeProfit1: result.takeProfit1,
          takeProfit2: result.takeProfit2,
          takeProfit3: result.takeProfit3,
          confidence: result.confidence,
          timeframe: result.detectedTimeframe,
          detectedAsset: result.detectedAsset,
          pattern: result.pattern,
          explanation: result.reasoning,
          status: 'completed',
        },
      })

      // Log activity
      await db.activityLog.create({
        data: {
          userId,
          action: 'analyze_chart',
          details: `${result.signal} ${result.detectedAsset || 'chart'} @ ${result.confidence}% via ${result.method} (${result.planUsed})`,
        },
      })

      return successResponse(
        {
          analysis: updated,
          result,
          quota: {
            used: result.analysesUsed,
            limit: result.analysesLimit === 0 ? null : result.analysesLimit,
            remaining: result.analysesRemaining === -1 ? null : result.analysesRemaining,
            planUsed: result.planUsed,
            splitRatio: result.packageSplitRatio,
          },
          provider: {
            method: result.method,
            cost: result.cost,
            cached: result.cached,
          },
        },
        201
      )
    } catch (analysisError) {
      console.error('Chart analysis failed:', analysisError)

      await db.screenshotAnalysis.update({
        where: { id: analysis.id },
        data: { status: 'failed' },
      })

      // Distinguish quota errors (429) from server errors (500)
      const message =
        analysisError instanceof Error ? analysisError.message : 'Unknown error'
      if (message.includes('limit reached') || message.includes('Upgrade')) {
        return errorResponse(message, 429)
      }

      return errorResponse(
        'Chart analysis failed. Please try again with a clearer chart image.',
        500
      )
    }
  } catch (error) {
    console.error('Chart analyze POST error:', error)
    return errorResponse('Failed to process chart analysis request', 500)
  }
}

/**
 * GET /api/chart/analyze/usage
 * Returns current month's HF API usage stats (admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })

    if (user?.role !== 'admin') {
      return errorResponse('Admin access required', 403)
    }

    const stats = chartAnalyzer.getUsageStats()

    return successResponse({
      ...stats,
      monthlyLimit: 30000,
      provider: 'Hugging Face (Free Tier)',
      costToDate: '$0.00',
      fallbackConfigured: {
        gemini: Boolean(process.env.GEMINI_API_KEY),
      },
    })
  } catch (error) {
    console.error('Chart usage GET error:', error)
    return errorResponse('Failed to fetch usage stats', 500)
  }
}
