// src/lib/services/bot-profit-share.ts
// Per-trade profit share for the TOPTIER auto-trading bot.
//
// The model: TOPTIER keeps `providerSharePct` (default 50%) of EVERY winning
// trade the bot closes — both long (BUY) and short (SELL) — with no
// high-water mark and no loss carry-forward:
//
//   totalShare     = grossProfit * providerSharePct / 100
//   dueAmount      = max(0, totalShare - settledProviderAmount)
//
// grossProfit              = cumulative profit from winning trades only
// settledProviderAmount    = provider share already settled (accumulates)
//
// Losses never offset future winnings: each profitable trade immediately
// earns TOPTIER its percentage. A monthly BotProfitShare row records each
// settlement so the owner can see "what is owed for this period". The broker
// pays the owner directly (the app tracks amounts, it does not move money).

import { db } from '@/lib/db'

export interface ProfitShareSummary {
  connectionId: string
  realizedPnl: number
  grossProfit: number
  providerSharePct: number
  dueAmount: number
  settledProviderAmount: number
}

export function summarizeConnection(connection: {
  id: string
  realizedPnl: number
  grossProfit: number
  settledProviderAmount: number
  providerSharePct: number
}): ProfitShareSummary {
  const totalShare = connection.grossProfit * (connection.providerSharePct / 100)
  const dueAmount = Math.max(0, totalShare - connection.settledProviderAmount)
  return {
    connectionId: connection.id,
    realizedPnl: connection.realizedPnl,
    grossProfit: connection.grossProfit,
    providerSharePct: connection.providerSharePct,
    dueAmount,
    settledProviderAmount: connection.settledProviderAmount,
  }
}

export const BotProfitShareService = {
  /** Recompute realizedPnl and grossProfit for a connection from its stored trades. */
  async recomputeProfit(connectionId: string): Promise<{ realizedPnl: number; grossProfit: number }> {
    const trades = await db.botTrade.findMany({
      where: { connectionId },
      select: { profit: true },
    })
    let realizedPnl = 0
    let grossProfit = 0
    for (const t of trades) {
      realizedPnl += t.profit
      if (t.profit > 0) grossProfit += t.profit
    }
    await db.botConnection.update({
      where: { id: connectionId },
      data: { realizedPnl, grossProfit },
    })
    return { realizedPnl, grossProfit }
  },

  /** @deprecated kept for compatibility — use recomputeProfit */
  async recomputeRealizedPnl(connectionId: string): Promise<number> {
    const { realizedPnl } = await this.recomputeProfit(connectionId)
    return realizedPnl
  },

  async getSummary(connectionId: string): Promise<ProfitShareSummary> {
    const connection = await db.botConnection.findUnique({ where: { id: connectionId } })
    if (!connection) throw new Error('Connection not found')
    return summarizeConnection(connection)
  },

  /**
   * Finalize the current accounting period (calendar month) for a connection.
   * Idempotent: if a row already exists for this month, UPDATE it with the
   * latest grossProfit/grossLoss/providerAmount so the payout ledger stays
   * current as new trades close throughout the month.
   */
  async settleNow(connectionId: string): Promise<{ settlement: unknown; summary: ProfitShareSummary }> {
    const connection = await db.botConnection.findUnique({ where: { id: connectionId } })
    if (!connection) throw new Error('Connection not found')

    const now = new Date()
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const periodEnd = new Date(now)

    const trades = await db.botTrade.findMany({
      where: { connectionId, closedAt: { not: null, gte: periodStart } },
    })

    let grossProfit = 0
    let grossLoss = 0
    for (const t of trades) {
      if (t.profit > 0) grossProfit += t.profit
      else grossLoss += -t.profit
    }
    const netProfit = grossProfit - grossLoss
    const providerAmount = grossProfit * (connection.providerSharePct / 100)
    const newSettledProviderAmount = connection.settledProviderAmount + providerAmount
    const earningReference = `bot_${connectionId}_${periodStart.toISOString()}`

    const existing = await db.botProfitShare.findFirst({
      where: { connectionId, periodStart },
    })

    if (existing) {
      // Update the existing settlement with latest figures.
      // Only adjust settledProviderAmount by the DELTA (new - old) to avoid
      // double-counting the same month's provider share.
      const providerDelta = providerAmount - existing.providerAmount
      const updatedSettled = connection.settledProviderAmount + providerDelta

      // Find the existing platform earning for this period (if any)
      const existingEarning = providerDelta !== 0
        ? await db.platformEarning.findFirst({ where: { reference: earningReference } })
        : null

      await db.$transaction([
        db.botProfitShare.update({
          where: { id: existing.id },
          data: { grossProfit, grossLoss, netProfit, providerAmount, periodEnd },
        }),
        db.botConnection.update({
          where: { id: connectionId },
          data: { settledProviderAmount: Math.max(0, updatedSettled) },
        }),
        // Keep the platform earning in sync with the latest providerAmount
        ...(providerDelta !== 0
          ? [
              existingEarning
                ? db.platformEarning.update({
                    where: { id: existingEarning.id },
                    data: { amount: providerAmount },
                  })
                : db.platformEarning.create({
                    data: {
                      source: 'bot_profit_share',
                      amount: providerAmount,
                      reference: earningReference,
                    },
                  }),
            ]
          : []),
      ])
      const updated = await db.botConnection.findUnique({ where: { id: connectionId } })
      return { settlement: existing, summary: summarizeConnection(updated || connection) }
    }

    // First settlement this month — create new rows
    const settlement = await db.$transaction([
      db.botProfitShare.create({
        data: {
          connectionId,
          userId: connection.userId,
          periodStart,
          periodEnd,
          grossProfit,
          grossLoss,
          netProfit,
          providerSharePct: connection.providerSharePct,
          providerAmount,
          lossCarryforward: 0,
          status: 'due',
        },
      }),
      db.botConnection.update({
        where: { id: connectionId },
        data: { settledProviderAmount: newSettledProviderAmount },
      }),
      ...(providerAmount > 0
        ? [
            db.platformEarning.create({
              data: {
                source: 'bot_profit_share',
                amount: providerAmount,
                reference: earningReference,
              },
            }),
          ]
        : []),
    ])

    const updated = await db.botConnection.findUnique({ where: { id: connectionId } })
    if (!updated) throw new Error('Bot connection not found after settlement')
    return { settlement: settlement[0], summary: summarizeConnection(updated) }
  },
}
