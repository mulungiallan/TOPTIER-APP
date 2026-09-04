import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { notifyUsers } from '@/lib/services/notifications'
import { signalGenerator } from '@/lib/services/signal-generator'

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const { searchParams } = new URL(request.url)
    const market = searchParams.get('market')
    const strategy = searchParams.get('strategy')
    const status = searchParams.get('status')
    const asset = searchParams.get('asset')
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '50')), 200)
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'))

    const where: Record<string, unknown> = {}

    // Normalize market filter to the lowercase form stored in the DB.
    if (market) where.marketType = market.toLowerCase()

    if (strategy) where.strategy = strategy.toLowerCase()
    if (status) where.status = status.toLowerCase()
    if (asset) where.asset = { contains: asset }

    // ─── Lazy population ─────────────────────────────────────────────────
    // If there are no active signals to show, generate a fresh set of
    // real-data signals on-the-fly so the page is never empty. Throttled
    // internally (max once per 10 minutes).
    const activeCount = await db.signal.count({
      where: { ...where, status: 'active', expiryDate: { gt: new Date() } },
    })
    if (activeCount === 0) {
      await signalGenerator.ensureSignals()
    }

    const [signals, total] = await Promise.all([
      db.signal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          _count: { select: { comments: true, reactions: true } },
        },
      }),
      db.signal.count({ where }),
    ])

    // If we just generated and the user asked for a specific market with no
    // results for that market, fall back to showing all generated signals.
    if (total === 0 && market) {
      const all = await db.signal.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          _count: { select: { comments: true, reactions: true } },
        },
      })
      return successResponse({ signals: all, total: all.length, limit, offset: 0 })
    }

    return successResponse({ signals, total, limit, offset })
  } catch (error) {
    console.error('Signals GET error:', error)
    return errorResponse('Failed to fetch signals', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user || (user.role !== 'admin' && user.role !== 'analyst')) {
      return errorResponse('Only admins and analysts can create signals', 403)
    }

    const body = await request.json()
    const {
      type,
      asset,
      entryPrice,
      stopLoss,
      takeProfit1,
      takeProfit2,
      takeProfit3,
      trailingStop,
      riskRewardRatio,
      confidence,
      strategy,
      timeframe,
      reason,
      expiryDate,
      marketType,
      tradingSession,
    } = body

    if (!type || !asset || !entryPrice || !stopLoss || !takeProfit1 || !strategy || !timeframe || !marketType) {
      return errorResponse('Missing required fields: type, asset, entryPrice, stopLoss, takeProfit1, strategy, timeframe, marketType', 400)
    }

    const entryPriceNum = parseFloat(entryPrice)
    const stopLossNum = parseFloat(stopLoss)
    const takeProfit1Num = parseFloat(takeProfit1)

    if (!Number.isFinite(entryPriceNum) || entryPriceNum <= 0) {
      return errorResponse('entryPrice must be a positive number', 400)
    }
    if (!Number.isFinite(stopLossNum) || stopLossNum <= 0) {
      return errorResponse('stopLoss must be a positive number', 400)
    }
    if (!Number.isFinite(takeProfit1Num) || takeProfit1Num <= 0) {
      return errorResponse('takeProfit1 must be a positive number', 400)
    }
    const confidenceVal = confidence ? Math.min(100, Math.max(0, parseInt(confidence))) : 50

    const signal = await db.signal.create({
      data: {
        type,
        asset,
        entryPrice: entryPriceNum,
        stopLoss: stopLossNum,
        takeProfit1: takeProfit1Num,
        takeProfit2: takeProfit2 ? parseFloat(takeProfit2) : null,
        takeProfit3: takeProfit3 ? parseFloat(takeProfit3) : null,
        trailingStop: trailingStop ? parseFloat(trailingStop) : null,
        riskRewardRatio: riskRewardRatio ? parseFloat(riskRewardRatio) : 0,
        confidence: confidenceVal,
        strategy,
        timeframe,
        reason: reason || '',
        expiryDate: expiryDate ? new Date(expiryDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        marketType,
        tradingSession: tradingSession || null,
        userId,
      },
    })

    // Log activity
    await db.activityLog.create({
      data: {
        userId,
        action: 'create_signal',
        details: `Created ${type} signal for ${asset}`,
      },
    })

    // Notify subscribers (fire-and-forget — don't block the response)
    db.user.findMany({
      where: { isBanned: false },
      select: { id: true, email: true, notificationPrefs: true },
      take: 1000,
    }).then(signalUsers => {
      notifyUsers(signalUsers, {
        type: 'signal',
        title: `New ${signal.type} Signal: ${signal.asset}`,
        message: `${signal.type} ${signal.asset} @ ${signal.entryPrice} (confidence: ${signal.confidence}%)`,
        actionUrl: '/signals',
      }).catch(e => console.error('Signal notification failed:', e))
    }).catch(e => console.error('Signal user query failed:', e))

    return successResponse(signal, 201)
  } catch (error) {
    console.error('Signals POST error:', error)
    return errorResponse('Failed to create signal', 500)
  }
}
