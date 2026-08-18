import { db } from '@/lib/db'
import { binanceWithdrawHistory } from '@/lib/payments/binance-payout'

// ─── Platform payout ledger helpers ─────────────────────────────────────────

// Lazy-accrue: convert completed payment transactions into platform earnings.
// Every completed PaymentTransaction becomes an available earning exactly once
// (matched by the transaction id in `reference`). Payments from users who were
// referred (via a referral link) are bucketed separately as referral_revenue so
// copy-trading, referral and bot money stay in their own tracked categories.
export async function accrueEarnings(): Promise<number> {
  const completed = await db.paymentTransaction.findMany({
    where: { status: 'completed' },
    select: { id: true, amount: true, currency: true, user: { select: { referredBy: true } } },
  })

  if (completed.length === 0) return 0

  const references = completed.map((t) => t.id)
  const existing = await db.platformEarning.findMany({
    where: { reference: { in: references } },
    select: { reference: true },
  })
  const already = new Set(existing.map((e) => e.reference))

  const toCreate = completed
    .filter((t) => !already.has(t.id))
    .map((t) => ({
      source: t.user?.referredBy ? 'referral_revenue' : 'premium_payment',
      amount: t.amount,
      currency: t.currency || 'USD',
      reference: t.id,
    }))

  if (toCreate.length > 0) {
    await db.platformEarning.createMany({ data: toCreate })
  }
  return toCreate.length
}

// Convert settled bot profit-share rows (BotProfitShare with providerAmount)
// into platform earnings. Same deterministic reference as settleNow() so a
// period is never counted twice — this catches rows created before the payout
// wiring existed, and is a no-op for periods already accrued.
export async function accrueBotProfitShareEarnings(): Promise<number> {
  const dueShares = await db.botProfitShare.findMany({
    where: { providerAmount: { gt: 0 } },
    select: { connectionId: true, periodStart: true, providerAmount: true },
  })
  if (dueShares.length === 0) return 0

  const references = dueShares.map((s) => `bot_${s.connectionId}_${s.periodStart.toISOString()}`)
  const existing = await db.platformEarning.findMany({
    where: { reference: { in: references } },
    select: { reference: true },
  })
  const already = new Set(existing.map((e) => e.reference))

  const toCreate = dueShares
    .filter((s) => !already.has(`bot_${s.connectionId}_${s.periodStart.toISOString()}`))
    .map((s) => ({
      source: 'bot_profit_share',
      amount: s.providerAmount,
      reference: `bot_${s.connectionId}_${s.periodStart.toISOString()}`,
    }))

  if (toCreate.length > 0) {
    await db.platformEarning.createMany({ data: toCreate })
  }
  return toCreate.length
}

// Lazy-accrue: convert copy-trading settlements with platformAmount > 0 into
// platform earnings. Same reference as mirrorMasterClose() so a settlement is
// never counted twice — this catches rows created before the payout wiring
// existed, or if the inline PlatformEarning.create() failed transiently.
export async function accrueCopyFeeEarnings(): Promise<number> {
  const dueSettlements = await db.copySettlement.findMany({
    where: { platformAmount: { gt: 0 } },
    select: { id: true, copyTradeId: true, source: true, platformAmount: true },
  })
  if (dueSettlements.length === 0) return 0

  const references = dueSettlements.map((s) =>
    s.source === 'master' ? `master_${s.copyTradeId || s.id}` : `copy_${s.id}`
  )
  const existing = await db.platformEarning.findMany({
    where: { reference: { in: references } },
    select: { reference: true },
  })
  const already = new Set(existing.map((e) => e.reference))

  const toCreate = dueSettlements
    .filter((s, i) => !already.has(references[i]))
    .map((s, i) => ({
      source: 'copy_fee',
      amount: s.platformAmount,
      reference: references[i],
    }))

  if (toCreate.length > 0) {
    await db.platformEarning.createMany({ data: toCreate })
  }
  return toCreate.length
}

export async function getAvailableBalance(): Promise<{ available: number; paid: number; currency: string }> {
  await accrueEarnings()
  await accrueBotProfitShareEarnings()
  await accrueCopyFeeEarnings()
  await syncPayoutStatuses()
  const [availableAgg, paidAgg, inFlight] = await Promise.all([
    db.platformEarning.aggregate({
      where: { status: 'available', currency: 'USD' },
      _sum: { amount: true },
    }),
    db.platformEarning.aggregate({
      where: { status: 'paid', currency: 'USD' },
      _sum: { amount: true },
    }),
    db.payoutRequest.aggregate({
      where: { status: { in: ['pending', 'processing'] }, currency: 'USD' },
      _sum: { amount: true },
    }),
  ])

  const gross = availableAgg._sum.amount || 0
  const reserved = inFlight._sum.amount || 0

  return {
    available: Math.max(0, gross - reserved),
    paid: paidAgg._sum.amount || 0,
    currency: 'USD',
  }
}

