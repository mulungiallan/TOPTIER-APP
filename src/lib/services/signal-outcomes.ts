// src/lib/services/signal-outcomes.ts
// Live outcome monitor for issued trading signals.
//
// Every active signal carries entryPrice / stopLoss / takeProfit1-3 / expiryDate
// but until now NOTHING marked them hit_tp / hit_sl / expired as the market
// moved — so the Signals feed showed stale "active" cards and the performance /
// leaderboard aggregates (which count hit_tp / hit_sl / expired) never filled in.
//
// This service:
//   1. Bulk-expires signals whose expiryDate has passed.
//   2. Compares each still-active signal's STOP/TAKE levels against the CURRENT
//      live price (same Finnhub → Yahoo pipeline every other screen uses).
//   3. Persists status / resultType / resultPrice / resolvedAt for the levels
//      that were hit (BUY: price >= TP then hit_tp, price <= SL then hit_sl;
//      SELL is mirrored). Winner result is the FIRST level actually traded
//      through — using the deepest TP reached when price gaps (tp1→tp3).
//   4. Notifies every admin / super_admin / owner the moment a signal resolves,
//      so they can monitor performance without opening the DB.
//
// It is throttled (30s), guarded against overlapping runs, and cheap per run
// because live quotes are served from live-market-data's 15s cache.

import { db } from '@/lib/db'
import { liveMarketData } from '@/lib/services/live-market-data'
import { notifyUsers } from '@/lib/services/notifications'

const ADMIN_ROLES = ['admin', 'super_admin', 'owner']
const THROTTLE_MS = 30_000
const BATCH_LIMIT = 400
const MAX_NOTIFICATIONS_PER_BATCH = 12

type OutcomeStatus = 'hit_tp' | 'hit_sl'
type ResultType = 'tp1' | 'tp2' | 'tp3' | 'sl' | 'expired'

interface ActiveSignalLite {
  id: string
  type: string
  asset: string
  entryPrice: number
  stopLoss: number
  takeProfit1: number
  takeProfit2: number | null
  takeProfit3: number | null
  confidence: number
  expiryDate: Date
}

export type { ActiveSignalLite }

export interface Outcome {
  status: OutcomeStatus
  resultType: ResultType
  resultPrice: number
}

export function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n >= 10) return n.toFixed(2)
  return n.toFixed(4)
}

/**
 * Classify whether a live price has traded through a signal's levels.
 * Returns the DEEPEST TP reached (when price gaps through tp1 → tp2 → tp3)
 * or the SL, and null when the signal is still in play.
 */
export function classifySignalOutcome(signal: ActiveSignalLite, price: number): Outcome | null {
  const { type, entryPrice, stopLoss, takeProfit1, takeProfit2, takeProfit3 } = signal
  if (!Number.isFinite(price) || price <= 0) return null
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) return null
  if (!Number.isFinite(takeProfit1) || takeProfit1 <= 0) return null

  const isBuy = type.toUpperCase() === 'BUY'
  if (isBuy) {
    if (takeProfit3 && Number.isFinite(takeProfit3) && price >= takeProfit3) {
      return { status: 'hit_tp', resultType: 'tp3', resultPrice: price }
    }
    if (takeProfit2 && Number.isFinite(takeProfit2) && price >= takeProfit2) {
      return { status: 'hit_tp', resultType: 'tp2', resultPrice: price }
    }
    if (price >= takeProfit1) return { status: 'hit_tp', resultType: 'tp1', resultPrice: price }
    if (price <= stopLoss) return { status: 'hit_sl', resultType: 'sl', resultPrice: price }
  } else {
    if (takeProfit3 && Number.isFinite(takeProfit3) && price <= takeProfit3) {
      return { status: 'hit_tp', resultType: 'tp3', resultPrice: price }
    }
    if (takeProfit2 && Number.isFinite(takeProfit2) && price <= takeProfit2) {
      return { status: 'hit_tp', resultType: 'tp2', resultPrice: price }
    }
    if (price <= takeProfit1) return { status: 'hit_tp', resultType: 'tp1', resultPrice: price }
    if (price >= stopLoss) return { status: 'hit_sl', resultType: 'sl', resultPrice: price }
  }

  return null
}

interface PendingResolution {
  signal: ActiveSignalLite
  outcome: Outcome
}

export class SignalOutcomeMonitor {
  private lastRun = 0
  private running = false

  /**
   * Throttled entry point. Call from API routes (fire-and-forget) and from the
   * background interval — overlapping/concurrent runs are coalesced.
   */
  async ensureOutcomes(force = false): Promise<void> {
    const now = Date.now()
    if (!force && now - this.lastRun < THROTTLE_MS) return
    if (this.running) return
    this.lastRun = now
    this.running = true
    try {
      await this.resolveBatch()
    } catch (err) {
      console.error('[signal-outcomes] batch failed:', err)
    } finally {
      this.running = false
    }
  }

