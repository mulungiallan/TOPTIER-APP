import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { notifyUsers } from '@/lib/services/notifications'
import { signalGenerator } from '@/lib/services/signal-generator'
import { signalOutcomes } from '@/lib/services/signal-outcomes'
import { liveMarketData } from '@/lib/services/live-market-data'
import { hasSignalsAccess, isAdminUser, SIGNALS_PAYWALL_MESSAGE, type EntitlementRow } from '@/lib/entitlements'
import type { Signal } from '@/generated/prisma'

interface SignalWithLive extends Signal {
  /** Whether THIS user has accepted the signal (from UserSignal, not Signal.userId). */
  accepted: boolean
  live: {
    price: number
    change: number
    changePercent: number
    timestamp: string
    source: string
  } | null
}

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    // Signals are a paid product: only Signals subscribers / legacy premium /
    // trial users see them. Everyone else gets a paywall.
    const hasSignals = await hasSignalsAccess(userId)
    if (!hasSignals) {
      return errorResponse(SIGNALS_PAYWALL_MESSAGE, 403, undefined, 'signals_paywall')
    }

    const { searchParams } = new URL(request.url)
    const market = searchParams.get('market')
    const strategy = searchParams.get('strategy')
    const style = searchParams.get('style')
    const strategyType = searchParams.get('strategyType')
    const status = searchParams.get('status')
    const asset = searchParams.get('asset')

    const where: Record<string, unknown> = {}

    // Normalize market filter to the lowercase form stored in the DB.
    if (market) where.marketType = market.toLowerCase()

    if (strategy) where.strategy = strategy.toLowerCase()
    if (style) where.style = style.toLowerCase()
    if (strategyType) where.strategyType = strategyType.toLowerCase()
    if (status) where.status = status.toLowerCase()
    if (asset) where.asset = { contains: asset }

    // ─── Lazy population ─────────────────────────────────────────────────
    // Always give the generator a chance to refresh (it is time-throttled
    // internally, max once per 5 min) so the feed updates as the market moves
    // instead of showing the same stale entries forever.
    await signalGenerator.ensureSignals()

    // Outcome monitor self-heal: before serving the feed, give the resolver a
    // chance to mark any signal that has just hit TP/SL/expired (throttled to
    // 30s + coalesced, so this is cheap). Fire-and-forget so the request never
    // waits on upstream price calls.
    void signalOutcomes.ensureOutcomes().catch(() => {})

    // Signal quotas apply to paying users only: the Signals product delivers
    // exactly the 2 BEST signals per day (ranked by confidence). Admins and the
    // owner get the FULL feed so they can review everything generated.
    const adminUser = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })
    const isAdmin = isAdminUser(adminUser as EntitlementRow)

    const includeCount = { _count: { select: { comments: true, reactions: true } } }
    const FALLBACK_QUOTA = 2
    const ADMIN_FEED_CAP = 500

    let signals: Signal[] = []
    if (isAdmin) {
      signals = await db.signal.findMany({
        where,
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
        take: ADMIN_FEED_CAP,
        include: includeCount,
      })
    } else {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      signals = await db.signal.findMany({
        where: { ...where, createdAt: { gte: since } },
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
        take: FALLBACK_QUOTA,
        include: includeCount,
      })

      // Quiet day / quiet market: top up with the most recent signals so the
      // subscriber always has at least 2 picks to see.
      if (signals.length < FALLBACK_QUOTA) {
        const newest = await db.signal.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: FALLBACK_QUOTA - signals.length,
          include: includeCount,
        })
        signals = [...signals, ...newest]
      }
    }

    // ─── Per-user accepted flag ─────────────────────────────────────────
    // The UI's Accept button reads this, so it has to be real. One batched
    // query for the whole feed (never N+1) — the accept record lives in
    // UserSignal, NOT in Signal.userId, which is a single-owner FK.
    const feedIds = signals.map(s => s.id)
    const acceptedRows = feedIds.length
      ? await db.userSignal.findMany({
          where: { userId, signalId: { in: feedIds } },
          select: { signalId: true },
        })
      : []
    const acceptedIds = new Set(acceptedRows.map(r => r.signalId))

    // ─── Live price overlay ──────────────────────────────────────────────
    // Attach the current market price (15s-cached) to every returned signal so
    // the UI can show live entry-vs-now moves, distance to TP/SL, and honest
    // "LIVE" coverage details. Signals whose asset has no quote carry `live: null`.
    const assets = [...new Set(signals.map(s => s.asset))]
    const priceMap = assets.length > 0 ? await liveMarketData.getMultiplePrices(assets) : new Map()
    const enriched: SignalWithLive[] = signals.map(s => {
      const lp = priceMap.get(s.asset)
      return {
        ...s,
        accepted: acceptedIds.has(s.id),
        live: lp
          ? {
              price: lp.price,
              change: lp.change,
              changePercent: lp.changePercent,
              timestamp: lp.timestamp.toISOString(),
              source: lp.source,
            }
          : null,
      }
    })

    return successResponse({ signals: enriched, total: enriched.length, limit: isAdmin ? null : FALLBACK_QUOTA, offset: 0 })
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
      style,
      strategyType,
      amdPhase,
      inMacroWindow,
      macroWindowName,
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
        style: style || null,
        strategyType: strategyType || 'confluence',
        amdPhase: amdPhase || null,
        inMacroWindow: inMacroWindow !== undefined && inMacroWindow !== null ? inMacroWindow === true || inMacroWindow === 'true' : null,
        macroWindowName: macroWindowName || null,
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
