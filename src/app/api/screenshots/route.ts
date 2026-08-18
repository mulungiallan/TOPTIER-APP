import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']
const DOWNLOAD_TIMEOUT_MS = 15_000
const FREE_DAILY_LIMIT = 3

function isPrivateAddress(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length === 4) {
    if (parts[0] === 10) return true
    if (parts[0] === 127) return true
    if (parts[0] === 0) return true
    if (parts[0] === 169 && parts[1] === 254) return true
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    if (parts[0] === 192 && parts[1] === 168) return true
    return false
  }
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true
  return false
}

async function assertSafeImageUrl(rawUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Invalid imageUrl')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('imageUrl must be an http(s) URL')
  }
  const hostname = parsed.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('imageUrl host not allowed')
  }
  let ips: string[]
  try {
    ips = await lookup(hostname, { all: true, verbatim: true }).then((r) =>
      r.map((entry) => entry.address)
    )
  } catch {
    throw new Error('imageUrl host could not be resolved')
  }
  if (!ips.length || ips.some(isPrivateAddress)) {
    throw new Error('imageUrl host not allowed')
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const formData = await request.formData()
    const imageFile = formData.get('image') as File | null
    const imageUrl = formData.get('imageUrl') as string | null

    if (!imageFile && !imageUrl) {
      return errorResponse('No image provided. Upload an image file or provide an imageUrl', 400)
    }

    // ─── Quota enforcement (free-tier daily cap) ────────────────────────
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { subscriptionTier: true, subscriptionEndDate: true, plan: true },
    })

    const subActive =
      user?.subscriptionEndDate
        ? new Date() < user.subscriptionEndDate
        : user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'lifetime'

    const isPremium =
      (user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'lifetime') &&
      subActive

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const todayCount = await db.screenshotAnalysis.count({
      where: {
        userId,
        createdAt: { gte: today },
      },
    })

    if (!isPremium && todayCount >= FREE_DAILY_LIMIT) {
      return errorResponse(
        `Free tier limit reached (${FREE_DAILY_LIMIT} analyses/day). Upgrade to a Premium plan for more analyses.`,
        429
      )
    }

    // Create a pending analysis record
    const analysis = await db.screenshotAnalysis.create({
      data: {
        userId,
        imageUrl: imageUrl || `upload_${Date.now()}`,
        status: 'pending',
      },
    })

    try {
      // Use the hybrid ChartAnalyzer (Hugging Face vision model with graceful fallbacks)
      let imageBuffer: Buffer

      if (imageFile) {
        if (imageFile.size > MAX_IMAGE_BYTES) {
          throw new Error('Image too large (max 10 MB)')
        }
        if (!ALLOWED_IMAGE_TYPES.includes(imageFile.type)) {
          throw new Error('Unsupported image type')
        }
        const arrayBuffer = await imageFile.arrayBuffer()
        imageBuffer = Buffer.from(arrayBuffer)
      } else {
        await assertSafeImageUrl(imageUrl!)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
        try {
          const response = await fetch(imageUrl!, {
            redirect: 'error',
            signal: controller.signal,
            headers: { 'User-Agent': 'TOPTier-App/1.0' },
          })
          if (!response.ok) {
            throw new Error(`Failed to download image from URL: ${response.status}`)
          }
          const contentType = response.headers.get('content-type') || ''
          if (!ALLOWED_IMAGE_TYPES.includes(contentType.split(';')[0].trim())) {
            throw new Error('Unsupported image type from URL')
          }
          const contentLength = Number(response.headers.get('content-length') || 0)
          if (contentLength > MAX_IMAGE_BYTES) {
            throw new Error('Image too large (max 10 MB)')
          }
          imageBuffer = Buffer.from(await response.arrayBuffer())
        } finally {
          clearTimeout(timer)
        }
        if (imageBuffer.length > MAX_IMAGE_BYTES) {
          throw new Error('Image too large (max 10 MB)')
        }
      }

      const { ChartAnalyzer } = await import('@/lib/chart-analyzer')
      const analyzer = new ChartAnalyzer()
      const result = await analyzer.analyzeChart(imageBuffer)

      const signalType =
        result.signal === 'HOLD' ? 'NEUTRAL' : result.signal

      // Update the analysis record with results
      const updatedAnalysis = await db.screenshotAnalysis.update({
        where: { id: analysis.id },
        data: {
          signalType,
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
          action: 'analyze_screenshot',
          details: `Analyzed screenshot, result: ${signalType || 'unknown'} (${result.method})`,
        },
      })

      return successResponse(updatedAnalysis, 201)
    } catch (vlmError) {
      console.error('VLM analysis failed:', vlmError)

      // Update analysis record as failed
      await db.screenshotAnalysis.update({
        where: { id: analysis.id },
        data: { status: 'failed' },
      })

      const message = vlmError instanceof Error ? vlmError.message : 'Unknown error'
      const isClientError =
        message.includes('max 10 MB') ||
        message.includes('Unsupported image type') ||
        message.includes('imageUrl')
      if (isClientError) {
        return errorResponse(message, 400)
      }

      return errorResponse('Failed to analyze screenshot with AI', 500)
    }
  } catch (error) {
    console.error('Screenshots POST error:', error)
    return errorResponse('Failed to process screenshot', 500)
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20')), 100)
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'))

    const [analyses, total] = await Promise.all([
      db.screenshotAnalysis.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.screenshotAnalysis.count({ where: { userId } }),
    ])

    return successResponse({ analyses, total, limit, offset })
  } catch (error) {
    console.error('Screenshots GET error:', error)
    return errorResponse('Failed to fetch analyses', 500)
  }
}