  /** Start the self-healing background loop (called once from instrumentation). */
  startBackgroundMonitor(): void {
    const tick = () => {
      void this.ensureOutcomes().catch(() => {})
    }
    setTimeout(() => {
      void this.ensureOutcomes(true).catch(() => {})
    }, 8_000)
    const timer = setInterval(tick, 60_000)
    if (typeof timer.unref === 'function') timer.unref()
  }

  private async resolveBatch(): Promise<void> {
    // 1. Sweep anything already past expiry -> expired (bulk, no live price needed).
    const expirySweep = await db.signal.updateMany({
      where: { status: 'active', expiryDate: { lte: new Date() } },
      data: { status: 'expired', resultType: 'expired', resolvedAt: new Date() },
    })

    // 2. Load the active signals that still have trading time left.
    const active = await db.signal.findMany({
      where: { status: 'active', expiryDate: { gt: new Date() } },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'asc' }],
      take: BATCH_LIMIT,
      select: {
        id: true,
        type: true,
        asset: true,
        entryPrice: true,
        stopLoss: true,
        takeProfit1: true,
        takeProfit2: true,
        takeProfit3: true,
        confidence: true,
        expiryDate: true,
      },
    })

    if (active.length === 0) return
    if (expirySweep.count > 0) {
      console.log(`[signal-outcomes] expired ${expirySweep.count} stale signal(s)`)
    }

    // 3. Fetch live prices for every distinct asset in the batch (15s cache).
    const assets = [...new Set(active.map(s => s.asset))]
    const prices = await liveMarketData.getMultiplePrices(assets)

    // 4. Classify each signal against its current live price.
    const resolved: PendingResolution[] = []
    for (const signal of active) {
      const live = prices.get(signal.asset)
      if (!live) continue
      const outcome = classifySignalOutcome(signal, live.price)
      if (outcome) resolved.push({ signal, outcome })
    }

    if (resolved.length === 0) return

    // 5. Persist only the transitions that actually happen (id + active guard),
    //    collecting the ones worth notifying about.
    const applied: PendingResolution[] = []
    for (const r of resolved) {
      const updated = await db.signal.updateMany({
        where: { id: r.signal.id, status: 'active' },
        data: {
          status: r.outcome.status,
          resultType: r.outcome.resultType,
          resultPrice: r.outcome.resultPrice,
          resolvedAt: new Date(),
        },
      })
      if (updated.count > 0) applied.push(r)
    }

    if (applied.length === 0) return

    // 6. Notify admins about each resolved signal (capped per batch to avoid
    //    a notification flood when several signals pop at once).
    const administrators = await db.user.findMany({
      where: { role: { in: ADMIN_ROLES }, isBanned: false },
      select: { id: true, email: true, notificationPrefs: true },
    })
    if (administrators.length === 0) return

    for (const r of applied.slice(0, MAX_NOTIFICATIONS_PER_BATCH)) {
      const { signal, outcome } = r
      const { title, message } = this.notificationCopy(signal, outcome)
      await notifyUsers(administrators, {
        type: 'signal_result',
        title,
        message,
        actionUrl: '/signals',
      })
    }
    console.log(
      `[signal-outcomes] resolved ${applied.length} signal(s) -> notified ${administrators.length} admin(s)`
    )
  }

  private notificationCopy(
    signal: ActiveSignalLite,
    outcome: Outcome
  ): { title: string; message: string } {
    const entry = signal.entryPrice
    const result = outcome.resultPrice
    const isBuy = signal.type.toUpperCase() === 'BUY'
    const pnlPct = ((isBuy ? result - entry : entry - result) / entry) * 100
    const pnl = (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%'

    const levelLabel: Record<ResultType, string> = {
      tp1: 'TP1',
      tp2: 'TP2',
      tp3: 'TP3',
      sl: 'SL',
      expired: 'EXPIRED',
    }

    if (outcome.status === 'hit_tp') {
      return {
        title: `TP ${levelLabel[outcome.resultType]} HIT — ${signal.asset}`,
        message:
          `${signal.type} ${signal.asset} reached ${levelLabel[outcome.resultType]} ` +
          `@ ${fmtPrice(result)} (entry ${fmtPrice(entry)} · ${pnl} · confidence ${signal.confidence}%)`,
      }
    }
    if (outcome.status === 'hit_sl') {
      return {
        title: `SL HIT — ${signal.asset}`,
        message:
          `${signal.type} ${signal.asset} stopped out @ ${fmtPrice(result)} ` +
          `(entry ${fmtPrice(entry)} · ${pnl} · confidence ${signal.confidence}%)`,
      }
    }
    return {
      title: `Signal EXPIRED — ${signal.asset}`,
      message: `${signal.type} ${signal.asset} expired without reaching TP/SL`,
    }
  }
}

export const signalOutcomes = new SignalOutcomeMonitor()