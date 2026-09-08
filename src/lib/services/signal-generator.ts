/**
 * TOPTIER Auto Signal Generator (merged with files-2 engine)
 *
 * Generates algorithmic BUY / SELL signals from REAL market data using the
 * multi-timeframe confluence engine ported from files (2):
 *
 *   - Three independent strategies (trend, mean reversion, breakout)
 *   - Weighted confluence scorer (trend 0.35, momentum 0.25, vol 0.15, volume 0.25)
 *   - Only emits when score >= 0.6
 *   - ATR-based trade plan with mandatory min 2:1 reward:risk
 *   - Styles: scalp (15m→1h), intraday_swing (1h→1d), swing (1d self-confirm)
 *
 * Signals are derived from real OHLCV candles via the existing market-data layer
 * (Yahoo Finance primary, Finnhub fallback). No fabricated prices.
 */

import { db } from '@/lib/db'
import { liveMarketData, type HistoricalCandle } from '@/lib/services/live-market-data'
import {
  type CandleInput,
  type StyleId,
  resolutionsFor,
  analyzeSignal,
  deriveLevels,
  STYLE_CONFIG,
} from '@/lib/services/signal-engine'

// ─── Signal targets ─────────────────────────────────────────────────────────

interface SignalTarget {
  symbol: string
  marketType: string
  style: StyleId
}

const FOREX_MAJORS: SignalTarget[] = [
  { symbol: 'EUR/USD', marketType: 'forex', style: 'scalp' },
  { symbol: 'GBP/USD', marketType: 'forex', style: 'scalp' },
  { symbol: 'USD/JPY', marketType: 'forex', style: 'scalp' },
  { symbol: 'USD/CHF', marketType: 'forex', style: 'scalp' },
  { symbol: 'AUD/USD', marketType: 'forex', style: 'scalp' },
  { symbol: 'USD/CAD', marketType: 'forex', style: 'scalp' },
  { symbol: 'NZD/USD', marketType: 'forex', style: 'scalp' },
]

const FOREX_CROSSES: SignalTarget[] = [
  { symbol: 'EUR/GBP', marketType: 'forex', style: 'scalp' },
  { symbol: 'EUR/JPY', marketType: 'forex', style: 'scalp' },
  { symbol: 'GBP/JPY', marketType: 'forex', style: 'scalp' },
  { symbol: 'AUD/JPY', marketType: 'forex', style: 'scalp' },
  { symbol: 'CAD/JPY', marketType: 'forex', style: 'scalp' },
  { symbol: 'CHF/JPY', marketType: 'forex', style: 'scalp' },
  { symbol: 'EUR/CHF', marketType: 'forex', style: 'scalp' },
  { symbol: 'EUR/AUD', marketType: 'forex', style: 'scalp' },
  { symbol: 'EUR/CAD', marketType: 'forex', style: 'scalp' },
  { symbol: 'GBP/CHF', marketType: 'forex', style: 'scalp' },
  { symbol: 'GBP/AUD', marketType: 'forex', style: 'scalp' },
  { symbol: 'GBP/CAD', marketType: 'forex', style: 'scalp' },
  { symbol: 'AUD/CAD', marketType: 'forex', style: 'scalp' },
  { symbol: 'AUD/CHF', marketType: 'forex', style: 'scalp' },
  { symbol: 'AUD/NZD', marketType: 'forex', style: 'scalp' },
  { symbol: 'NZD/JPY', marketType: 'forex', style: 'scalp' },
  { symbol: 'NZD/CAD', marketType: 'forex', style: 'scalp' },
  { symbol: 'NZD/CHF', marketType: 'forex', style: 'scalp' },
]

const FOREX_EXOTICS: SignalTarget[] = [
  { symbol: 'USD/ZAR', marketType: 'forex', style: 'intraday_swing' },
  { symbol: 'USD/TRY', marketType: 'forex', style: 'intraday_swing' },
  { symbol: 'USD/MXN', marketType: 'forex', style: 'intraday_swing' },
  { symbol: 'USD/SGD', marketType: 'forex', style: 'intraday_swing' },
  { symbol: 'USD/NOK', marketType: 'forex', style: 'intraday_swing' },
  { symbol: 'USD/SEK', marketType: 'forex', style: 'intraday_swing' },
  { symbol: 'USD/PLN', marketType: 'forex', style: 'intraday_swing' },
  { symbol: 'USD/HUF', marketType: 'forex', style: 'intraday_swing' },
  { symbol: 'USD/CZK', marketType: 'forex', style: 'intraday_swing' },
  { symbol: 'USD/THB', marketType: 'forex', style: 'intraday_swing' },
  { symbol: 'USD/KRW', marketType: 'forex', style: 'intraday_swing' },
  { symbol: 'USD/INR', marketType: 'forex', style: 'intraday_swing' },
  { symbol: 'USD/BRL', marketType: 'forex', style: 'intraday_swing' },
]