// Mark the oldest available earnings as paid until a payout amount is covered.
// If the last earning is only partially needed, split it: mark the original as
// paid and create a remainder earning so no value is over-deducted.
export async function buildPaidEarningsUpdates(netAmount: number) {
  const earnings = await db.platformEarning.findMany({
    where: { status: 'available' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amount: true, source: true, currency: true, reference: true },
  })

  let remaining = netAmount
  const updates: any[] = []
  for (const e of earnings) {
    if (remaining <= 0) break
    if (remaining >= e.amount) {
      // Fully cover this earning
      updates.push(db.platformEarning.update({
        where: { id: e.id },
        data: { status: 'paid', paidAt: new Date() },
      }))
      remaining -= e.amount
    } else {
      // Partially cover: split the earning
      const paidPortion = remaining
      const remainder = e.amount - paidPortion
      updates.push(db.platformEarning.update({
        where: { id: e.id },
        data: { amount: paidPortion, status: 'paid', paidAt: new Date() },
      }))
      updates.push(db.platformEarning.create({
        data: {
          source: e.source,
          amount: remainder,
          currency: e.currency,
          reference: e.reference ? `${e.reference}_remainder` : undefined,
          status: 'available',
        },
      }))
      remaining = 0
    }
  }
  return updates
}

// Binance withdrawal status codes (GET /sapi/v1/capital/withdraw/history):
//   6 = completed, 1 = cancelled, 3 = rejected, 5 = failure.
const BINANCE_STATUS_COMPLETED = 6
const BINANCE_STATUS_FAILED = [1, 3, 5]

// Reconcile 'processing' Binance payouts against Binance's withdrawal history.
// Completed withdrawals flip to 'paid' (and mark the covered earnings paid);
// rejected/cancelled/failed ones flip to 'failed' and release their reserve.
// Best-effort and idempotent — safe to call on every balance load.
export async function syncPayoutStatuses(): Promise<number> {
  const processing = await db.payoutRequest.findMany({
    where: { method: 'binance', status: 'processing', txHash: { not: null } },
    select: { id: true, txHash: true, netAmount: true },
  })
  if (processing.length === 0) return 0

  const byId = new Map<string, { status: number; statusDesc?: string; txId?: string }>()
  try {
    const records = await binanceWithdrawHistory(processing.length === 1 ? (processing[0].txHash as string) : undefined)
    for (const r of records) {
      if (r.id) byId.set(r.id, { status: r.status, statusDesc: r.statusDesc, txId: r.txId })
    }
    // A brand-new withdrawal can be missing from the history endpoint for a
    // short window; if nothing matched, pull the recent history once.
    if (byId.size === 0) {
      for (const r of await binanceWithdrawHistory()) {
        if (r.id) byId.set(r.id, { status: r.status, statusDesc: r.statusDesc, txId: r.txId })
      }
    }
  } catch {
    return 0
  }

  let synced = 0
  for (const payout of processing) {
    const rec = byId.get(payout.txHash as string)
    if (!rec) continue

    if (rec.status === BINANCE_STATUS_COMPLETED) {
      await db.$transaction([
        db.payoutRequest.update({
          where: { id: payout.id },
          data: { status: 'paid', paidAt: new Date(), txHash: rec.txId || payout.txHash },
        }),
        ...(await buildPaidEarningsUpdates(payout.netAmount)),
      ])
      synced++
    } else if (BINANCE_STATUS_FAILED.includes(rec.status)) {
      await db.payoutRequest.update({
        where: { id: payout.id },
        data: { status: 'failed', failureReason: `Binance: ${rec.statusDesc || `status ${rec.status}`}` },
      })
      synced++
    }
  }
  return synced
}

export interface EarningsBySourceEntry {
  source: string
  total: number
  available: number
  paid: number
}

// Sum platform earnings per category (copy_fee, referral_revenue,
// bot_profit_share, premium_payment, ads_revenue) so each money stream is
// tracked separately. Lazy-accrues first so the figures are always current.
export async function getEarningsBySource(): Promise<EarningsBySourceEntry[]> {
  await accrueEarnings()
  await accrueBotProfitShareEarnings()
  await accrueCopyFeeEarnings()

  const [all, paid] = await Promise.all([
    db.platformEarning.groupBy({ by: ['source'], _sum: { amount: true } }),
    db.platformEarning.groupBy({ by: ['source'], where: { status: 'paid' }, _sum: { amount: true } }),
  ])

  const paidBySource = new Map(paid.map((r) => [r.source, r._sum.amount || 0]))

  return all
    .map((r) => {
      const total = r._sum.amount || 0
      const paidAmount = paidBySource.get(r.source) || 0
      return {
        source: r.source,
        total,
        available: Math.max(0, total - paidAmount),
        paid: paidAmount,
      }
    })
    .sort((a, b) => b.total - a.total)
}
