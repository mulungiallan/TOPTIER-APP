import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { BotProfitShareService } from '@/lib/services/bot-profit-share'
import { BotInstanceManager } from '@/lib/services/bot-instance-manager'
import { ManagedCopyService, MasterTradeEvent } from '@/lib/services/managed-copy'
import { hasBotAccess } from '@/lib/entitlements'
import { timingSafeEqual } from 'crypto'

// POST /api/bot/webhook — called by the Python bot service (mini-services/bot)
// with header `x-bot-service-key`. NO user JWT here: the shared secret proves
// the request came from our own bot service.
//
// Body:
//   { instanceId, type: 'trade_opened'|'trade_closed'|'status'|'lifecycle', event, data }
//
//   trade_opened.data.trades[]: [{ ticket, symbol, timeframe, direction, lots,
//     entryPrice, stopLoss, takeProfit, riskAmount, openTime, strategies }]
//     -> also mirrors master trades to PAMM/MAM followers when this connection
//        is a manager's MASTER account.
//   trade_closed.data.trades[]: [{ ticket, symbol, timeframe, direction,
//     lots, entryPrice, closePrice, stopLoss, takeProfit, profit, result,
//     strategy, riskAmount, openTime, closeTime }]
//     -> also settles mirrored follower trades for master accounts.
//   status.data: dashboard snapshot object
//   lifecycle.data: { event: 'started'|'stopped'|'error', message? }

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Keep-running maintenance, triggered on every webhook hit from the bot
 * service:
 *  - Subscription expired for this instance's owner → stop it so the bot never
 *    keeps trading after the plan is over.
 *  - Otherwise, if any keep-running instance is down (crash / service restart),
 *    reconcile the whole fleet to restart it.
 */
async function runBotMaintenance(instance: { id: string; userId: string; status: string }) {
  try {
    if (!(await hasBotAccess(instance.userId))) {
      if (['starting', 'running', 'stopping'].includes(instance.status)) {
        await BotInstanceManager.stop(instance.id, 'subscription_expired')
      }
      return
    }
    const downCount = await db.botInstance.count({
      where: { shouldRun: true, status: { in: ['stopped', 'error'] } },
    })
    if (downCount > 0) {
      try {
        await BotInstanceManager.reconcileAll()
      } catch (e) {
        console.error('Bot fleet reconcile failed:', e)
      }
    }
  } catch (e) {
    console.error('Bot maintenance failed:', e)
  }
}

// Throttle between two telemetry writes per instance (min gap).
const SNAPSHOT_MIN_GAP_MS = 20_000
const SNAPSHOT_RETENTION_DAYS = 14

/**
 * Persists one equity/balance/open-position sample for the chart. Best-effort:
 * a telemetry write must never fail the webhook (which the bot treats as a
 * failure and retries on the next scan).
 */
