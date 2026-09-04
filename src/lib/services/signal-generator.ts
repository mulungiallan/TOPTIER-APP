/**
 * TOPTIER Auto Signal Generator
 *
 * Computes algorithmic trading signals (BUY / SELL / NEUTRAL) from REAL market
 * data using deterministic technical indicators (SMA crossover, RSI, momentum).
 * This keeps the Signals page populated automatically — no manual/admin entry
 * required — while never fabricating prices.
 *
 * Signals are derived from real OHLCV candles and real-time quotes provided by
 * the existing market-data services (Yahoo Finance primary, Finnhub fallback).
 * If live data cannot be fetched for a symbol, that symbol is skipped — we do
 * NOT generate a signal from guessed prices.
 */

import { db } from '@/lib/db'
import { liveMarketData } from '@/lib/services/live-market-data'

// ─── Signal targets ─────────────────────────────────────────────────────────

interface SignalTarget {
  symbol: string          // TOPTIER asset label (e.g. "BTC/USD")
  marketType: string      // forex | crypto | stocks | indices | commodities
  strategy: string        // scalp | swing
  timeframe: string       // 1h | 4h | 1d
}

// A curated, representative set of liquid instruments across all markets. Each
// is supported by the market-data layer (Yahoo primary, Finnhub fallback).
const SIGNAL_TARGETS: SignalTarget[] = [
  { symbol: 'EUR/USD', marketType: 'forex', strategy: 'scalp', timeframe: '1h' },
  { symbol: 'GBP/USD', marketType: 'forex', strategy: 'scalp', timeframe: '1h' },
  { symbol: 'USD/JPY', marketType: 'forex', strategy: 'scalp', timeframe: '1h' },
  { symbol: 'AUD/USD', marketType: 'forex', strategy: 'scalp', timeframe: '1h' },
  { symbol: 'BTC/USD', marketType: 'crypto', strategy: 'swing', timeframe: '4h' },
  { symbol: 'ETH/USD', marketType: 'crypto', strategy: 'swing', timeframe: '4h' },
  { symbol: 'XRP/USD', marketType: 'crypto', strategy: 'swing', timeframe: '4h' },
  { symbol: 'AAPL', marketType: 'stocks', strategy: 'swing', timeframe: '1d' },
  { symbol: 'TSLA', marketType: 'stocks', strategy: 'swing', timeframe: '1d' },
  { symbol: 'MSFT', marketType: 'stocks', strategy: 'swing', timeframe: '1d' },
  { symbol: 'NVDA', marketType: 'stocks', strategy: 'swing', timeframe: '1d' },
  { symbol: 'SPX500', marketType: 'indices', strategy: 'swing', timeframe: '1d' },
  { symbol: 'NASDAQ', marketType: 'indices', strategy: 'swing', timeframe: '1d' },
  { symbol: 'GOLD', marketType: 'commodities', strategy: 'swing', timeframe: '4h' },
  { symbol: 'SILVER', marketType: 'commodities', strategy: 'swing', timeframe: '4h' },
  { symbol: 'OIL', marketType: 'commodities', strategy: 'swing', timeframe: '4h' },
]

// ─── Indicator helpers ───────────────────────────────────────────────────────

interface IndicatorSet {
  sma20: number
  sma50: number
  rsi14: number
  momentum: number // % change over last 10 periods
  lastClose: number
}

function sma(values: number[], period: number): number {
  if (values.length < period) return NaN
  const slice = values.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return NaN
  let gains = 0
  let losses = 0
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  if (losses === 0) return 100
  const rs = gains / losses
  return 100 - 100 / (1 + rs)
}

function computeIndicators(closes: number[]): IndicatorSet | null {
  if (closes.length < 60) return null
  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)
  const rsi14 = rsi(closes, 14)
  const lastClose = closes[closes.length - 1]
  const past = closes[closes.length - 11]
  const momentum = past > 0 ? ((lastClose - past) / past) * 100 : 0

  if (![sma20, sma50, rsi14].every(Number.isFinite)) return null
  return { sma20, sma50, rsi14, momentum, lastClose }
}

// ─── Risk / level derivation ─────────────────────────────────────────────────

function deriveLevels(signal: 'BUY' | 'SELL', price: number, candles: Array<{ high: number; low: number; close: number }>) {
  // Average true-range-ish spread over recent candles, clamped so we never
  // produce absurd, illogical levels.
  const closes = candles.map((c) => c.close)
  const recent = candles.slice(-20)
  const avgRange = recent.reduce((acc, c) => acc + (c.high - c.low), 0) / Math.max(1, recent.length)
  const range = avgRange > 0 ? avgRange : Math.max(price * 0.001, 0.001)
  const stopDist = Math.max(range * 1.2, price * 0.0005)

  const entry = price
  const stop = signal === 'BUY' ? entry - stopDist : entry + stopDist
  const tp1 = signal === 'BUY' ? entry + stopDist * 1.5 : entry - stopDist * 1.5
  const tp2 = signal === 'BUY' ? entry + stopDist * 2.5 : entry - stopDist * 2.5
  const tp3 = signal === 'BUY' ? entry + stopDist * 4 : entry - stopDist * 4
  const rr = stopDist > 0 ? Math.round((Math.abs(tp1 - entry) / stopDist) * 10) / 10 : 1.5

  return { entry, stop, tp1, tp2, tp3, rr, stopDist }
}

// ─── Signal decision ─────────────────────────────────────────────────────────

