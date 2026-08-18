import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { BotProfitShareService } from '@/lib/services/bot-profit-share'
import { ManagedCopyService, MasterTradeEvent } from '@/lib/services/managed-copy'
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
      return successResponse({ received: true })
    }

    if (type === 'trade_opened') {
      const trades: any[] = data?.trades || []
      if (trades.length === 0) return successResponse({ received: true, upserted: 0 })

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

      return successResponse({ received: true, upserted, mirrored })
    }

    if (type === 'trade_closed') {
      const trades: any[] = data?.trades || []
      if (trades.length === 0) return successResponse({ received: true, upserted: 0 })

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

      return successResponse({ received: true, upserted, settled })
    }

    return errorResponse('Unsupported event type', 400)
  } catch (error) {
    console.error('Bot webhook error:', error)
    return errorResponse('Failed to process webhook', 500)
  }
}