const CRYPTO_PAIRS: SignalTarget[] = [
  { symbol: 'BTC/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'ETH/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'SOL/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'XRP/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'LTC/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'ADA/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'BNB/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'DOGE/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'AVAX/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'LINK/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'DOT/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'POL/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'UNI/USD', marketType: 'crypto', style: 'swing' },
  { symbol: 'TON/USD', marketType: 'crypto', style: 'swing' },
]

const INDEX_TARGETS: SignalTarget[] = [
  { symbol: 'SPX500', marketType: 'indices', style: 'swing' },
  { symbol: 'NASDAQ', marketType: 'indices', style: 'swing' },
  { symbol: 'DOW', marketType: 'indices', style: 'swing' },
  { symbol: 'DAX', marketType: 'indices', style: 'swing' },
  { symbol: 'FTSE', marketType: 'indices', style: 'swing' },
  { symbol: 'NIKKEI', marketType: 'indices', style: 'swing' },
]

const COMMODITY_TARGETS: SignalTarget[] = [
  { symbol: 'GOLD', marketType: 'commodities', style: 'intraday_swing' },
  { symbol: 'SILVER', marketType: 'commodities', style: 'intraday_swing' },
  { symbol: 'OIL', marketType: 'commodities', style: 'intraday_swing' },
  { symbol: 'BRENT', marketType: 'commodities', style: 'intraday_swing' },
  { symbol: 'COPPER', marketType: 'commodities', style: 'intraday_swing' },
  { symbol: 'NATGAS', marketType: 'commodities', style: 'intraday_swing' },
  { symbol: 'PLATINUM', marketType: 'commodities', style: 'intraday_swing' },
  { symbol: 'PALLADIUM', marketType: 'commodities', style: 'intraday_swing' },
]

const STOCK_TARGETS: SignalTarget[] = [
  { symbol: 'AAPL', marketType: 'stocks', style: 'swing' },
  { symbol: 'MSFT', marketType: 'stocks', style: 'swing' },
  { symbol: 'GOOGL', marketType: 'stocks', style: 'swing' },
  { symbol: 'AMZN', marketType: 'stocks', style: 'swing' },
  { symbol: 'META', marketType: 'stocks', style: 'swing' },
  { symbol: 'NVDA', marketType: 'stocks', style: 'swing' },
  { symbol: 'TSLA', marketType: 'stocks', style: 'swing' },
  { symbol: 'NFLX', marketType: 'stocks', style: 'swing' },
  { symbol: 'AMD', marketType: 'stocks', style: 'swing' },
  { symbol: 'INTC', marketType: 'stocks', style: 'swing' },
  { symbol: 'JPM', marketType: 'stocks', style: 'swing' },
  { symbol: 'BAC', marketType: 'stocks', style: 'swing' },
  { symbol: 'V', marketType: 'stocks', style: 'swing' },
  { symbol: 'MA', marketType: 'stocks', style: 'swing' },
  { symbol: 'JNJ', marketType: 'stocks', style: 'swing' },
  { symbol: 'UNH', marketType: 'stocks', style: 'swing' },
  { symbol: 'PG', marketType: 'stocks', style: 'swing' },
  { symbol: 'KO', marketType: 'stocks', style: 'swing' },
  { symbol: 'DIS', marketType: 'stocks', style: 'swing' },
  { symbol: 'MCD', marketType: 'stocks', style: 'swing' },
  { symbol: 'WMT', marketType: 'stocks', style: 'swing' },
  { symbol: 'COST', marketType: 'stocks', style: 'swing' },
  { symbol: 'ORCL', marketType: 'stocks', style: 'swing' },
  { symbol: 'CRM', marketType: 'stocks', style: 'swing' },
]