function decideSignal(ind: IndicatorSet): {
  direction: 'BUY' | 'SELL' | 'NEUTRAL'
  confidence: number
  reason: string
} {
  const { sma20, sma50, rsi14, momentum, lastClose } = ind

  const smaBull = sma20 > sma50
  const priceAboveSma = lastClose > sma20
  const rsiScore =
    rsi14 < 30 ? 1 : rsi14 > 70 ? -1 : 0 // oversold → +1, overbought → -1
  const momentumScore = momentum > 0.5 ? 1 : momentum < -0.5 ? -1 : 0

  const trendScore = (smaBull ? 1 : -1) + (priceAboveSma ? 1 : -1)
  const total = trendScore + rsiScore + momentumScore

  // Require a clean, consistent edge before emitting a directional signal.
  if (total >= 3) {
    const confidence = Math.min(80, 55 + rsiScore * 8 + Math.min(5, Math.abs(momentum)))
    return {
      direction: 'BUY',
      confidence,
      reason: `Trending up (SMA20 ${smaBull ? '>' : '<'} SMA50), RSI ${rsi14.toFixed(0)}, momentum +${momentum.toFixed(2)}%.`,
    }
  }
  if (total <= -3) {
    const confidence = Math.min(80, 55 + Math.abs(rsiScore) * 8 + Math.min(5, Math.abs(momentum)))
    return {
      direction: 'SELL',
      confidence,
      reason: `Trending down (SMA20 ${smaBull ? '>' : '<'} SMA50), RSI ${rsi14.toFixed(0)}, momentum ${momentum.toFixed(2)}%.`,
    }
  }

  return {
    direction: 'NEUTRAL',
    confidence: 45,
    reason: `Mixed signals — SMA20 ${smaBull ? 'above' : 'below'} SMA50, RSI ${rsi14.toFixed(0)}, momentum ${momentum.toFixed(2)}%. Standing aside.`,
  }
}

// ─── Generation ──────────────────────────────────────────────────────────────

function confidenceToInt(c: number): number {
  return Math.min(100, Math.max(0, Math.round(c)))
}

/**
 * Generate a fresh set of signals and persist them into the Signal table.
 * Expired/inactive signals are cleaned up first so the feed stays meaningful.
 * Safe to call on every GET — it is throttled by a short in-memory TTL.
 */
export class SignalGenerator {
  private lastRun = 0
  private static REFRESH_MS = 10 * 60 * 1000 // regenerate at most every 10 min

  /**
   * Ensure the Signal table is populated with recent, real-data signals.
   * Returns true if it generated signals (i.e. the table now has data).
   */
  async ensureSignals(force = false): Promise<boolean> {
    const now = Date.now()

    // Throttle: if we generated recently, only check whether data still exists.
    const recentActive = await db.signal.count({
      where: { status: 'active', expiryDate: { gt: new Date() } },
    })
    if (!force && recentActive > 0) {
      return recentActive > 0
    }
    if (!force && now - this.lastRun < SignalGenerator.REFRESH_MS) {
      return recentActive > 0
    }

    this.lastRun = now
    return this.generateBatch()
  }

  private async generateBatch(): Promise<boolean> {
    // Clean up stale signals first so the feed always shows fresh entries.
    await db.signal.updateMany({
      where: { status: 'active', expiryDate: { lte: new Date() } },
      data: { status: 'expired' },
    })

    let stored = 0

    for (const target of SIGNAL_TARGETS) {
      try {
        const created = await this.generateForSymbol(target)
        if (created) stored++
      } catch (err) {
        console.warn(
          `[signal-generator] skipped ${target.symbol}:`,
          err instanceof Error ? err.message : err
        )
      }
      // Small stagger to respect Yahoo/Finnhub rate limits.
      await new Promise((r) => setTimeout(r, 250))
    }

    return stored > 0
  }

  private async generateForSymbol(target: SignalTarget): Promise<boolean> {
    const resolution: '60' | 'D' = target.timeframe === '1h' ? '60' : 'D'
    const candles = await liveMarketData.getHistoricalData(
      target.symbol,
      resolution,
      120
    )
    if (!candles || candles.length < 60) return false

    const closes = candles.map((c) => c.close).filter((n) => Number.isFinite(n))
    const ind = computeIndicators(closes)
    if (!ind) return false

    const live = await liveMarketData.getPrice(target.symbol)
    const currentPrice = live ? live.price : candles[candles.length - 1].close
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false

    const decision = decideSignal(ind)
    const direction = decision.direction

    if (direction === 'NEUTRAL') {
      // Skip persisting neutral rows — the feed should only show actionable calls.
      return false
    }

    const levels = deriveLevels(direction, currentPrice, candles)

    // Persist a fresh active signal (remove any prior generation for this key
    // first so we never accumulate duplicates across refresh cycles).
    const expiry = new Date(Date.now() + (target.timeframe === '1h' ? 4 : 24) * 60 * 60 * 1000)
    const generatedKey = `${target.symbol}:${direction}:${target.timeframe}`

    await db.signal.deleteMany({ where: { generatedKey } })
    await db.signal.create({
      data: {
        generatedKey,
        type: direction,
        asset: target.symbol,
        entryPrice: levels.entry,
        stopLoss: levels.stop,
        takeProfit1: levels.tp1,
        takeProfit2: levels.tp2,
        takeProfit3: levels.tp3,
        riskRewardRatio: levels.rr,
        confidence: confidenceToInt(decision.confidence),
        strategy: target.strategy,
        timeframe: target.timeframe,
        reason: decision.reason,
        status: 'active',
        expiryDate: expiry,
        marketType: target.marketType,
      },
    })

    return true
  }
}

// Singleton
export const signalGenerator = new SignalGenerator()