async function recordSnapshot(instanceId: string, userId: string, data: unknown) {
  try {
    if (!data || typeof data !== 'object') return
    const parsed = typeof data === 'string' ? JSON.parse(data) : data
    const snap = parsed as Record<string, any>
    const positions = Array.isArray(snap.open_positions) ? snap.open_positions : []
    const openPl = positions.reduce((sum: number, p: any) => sum + (Number(p?.profit) || 0), 0)

    const recent = await db.botSnapshot.findFirst({
      where: { instanceId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    if (recent && Date.now() - recent.createdAt.getTime() < SNAPSHOT_MIN_GAP_MS) return

    await db.botSnapshot.create({
      data: {
        instanceId,
        userId,
        equity: Number.isFinite(Number(snap.equity)) ? Number(snap.equity) : null,
        balance: Number.isFinite(Number(snap.balance)) ? Number(snap.balance) : null,
        currency: typeof snap.currency === 'string' ? snap.currency : null,
        positionCount: positions.length,
        openPl: Math.round(openPl * 100) / 100,
        snapshot: JSON.stringify(parsed),
      },
    })

    await db.botSnapshot.deleteMany({
      where: { instanceId, createdAt: { lt: new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 86_400_000) } },
    })
  } catch (e) {
    console.error('Bot telemetry record failed:', e)
  }
}

export async function POST(request: NextRequest) {
  const expected = process.env.BOT_SERVICE_KEY
  if (!expected) return errorResponse('BOT_SERVICE_KEY not configured', 500)

  const provided = request.headers.get('x-bot-service-key') || ''
  if (!timingSafeCompare(provided, expected)) {
    return errorResponse('Unauthorized', 401)
  }

  let payload: any
  try {
    payload = await request.json()
  } catch {
    return errorResponse('Invalid JSON body', 400)
  }

  const { instanceId, type, data } = payload || {}
  if (!instanceId || !type) return errorResponse('instanceId and type are required', 400)

  try {
    const instance = await db.botInstance.findUnique({ where: { id: instanceId } })
    if (!instance) return errorResponse('Unknown instance', 404)

    if (type === 'status') {
      await db.botInstance.update({
        where: { id: instanceId },
        data: {
          lastHeartbeatAt: new Date(),
          lastSnapshot: typeof data === 'string' ? data : JSON.stringify(data ?? null),
        },
      })
      await recordSnapshot(instanceId, instance.userId, data)
      await runBotMaintenance(instance)
      return successResponse({ received: true })
    }

    if (type === 'lifecycle') {
      const event = data?.event || payload.event
      await db.botInstance.update({
        where: { id: instanceId },
        data: {
          lastHeartbeatAt: new Date(),
          status: event === 'started' ? 'running' : event === 'stopped' ? 'stopped' : instance.status,
          ...(event === 'error' && data?.message ? { lastError: String(data.message) } : {}),
        },
      })
      await runBotMaintenance(instance)
      return successResponse({ received: true })
    }

    if (type === 'trade_opened') {
      const trades: any[] = data?.trades || []
      if (trades.length === 0) {
        await runBotMaintenance(instance)
        return successResponse({ received: true, upserted: 0 })
      }

      let upserted = 0
      let mirrored = 0
      for (const t of trades) {
        const ticket = String(t.ticket)
        if (!ticket) continue
        await db.botTrade.upsert({
          where: { connectionId_ticket: { connectionId: instance.connectionId, ticket } },
          create: {
            connectionId: instance.connectionId,
            userId: instance.userId,
            ticket,
            symbol: String(t.symbol || ''),
            timeframe: t.timeframe ? String(t.timeframe) : null,
            direction: String(t.direction || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
            lots: Number(t.lots) || 0,
            entryPrice: Number(t.entryPrice) || 0,
            stopLoss: t.stopLoss != null ? Number(t.stopLoss) : null,
            takeProfit: t.takeProfit != null ? Number(t.takeProfit) : null,
            profit: 0,
            strategyData: t.strategies ? JSON.stringify(t.strategies) : null,
            riskAmount: t.riskAmount != null ? Number(t.riskAmount) : null,
            openedAt: t.openTime ? new Date(Number(t.openTime) * 1000) : new Date(),
          },
          update: {
            stopLoss: t.stopLoss != null ? Number(t.stopLoss) : undefined,
            takeProfit: t.takeProfit != null ? Number(t.takeProfit) : undefined,
            lots: Number(t.lots) || undefined,
            entryPrice: Number(t.entryPrice) || undefined,
          },
        })
        upserted++

        // PAMM/MAM mirroring: if this connection is someone's MASTER account,
        // copy the fresh trade to every active follower's ledger.
        const ev: MasterTradeEvent = {
          ticket,
          symbol: String(t.symbol || ''),
          timeframe: t.timeframe ? String(t.timeframe) : null,
          direction: String(t.direction || 'BUY'),
          lots: Number(t.lots) || 0,
          entryPrice: Number(t.entryPrice) || 0,
          stopLoss: t.stopLoss != null ? Number(t.stopLoss) : null,
          takeProfit: t.takeProfit != null ? Number(t.takeProfit) : null,
          riskAmount: t.riskAmount != null ? Number(t.riskAmount) : null,
          openTime: t.openTime ? Number(t.openTime) : undefined,
        }
        mirrored += (await ManagedCopyService.mirrorMasterOpen(instance.connectionId, ev)).mirrored
      }

      await runBotMaintenance(instance)
      return successResponse({ received: true, upserted, mirrored })
    }

    if (type === 'trade_closed') {
      const trades: any[] = data?.trades || []
      if (trades.length === 0) {
        await runBotMaintenance(instance)
        return successResponse({ received: true, upserted: 0 })
      }

      let upserted = 0
      for (const t of trades) {
        const ticket = String(t.ticket)
        if (!ticket) continue
        await db.botTrade.upsert({
          where: { connectionId_ticket: { connectionId: instance.connectionId, ticket } },
          create: {
            connectionId: instance.connectionId,
            userId: instance.userId,
            ticket,
            symbol: String(t.symbol || ''),
            timeframe: t.timeframe ? String(t.timeframe) : null,
            direction: String(t.direction || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
            lots: Number(t.lots) || 0,
            entryPrice: Number(t.entryPrice) || 0,
            closePrice: t.closePrice != null ? Number(t.closePrice) : null,
            stopLoss: t.stopLoss != null ? Number(t.stopLoss) : null,
            takeProfit: t.takeProfit != null ? Number(t.takeProfit) : null,
            profit: Number(t.profit) || 0,
            result: t.result ? String(t.result).toUpperCase() : null,
            strategyData: t.strategy ? JSON.stringify(t.strategy) : null,
            riskAmount: t.riskAmount != null ? Number(t.riskAmount) : null,
            openedAt: t.openTime ? new Date(Number(t.openTime) * 1000) : new Date(),
            closedAt: t.closeTime ? new Date(Number(t.closeTime) * 1000) : new Date(),
          },
          update: {
            closePrice: t.closePrice != null ? Number(t.closePrice) : undefined,
            profit: Number(t.profit) || 0,
            result: t.result ? String(t.result).toUpperCase() : undefined,
            strategyData: t.strategy ? JSON.stringify(t.strategy) : undefined,
            riskAmount: t.riskAmount != null ? Number(t.riskAmount) : undefined,
            closedAt: t.closeTime ? new Date(Number(t.closeTime) * 1000) : new Date(),
          },
        })
        upserted++
      }

      await BotProfitShareService.recomputeProfit(instance.connectionId)

      // Auto-settle: update the monthly profit share + platform earning
      // so revenue flows into the payout ledger without manual intervention
      try {
        await BotProfitShareService.settleNow(instance.connectionId)
      } catch (e) {
        console.error('Auto-settle profit share failed:', e)
      }

      let settled = 0
      for (const t of trades) {
        const ticket = String(t.ticket)
        if (!ticket) continue
        const ev: MasterTradeEvent = {
          ticket,
          symbol: String(t.symbol || ''),
          timeframe: t.timeframe ? String(t.timeframe) : null,
          direction: String(t.direction || 'BUY'),
          lots: Number(t.lots) || 0,
          entryPrice: Number(t.entryPrice) || 0,
          closePrice: t.closePrice != null ? Number(t.closePrice) : null,
          stopLoss: t.stopLoss != null ? Number(t.stopLoss) : null,
          takeProfit: t.takeProfit != null ? Number(t.takeProfit) : null,
          profit: Number(t.profit) || 0,
          result: t.result ? String(t.result) : null,
          riskAmount: t.riskAmount != null ? Number(t.riskAmount) : null,
          openTime: t.openTime ? Number(t.openTime) : undefined,
          closeTime: t.closeTime ? Number(t.closeTime) : undefined,
        }
        settled += (await ManagedCopyService.mirrorMasterClose(instance.connectionId, ev)).settled
      }

      await runBotMaintenance(instance)
      return successResponse({ received: true, upserted, settled })
    }

    return errorResponse('Unsupported event type', 400)
  } catch (error) {
    console.error('Bot webhook error:', error)
    return errorResponse('Failed to process webhook', 500)
  }
}