const SIGNAL_TARGETS: SignalTarget[] = [
  ...FOREX_MAJORS,
  ...FOREX_CROSSES,
  ...FOREX_EXOTICS,
  ...CRYPTO_PAIRS,
  ...INDEX_TARGETS,
  ...COMMODITY_TARGETS,
  ...STOCK_TARGETS,
]

// ─── Candle conversion ──────────────────────────────────────────────────────

function toCandleInput(candles: HistoricalCandle[]): CandleInput[] {
  return candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }))
}

// ─── Generation ──────────────────────────────────────────────────────────────

export class SignalGenerator {
  private lastRun = Date.now()
  private running = false
  private static REFRESH_MS = 5 * 60 * 1000
  private static STAGGER_MS = 300

  async ensureSignals(force = false): Promise<boolean> {
    const now = Date.now()

    const recentActive = await db.signal.count({
      where: { status: 'active', expiryDate: { gt: new Date() } },
    })

    const pastTtl = now - this.lastRun >= SignalGenerator.REFRESH_MS
    if (!force && !pastTtl && recentActive > 0) {
      return true
    }

    if (this.running) return true

    this.lastRun = now
    this.running = true
    void this.generateBatch().finally(() => {
      this.running = false
    })
    return true
  }

  startBackgroundRefresh(): void {
    const loop = () => void this.ensureSignals(false)
    setTimeout(loop, 3000)
    setInterval(loop, SignalGenerator.REFRESH_MS)
  }

  private async generateBatch(): Promise<boolean> {
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
      await new Promise((r) => setTimeout(r, SignalGenerator.STAGGER_MS))
    }

    return stored > 0
  }

  private async generateForSymbol(target: SignalTarget): Promise<boolean> {
    const { entry: entryRes, confirm: confirmRes } = resolutionsFor(target.style)

    // Entry timeframe candles (need >= 80 for indicator warm-up)
    const entryRaw = await liveMarketData.getHistoricalData(target.symbol, entryRes, 120)
    if (!entryRaw || entryRaw.length < 60) return false
    const entryCandles = toCandleInput(entryRaw)

    // Confirmation timeframe candles (same resolution = reuse the same fetch)
    let confirmCandles: CandleInput[] | null = null
    if (entryRes !== confirmRes) {
      const confirmRaw = await liveMarketData.getHistoricalData(target.symbol, confirmRes, 120)
      if (confirmRaw && confirmRaw.length >= 60) {
        confirmCandles = toCandleInput(confirmRaw)
      }
    }

    // Run the multi-timeframe confluence engine
    const result = analyzeSignal(entryCandles, confirmCandles, target.style)
    if (!result) return false

    // Get live price for entry (engine score is based on the last candle close)
    const live = await liveMarketData.getPrice(target.symbol)
    const currentPrice = live ? live.price : entryCandles[entryCandles.length - 1].close
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false

    // ATR-based trade levels (minimum 2:1 R:R from the engine)
    const levels = deriveLevels(result.direction, currentPrice, result.atr14)

    // Map engine style → DB strategy field (for filter compatibility)
    const cfg = STYLE_CONFIG[target.style]
    const strategyKey = cfg.strategy // 'scalp' or 'swing'

    // Expiry based on style
    const expiry = new Date(Date.now() + cfg.expiryHours * 60 * 60 * 1000)

    // Confluence score as the canonical confidence (already 0-100 from engine)
    const confidence = Math.max(1, Math.min(99, result.confidence))

    // Reason string includes the style label for UI display
    const reasonWithStyle = `[${cfg.entryLabel}→${cfg.confirmLabel}] ${result.reason}`

    const generatedKey = `${target.symbol}:${result.direction}:${target.style}`

    // Upsert: remove any prior generation for this key so we never duplicate
    await db.signal.deleteMany({ where: { generatedKey } })
    await db.signal.create({
      data: {
        generatedKey,
        type: result.direction,
        asset: target.symbol,
        entryPrice: levels.entry,
        stopLoss: levels.stop,
        takeProfit1: levels.target1,
        takeProfit2: levels.target2,
        takeProfit3: levels.target3,
        riskRewardRatio: levels.riskReward,
        confidence,
        strategy: strategyKey,
        style: target.style,
        timeframe: cfg.entryLabel,
        reason: reasonWithStyle,
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
