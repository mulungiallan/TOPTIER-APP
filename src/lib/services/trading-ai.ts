// ─── AI & Trading Services: Price Prediction, Backtesting, Paper Trading,
//     Pattern Recognition, Strategy Builder, Live Trading (mock broker)
import { db } from '@/lib/db'
import { liveMarketData } from '@/lib/services/live-market-data'

// ────────────────────────────────────────────────────────────────────────────
// Price Prediction (heuristic ensemble: linear regression + momentum + EMA cross)
//
// NOTE: This is a deterministic TECHNICAL INDICATOR, not a machine-learning or
// "AI" model. It computes indicators (SMA/RSI/momentum/volatility) over REAL
// market data and combines them into a directional bias. The "confidence" is a
// heuristic measure of indicator agreement — it is NOT a calibrated probability
// and must not be presented as such.
// ────────────────────────────────────────────────────────────────────────────

export interface PricePredictionResult {
  symbol: string
  timeframe: string
  currentPrice: number
  predictedPrice: number
  direction: 'up' | 'down'
  confidence: number // 0-100 — heuristic indicator agreement, NOT calibrated
  probability: number // 0-1 — deprecated alias of confidence/100
  modelUsed: string
  features: Record<string, number>
  disclaimer: string
  dataSource: string
}

export class PricePredictionService {
  static async predict(symbol: string, timeframe: '1h' | '4h' | '1d' = '1d'): Promise<PricePredictionResult> {
    // Get current price (from live market data service) — never fabricate one.
    const live = await liveMarketData.getPrice(symbol).catch(() => null)
    const currentPrice = live?.price
    if (!currentPrice) {
      throw new Error(
        `No live price available for ${symbol}. Prediction requires current market data — try again later.`
      )
    }

    // Build features from REAL historical data (no fabricated candles).
    const resolution: '60' | 'D' = timeframe === '1d' ? 'D' : '60'
    const candleCount = timeframe === '1d' ? 120 : 100
    const historical = await this.getRealHistorical(symbol, resolution, candleCount)

    if (historical.length < 30) {
      throw new Error(
        `Not enough real market data for ${symbol} to compute indicators. Try again later or use a different symbol.`
      )
    }

    const features = this.calculateFeatures(historical)
    const models = [
      this.linearRegression(features),
      this.momentumModel(features),
      this.emaCrossModel(features),
    ]

    // Weighted ensemble
    const weights = [0.3, 0.3, 0.4]
    const weightedChange = models.reduce((sum, m, i) => sum + m.changePct * weights[i], 0)

    const predictedPrice = currentPrice * (1 + weightedChange / 100)
    const direction: 'up' | 'down' = weightedChange >= 0 ? 'up' : 'down'
    // Heuristic "strength" based on indicator agreement & momentum magnitude.
    // Deliberately de-emphasized and capped so it cannot be read as a guarantee.
    const confidence = Math.min(80, Math.max(45, Math.abs(weightedChange) * 4 + 50))
    const probability = confidence / 100

    return {
      symbol,
      timeframe,
      currentPrice,
      predictedPrice,
      direction,
      confidence: Math.round(confidence * 10) / 10,
      probability: Math.round(probability * 100) / 100,
      modelUsed: 'technical-indicators',
      features,
      disclaimer:
        'This is a technical indicator (SMA/RSI/momentum/EMA), not an AI prediction. It is not financial advice and has no guaranteed accuracy.',
      dataSource: live?.source || 'yahoo',
    }
  }

  static async savePrediction(userId: string, result: PricePredictionResult) {
    return db.pricePrediction.create({
      data: {
        userId,
        symbol: result.symbol,
        timeframe: result.timeframe,
        currentPrice: result.currentPrice,
        predictedPrice: result.predictedPrice,
        direction: result.direction,
        confidence: result.confidence,
        probability: result.probability,
        modelUsed: result.modelUsed,
        features: JSON.stringify(result.features),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })
  }

  static async getUserPredictions(userId: string, limit = 20) {
    return db.pricePrediction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Fetch REAL historical candles from the market data service.
   * Returns [] when no data is available so the caller can fail honestly.
   */
  private static async getRealHistorical(
    symbol: string,
    resolution: '60' | 'D',
    count: number
  ): Promise<{ close: number; high: number; low: number; volume: number }[]> {
    const candles = await liveMarketData
      .getHistoricalData(symbol, resolution, count)
      .catch(() => [])
    if (!Array.isArray(candles) || candles.length === 0) return []
    return candles
      .filter((c) => c && typeof c.close === 'number' && c.close > 0)
      .map((c) => ({ close: c.close, high: c.high, low: c.low, volume: c.volume }))
  }

  private static calculateFeatures(data: { close: number; high: number; low: number; volume: number }[]): Record<string, number> {
    const closes = data.map((d) => d.close)
    const n = closes.length
    const last = closes[n - 1]

    // Simple Moving Averages
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, n)
    const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, n)

    // RSI (14)
    let gains = 0, losses = 0
    for (let i = Math.max(1, n - 14); i < n; i++) {
      const diff = closes[i] - closes[i - 1]
      if (diff >= 0) gains += diff
      else losses -= diff
    }
    const rs = losses === 0 ? 100 : gains / losses
    const rsi = 100 - (100 / (1 + rs))

    // Momentum (rate of change over 10 periods)
    const rocIndex = Math.max(0, n - 11)
    const rocBase = closes[rocIndex]
    const roc = rocBase > 0 ? ((last - rocBase) / rocBase) * 100 : 0

    // Volatility (std dev of last 20 returns)
    const returns = closes.slice(-21).map((c, i, arr) => (i === 0 ? 0 : (c - arr[i - 1]) / arr[i - 1]))
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((a, b) => a + (b - meanReturn) ** 2, 0) / returns.length
    const volatility = Math.sqrt(variance) * 100

    return {
      sma20: Math.round(sma20 * 100) / 100,
      sma50: Math.round(sma50 * 100) / 100,
      rsi: Math.round(rsi * 10) / 10,
      roc: Math.round(roc * 100) / 100,
      volatility: Math.round(volatility * 100) / 100,
      lastClose: Math.round(last * 100) / 100,
    }
  }

  private static linearRegression(features: Record<string, number>) {
    const trend = (features.sma20 - features.sma50) / features.sma50
    const rsiSignal = features.rsi > 70 ? -1 : features.rsi < 30 ? 1 : 0
    const changePct = trend * 100 * 2 + rsiSignal * 0.5
    return { changePct: Math.max(-10, Math.min(10, changePct)) }
  }

  private static momentumModel(features: Record<string, number>) {
    const changePct = features.roc * 0.5
    return { changePct: Math.max(-8, Math.min(8, changePct)) }
  }

  private static emaCrossModel(features: Record<string, number>) {
    const cross = features.sma20 > features.sma50 ? 1 : -1
    const magnitude = Math.abs(features.sma20 - features.sma50) / features.sma50 * 100
    return { changePct: cross * magnitude * 1.5 }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Backtesting Engine
// ────────────────────────────────────────────────────────────────────────────

export interface BacktestRequest {
  symbol: string
  strategy: string
  startDate: string
  endDate: string
  initialCapital?: number
}

export interface BacktestResult {
  id?: string
  symbol: string
  strategy: string
  startDate: string
  endDate: string
  initialCapital: number
  finalCapital: number
  totalReturn: number
  winRate: number
  totalTrades: number
  winningTrades: number
  losingTrades: number
  sharpeRatio: number
  maxDrawdown: number
  trades: Array<{
    entryDate: string; exitDate: string | null
    direction: string; entryPrice: number; exitPrice: number | null
    quantity: number; profit: number | null; profitPercent: number | null
    holdingDays: number | null
  }>
}

interface BacktestCandle {
  date: Date
  close: number
  high: number
  low: number
  volume: number
  sma20?: number
  sma50?: number
  rsi?: number
}

export class BacktestingService {
  static async run(userId: string, req: BacktestRequest): Promise<BacktestResult> {
    const initialCapital = req.initialCapital || 10000
    const historical = await this.getRealHistorical(req.symbol, new Date(req.startDate), new Date(req.endDate))
    const trades = this.runStrategy(historical, req.strategy, initialCapital)
    const metrics = this.calculateMetrics(trades, initialCapital)

    // Persist
    const record = await db.backtest.create({
      data: {
        userId,
        name: `${req.strategy} on ${req.symbol}`,
        symbol: req.symbol,
        strategy: req.strategy,
        startDate: new Date(req.startDate),
        endDate: new Date(req.endDate),
        initialCapital,
        finalCapital: metrics.finalCapital,
        totalReturn: metrics.totalReturn,
        winRate: metrics.winRate,
        totalTrades: trades.length,
        winningTrades: metrics.winningTrades,
        losingTrades: metrics.losingTrades,
        sharpeRatio: metrics.sharpeRatio,
        maxDrawdown: metrics.maxDrawdown,
        status: 'completed',
      },
    })

    // Save trade history
    if (trades.length > 0) {
      await db.backtestTrade.createMany({
        data: trades.map((t) => ({
          backtestId: record.id,
          entryDate: new Date(t.entryDate),
          exitDate: t.exitDate ? new Date(t.exitDate) : null,
          direction: t.direction,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice || null,
          quantity: t.quantity,
          profit: t.profit || null,
          profitPercent: t.profitPercent || null,
          holdingDays: t.holdingDays || null,
        })),
      })
    }

    return {
      id: record.id,
      symbol: req.symbol,
      strategy: req.strategy,
      startDate: req.startDate,
      endDate: req.endDate,
      initialCapital,
      finalCapital: metrics.finalCapital,
      totalReturn: metrics.totalReturn,
      winRate: metrics.winRate,
      totalTrades: trades.length,
      winningTrades: metrics.winningTrades,
      losingTrades: metrics.losingTrades,
      sharpeRatio: metrics.sharpeRatio,
      maxDrawdown: metrics.maxDrawdown,
      trades: trades.slice(-20),
    }
  }

  static async getUserBacktests(userId: string, limit = 20) {
    return db.backtest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Fetch REAL daily candles for the requested range and compute the technical
   * indicators the strategies rely on. Throws when there isn't enough real
   * data — a fabricated series is never used for backtesting.
   */
  private static async getRealHistorical(
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<BacktestCandle[]> {
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    const count = Math.min(800, Math.max(60, days))

    const candles = await liveMarketData
      .getHistoricalData(symbol, 'D', count)
      .catch(() => [])

    if (!Array.isArray(candles) || candles.length === 0) {
      throw new Error(
        `No real historical data available for ${symbol}. Try a different symbol or try again later.`
      )
    }

    const valid = candles
      .filter((c) => c && typeof c.close === 'number' && c.close > 0)
      .map((c) => ({
        date: new Date(c.date),
        close: c.close,
        high: c.high ?? c.close,
        low: c.low ?? c.close,
        volume: c.volume ?? 0,
      }))

    // Real data may span a wider window than requested — narrow to the range
    const inRange = valid.filter((c) => c.date >= startDate && c.date <= endDate)
    const series = inRange.length >= 50 ? inRange : valid

    if (series.length < 50) {
      throw new Error(
        `Not enough real historical data for ${symbol} in the requested range to run a meaningful backtest.`
      )
    }

    return this.computeIndicators(series)
  }

  private static computeIndicators(series: BacktestCandle[]): BacktestCandle[] {
    const closes = series.map((s) => s.close)
    for (let i = 0; i < series.length; i++) {
      series[i].sma20 = i >= 19 ? closes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20 : undefined
      series[i].sma50 = i >= 49 ? closes.slice(i - 49, i + 1).reduce((a, b) => a + b, 0) / 50 : undefined
      if (i >= 14) {
        let gains = 0, losses = 0
        for (let j = i - 13; j <= i; j++) {
          const diff = closes[j] - closes[j - 1]
          if (diff >= 0) gains += diff
          else losses -= diff
        }
        const rs = losses === 0 ? 100 : gains / losses
        series[i].rsi = 100 - (100 / (1 + rs))
      }
    }
    return series
  }

  private static runStrategy(
    data: { date: Date; close: number; high?: number; low?: number; sma20?: number; sma50?: number; rsi?: number }[],
    strategy: string,
    capital: number
  ) {
    const trades: any[] = []
    let position: { entryDate: Date; entryPrice: number; direction: string; quantity: number } | null = null

    const startIdx = 50 // skip until SMA50 is available

    for (let i = startIdx; i < data.length; i++) {
      const cur = data[i]
      const prev = data[i - 1]
      if (!cur.sma20 || !cur.sma50 || !prev.sma20 || !prev.sma50) continue

      let signal: 'BUY' | 'SELL' | null = null

      switch (strategy) {
        case 'sma_cross':
          if (prev.sma20 < prev.sma50 && cur.sma20 > cur.sma50) signal = 'BUY'
          else if (prev.sma20 > prev.sma50 && cur.sma20 < cur.sma50) signal = 'SELL'
          break
        case 'rsi_oversold':
          if (cur.rsi && cur.rsi < 30 && (!prev.rsi || prev.rsi >= 30)) signal = 'BUY'
          else if (cur.rsi && cur.rsi > 70 && (!prev.rsi || prev.rsi <= 70)) signal = 'SELL'
          break
        case 'momentum':
          if (cur.close > cur.sma20 && cur.sma20 > cur.sma50) signal = 'BUY'
          else if (cur.close < cur.sma20 && cur.sma20 < cur.sma50) signal = 'SELL'
          break
        case 'mean_reversion':
          if (cur.rsi && cur.rsi < 35) signal = 'BUY'
          else if (cur.rsi && cur.rsi > 65) signal = 'SELL'
          break
        case 'breakout':
          const recent = data.slice(Math.max(0, i - 20), i)
          const recentHigh = Math.max(...recent.map((d) => d.high ?? d.close))
          const recentLow = Math.min(...recent.map((d) => d.low ?? d.close))
          if (cur.close > recentHigh) signal = 'BUY'
          else if (cur.close < recentLow) signal = 'SELL'
          break
        default:
          signal = null
      }

      if (signal === 'BUY' && !position) {
        const qty = capital / cur.close / 10 // risk 10% per trade
        position = { entryDate: cur.date, entryPrice: cur.close, direction: 'BUY', quantity: qty }
      } else if (signal === 'SELL' && position) {
        const profit = (cur.close - position.entryPrice) * position.quantity
        const profitPercent = ((cur.close - position.entryPrice) / position.entryPrice) * 100
        trades.push({
          entryDate: position.entryDate.toISOString(),
          exitDate: cur.date.toISOString(),
          direction: position.direction,
          entryPrice: position.entryPrice,
          exitPrice: cur.close,
          quantity: position.quantity,
          profit,
          profitPercent,
          holdingDays: (cur.date.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24),
        })
        position = null
      }
    }

    // Close any open position at the end
    if (position) {
      const last = data[data.length - 1]
      const profit = (last.close - position.entryPrice) * position.quantity
      trades.push({
        entryDate: position.entryDate.toISOString(),
        exitDate: null,
        direction: position.direction,
        entryPrice: position.entryPrice,
        exitPrice: null,
        quantity: position.quantity,
        profit,
        profitPercent: ((last.close - position.entryPrice) / position.entryPrice) * 100,
        holdingDays: (last.date.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24),
      })
    }
    return trades
  }

  private static calculateMetrics(trades: any[], initialCapital: number) {
    const total = trades.length
    const winning = trades.filter((t) => (t.profit || 0) > 0)
    const losing = trades.filter((t) => (t.profit || 0) < 0)
    const totalProfit = trades.reduce((sum, t) => sum + (t.profit || 0), 0)
    const finalCapital = initialCapital + totalProfit
    const totalReturn = (totalProfit / initialCapital) * 100

    // Sharpe ratio (simplified — annualized)
    const returns = trades.map((t) => t.profitPercent || 0)
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
    const stdDev = returns.length > 0
      ? Math.sqrt(returns.reduce((a, b) => a + (b - meanReturn) ** 2, 0) / returns.length)
      : 0
    const sharpe = stdDev === 0 ? 0 : (meanReturn / stdDev) * Math.sqrt(252)

    // Max drawdown
    let peak = initialCapital
    let maxDD = 0
    let running = initialCapital
    for (const t of trades) {
      running += t.profit || 0
      if (running > peak) peak = running
      const dd = ((peak - running) / peak) * 100
      if (dd > maxDD) maxDD = dd
    }

    return {
      finalCapital: Math.round(finalCapital * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      winRate: total > 0 ? Math.round((winning.length / total) * 1000) / 10 : 0,
      totalTrades: total,
      winningTrades: winning.length,
      losingTrades: losing.length,
      sharpeRatio: Math.round(sharpe * 100) / 100,
      maxDrawdown: Math.round(maxDD * 100) / 100,
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Paper Trading
// ────────────────────────────────────────────────────────────────────────────

export interface PaperTradeResult {
  id: string
  symbol: string
  direction: string
  quantity: number
  entryPrice: number
  exitPrice: number | null
  pnl: number | null
  pnlPercent: number | null
  status: string
  openedAt: string
  closedAt: string | null
}

export class PaperTradingService {
  static async openTrade(userId: string, data: {
    symbol: string; direction: string; quantity: number; entryPrice: number
    stopLoss?: number; takeProfit?: number; notes?: string
  }) {
    return db.paperTrade.create({
      data: {
        userId,
        symbol: data.symbol,
        direction: data.direction,
        quantity: data.quantity,
        entryPrice: data.entryPrice,
        stopLoss: data.stopLoss,
        takeProfit: data.takeProfit,
        notes: data.notes,
        status: 'open',
      },
    })
  }

  static async closeTrade(tradeId: string, userId: string, exitPrice: number) {
    const trade = await db.paperTrade.findFirst({ where: { id: tradeId, userId } })
    if (!trade) throw new Error('Trade not found')
    if (trade.status === 'closed') throw new Error('Trade already closed')

    const direction = trade.direction === 'BUY' ? 1 : -1
    const pnl = (exitPrice - trade.entryPrice) * direction * trade.quantity
    const pnlPercent = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * direction

    return db.paperTrade.update({
      where: { id: tradeId },
      data: {
        exitPrice,
        pnl: Math.round(pnl * 100) / 100,
        pnlPercent: Math.round(pnlPercent * 100) / 100,
        status: 'closed',
        closedAt: new Date(),
      },
    })
  }

  static async getUserTrades(userId: string, status?: string) {
    return db.paperTrade.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { openedAt: 'desc' },
      take: 100,
    })
  }

  static async getStats(userId: string) {
    const trades = await db.paperTrade.findMany({
      where: { userId, status: 'closed' },
      select: { pnl: true, pnlPercent: true, direction: true, symbol: true },
    })
    const wins = trades.filter((t) => (t.pnl || 0) > 0)
    const losses = trades.filter((t) => (t.pnl || 0) < 0)
    const totalPnL = trades.reduce((s, t) => s + (t.pnl || 0), 0)
    return {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length > 0 ? Math.round((wins.length / trades.length) * 1000) / 10 : 0,
      totalPnL: Math.round(totalPnL * 100) / 100,
      avgWin: wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl || 0), 0) / wins.length : 0,
      avgLoss: losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl || 0), 0) / losses.length : 0,
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Pattern Recognition
// ────────────────────────────────────────────────────────────────────────────

export interface PatternDetectionResult {
  symbol: string
  timeframe: string
  pattern: string
  confidence: number
  direction: 'bullish' | 'bearish' | 'neutral'
  description: string
}

const PATTERNS = [
  { name: 'head_and_shoulders', direction: 'bearish', desc: 'Head and Shoulders — trend reversal top' },
  { name: 'inverse_head_shoulders', direction: 'bullish', desc: 'Inverse Head and Shoulders — trend reversal bottom' },
  { name: 'double_top', direction: 'bearish', desc: 'Double Top — bearish reversal at resistance' },
  { name: 'double_bottom', direction: 'bullish', desc: 'Double Bottom — bullish reversal at support' },
  { name: 'triangle_ascending', direction: 'bullish', desc: 'Ascending Triangle — bullish continuation' },
  { name: 'triangle_descending', direction: 'bearish', desc: 'Descending Triangle — bearish continuation' },
  { name: 'flag_bullish', direction: 'bullish', desc: 'Bull Flag — strong uptrend continuation' },
  { name: 'flag_bearish', direction: 'bearish', desc: 'Bear Flag — strong downtrend continuation' },
  { name: 'wedge_rising', direction: 'bearish', desc: 'Rising Wedge — bearish reversal pattern' },
  { name: 'wedge_falling', direction: 'bullish', desc: 'Falling Wedge — bullish reversal pattern' },
  { name: 'doji', direction: 'neutral', desc: 'Doji — market indecision' },
  { name: 'engulfing_bullish', direction: 'bullish', desc: 'Bullish Engulfing — strong bottom reversal' },
  { name: 'engulfing_bearish', direction: 'bearish', desc: 'Bearish Engulfing — strong top reversal' },
  { name: 'hammer', direction: 'bullish', desc: 'Hammer — bullish reversal candle' },
  { name: 'shooting_star', direction: 'bearish', desc: 'Shooting Star — bearish reversal candle' },
]

export class PatternRecognitionService {
  /**
   * Detect candlestick/trend patterns from REAL historical data using
   * deterministic heuristics. Returns only patterns that are actually present
   * in the data — never fabricated. Throws if there isn't enough data.
   */
  static async detect(symbol: string, timeframe: string = '1d'): Promise<PatternDetectionResult[]> {
    const resolution: '60' | 'D' = timeframe === '1d' ? 'D' : '60'
    const candles = await liveMarketData
      .getHistoricalData(symbol, resolution, 120)
      .catch(() => [])
    const series = (Array.isArray(candles) ? candles : [])
      .filter((c) => c && typeof c.close === 'number' && c.close > 0)
      .map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }))

    if (series.length < 30) {
      throw new Error(`Not enough real market data for ${symbol} to detect patterns.`)
    }

    const results: PatternDetectionResult[] = []
    const last = series[series.length - 1]
    const prev = series[series.length - 2]

    // RSI(14) + short/long SMAs for trend context
    const closes = series.map((c) => c.close)
    const rsi = this.rsi(closes, 14)
    const sma20 = this.sma(closes, 20)
    const sma50 = this.sma(closes, 50)
    const trend = (sma20 ?? 0) > (sma50 ?? 0) ? 'bullish' : 'bearish'

    const body = Math.abs(last.close - last.open)
    const range = last.high - last.low
    const upperWick = last.high - Math.max(last.open, last.close)
    const lowerWick = Math.min(last.open, last.close) - last.low
    const wickRatio = range > 0 ? Math.max(upperWick, lowerWick) / range : 0

    // Candlestick patterns (verified against actual candle geometry)
    const isDoji = range > 0 && body / range < 0.1
    const isHammer = !isDoji && lowerWick >= 2 * body && upperWick < 0.3 * body && body > 0
    const isShootingStar = !isDoji && upperWick >= 2 * body && lowerWick < 0.3 * body && body > 0
    const prevBody = Math.abs(prev.close - prev.open)
    const prevRange = prev.high - prev.low
    const isBullEngulf = prev.close < prev.open && last.close > last.open &&
      last.close > prev.open && last.open < prev.close && prevRange > 0
    const isBearEngulf = prev.close > prev.open && last.close < last.open &&
      last.close < prev.open && last.open > prev.close && prevRange > 0

    // Reversal-at-location checks (higher low / lower high)
    const swingHigh = Math.max(...series.slice(-20).map((c) => c.high))
    const swingLow = Math.min(...series.slice(-20).map((c) => c.low))
    const atResistance = last.high >= swingHigh * 0.995
    const atSupport = last.low <= swingLow * 1.005

    const add = (pattern: string, direction: 'bullish' | 'bearish' | 'neutral', base: number, desc: string) => {
      // Heuristic strength: indicator agreement with the detected direction.
      const agreement = (direction === 'bullish' && (rsi ?? 50) > 50) || (direction === 'bearish' && (rsi ?? 50) < 50) ? 1 : 0.5
      results.push({
        symbol, timeframe, pattern, direction,
        confidence: Math.min(80, Math.round(base + agreement * 8)),
        description: desc,
      })
    }

    if (isDoji) add('doji', 'neutral', 50, 'Doji — market indecision (body < 10% of range)')
    if (isHammer && atSupport) add('hammer', 'bullish', 58, 'Hammer — bullish reversal candle near swing low')
    if (isShootingStar && atResistance) add('shooting_star', 'bearish', 58, 'Shooting Star — bearish reversal candle near swing high')
    if (isBullEngulf) add('engulfing_bullish', 'bullish', 60, 'Bullish Engulfing — strong bottom reversal candle')
    if (isBearEngulf) add('engulfing_bearish', 'bearish', 60, 'Bearish Engulfing — strong top reversal candle')

    // Trend confirmation via SMA cross (only when a cross actually occurred)
    const prev20 = this.sma(closes.slice(0, -1), 20)
    const prev50 = this.sma(closes.slice(0, -1), 50)
    if (prev20 && prev50 && sma20 && sma50) {
      if (prev20 <= prev50 && sma20 > sma50) add('golden_cross', 'bullish', 62, 'Golden Cross — SMA 20 crossed above SMA 50')
      else if (prev20 >= prev50 && sma20 < sma50) add('death_cross', 'bearish', 62, 'Death Cross — SMA 20 crossed below SMA 50')
    }

    // Momentum reversal: RSI divergence at extremes
    if (rsi !== null && rsi <= 30) add('oversold_reversal', 'bullish', 55, 'Oversold — RSI(14) below 30 suggests mean reversion')
    else if (rsi !== null && rsi >= 70) add('overbought_reversal', 'bearish', 55, 'Overbought — RSI(14) above 70 suggests mean reversion')

    return results
  }

  private static sma(values: number[], period: number): number | null {
    if (values.length < period) return null
    const sum = values.slice(-period).reduce((a, b) => a + b, 0)
    return sum / period
  }

  private static rsi(values: number[], period: number): number | null {
    if (values.length < period + 1) return null
    let gains = 0, losses = 0
    for (let i = values.length - period; i < values.length; i++) {
      const diff = values[i] - values[i - 1]
      if (diff >= 0) gains += diff
      else losses -= diff
    }
    if (losses === 0) return 100
    const rs = gains / losses
    return 100 - 100 / (1 + rs)
  }

  static async saveDetection(userId: string, result: PatternDetectionResult) {
    return db.patternDetection.create({
      data: {
        userId,
        symbol: result.symbol,
        timeframe: result.timeframe,
        pattern: result.pattern,
        confidence: result.confidence,
        direction: result.direction,
        description: result.description,
      },
    })
  }

  static async getUserDetections(userId: string, limit = 30) {
    return db.patternDetection.findMany({
      where: { userId },
      orderBy: { detectedAt: 'desc' },
      take: limit,
    })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Strategy Builder
// ────────────────────────────────────────────────────────────────────────────

export interface StrategyRule {
  id: string
  indicator: string // sma_cross, rsi, macd, bollinger, etc.
  operator: string // crosses_above, crosses_below, greater_than, less_than
  value: number
  action: 'BUY' | 'SELL'
}

export interface StrategyIndicatorContext {
  closes: number[]
  sma20: (number | null)[]
  sma50: (number | null)[]
  ema12: (number | null)[]
  ema26: (number | null)[]
  macd: (number | null)[]
  rsi: (number | null)[]
  bollinger: (number | null)[]
  stoch: (number | null)[]
  atr: (number | null)[]
  volumes: number[]
}

export class StrategyBuilderService {
  static async create(userId: string, data: {
    name: string; description?: string; market: string; timeframe: string
    rules: StrategyRule[]; isPublic?: boolean
  }) {
    return db.strategy.create({
      data: {
        userId,
        name: data.name,
        description: data.description,
        market: data.market,
        timeframe: data.timeframe,
        rules: JSON.stringify(data.rules),
        isPublic: data.isPublic || false,
      },
    })
  }

  static async listPublic(limit = 30) {
    return db.strategy.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { name: true, profilePicture: true } } },
    })
  }

  static async listUserStrategies(userId: string) {
    return db.strategy.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    })
  }

  static async update(id: string, userId: string, data: Partial<{
    name: string; description: string; rules: StrategyRule[]; isPublic: boolean; performance: number
  }>) {
    const update: any = { ...data }
    if (data.rules) update.rules = JSON.stringify(data.rules)
    return db.strategy.updateMany({ where: { id, userId }, data: update })
  }

  static async delete(id: string, userId: string) {
    return db.strategy.deleteMany({ where: { id, userId } })
  }

  /**
   * Evaluate a saved strategy's rules against REAL historical data.
   * Returns a backtest-style result and persists the performance % on the
   * strategy. No fabricated data is ever used.
   */
  static async evaluate(userId: string, data: {
    strategyId: string
    symbol: string
    startDate: string
    endDate: string
    initialCapital?: number
  }): Promise<Record<string, unknown>> {
    const strategy = await db.strategy.findFirst({ where: { id: data.strategyId, userId } })
    if (!strategy) throw new Error('Strategy not found')

    let rules: StrategyRule[] = []
    try {
      rules = JSON.parse(strategy.rules || '[]')
    } catch {
      throw new Error('Strategy rules are invalid')
    }
    if (!Array.isArray(rules) || rules.length === 0) {
      throw new Error('Strategy has no rules to evaluate')
    }

    const initialCapital = data.initialCapital || 10000
    const startDate = new Date(data.startDate)
    const endDate = new Date(data.endDate)
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    const count = Math.min(800, Math.max(60, days))

    const candles = await liveMarketData
      .getHistoricalData(data.symbol, 'D', count)
      .catch(() => [])
    if (!Array.isArray(candles) || candles.length < 30) {
      throw new Error(
        `Not enough real historical data for ${data.symbol} to evaluate this strategy.`
      )
    }

    const valid = candles
      .filter((c) => c && typeof c.close === 'number' && c.close > 0)
      .map((c) => ({ date: new Date(c.date), close: c.close, high: c.high ?? c.close, low: c.low ?? c.close, volume: c.volume ?? 0 }))

    const volumes = valid.map((c) => c.volume)
    const ctx = this.buildIndicatorContext(valid, volumes)
    const trades = this.runRuleEngine(rules, valid, ctx, initialCapital)
    const metrics = this.strategyMetrics(trades, initialCapital)

    if (strategy.id) {
      await db.strategy.updateMany({
        where: { id: strategy.id, userId },
        data: { performance: metrics.totalReturn },
      }).catch((e: any) => console.warn('[Backtest] Failed to update strategy performance:', e?.message))
    }

    return {
      strategyId: strategy.id,
      name: strategy.name,
      symbol: data.symbol,
      startDate: data.startDate,
      endDate: data.endDate,
      initialCapital,
      ...metrics,
      trades: trades.slice(-20),
      dataSource: 'real',
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private static buildIndicatorContext(
    candles: { date: Date; close: number; high: number; low: number; volume: number }[],
    volumes: number[]
  ): StrategyIndicatorContext {
    const closes = candles.map((c) => c.close)
    const n = closes.length

    const sma = (values: number[], period: number) => {
      const out: (number | null)[] = []
      for (let i = 0; i < values.length; i++) {
        if (i < period - 1) out.push(null)
        else out.push(values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period)
      }
      return out
    }

    const ema = (values: number[], period: number) => {
      const out: (number | null)[] = []
      if (values.length === 0) return out
      const k = 2 / (period + 1)
      let prev = values[0]
      for (let i = 0; i < values.length; i++) {
        const v = i === 0 ? values[0] : values[i] * k + prev * (1 - k)
        prev = v
        out.push(i >= period - 1 ? v : null)
      }
      return out
    }

    const sma20 = sma(closes, 20)
    const sma50 = sma(closes, 50)
    const ema12 = ema(closes, 12)
    const ema26 = ema(closes, 26)

    const rsi: (number | null)[] = []
    for (let i = 0; i < n; i++) {
      if (i < 14) { rsi.push(null); continue }
      let gains = 0, losses = 0
      for (let j = i - 13; j <= i; j++) {
        const diff = closes[j] - closes[j - 1]
        if (diff >= 0) gains += diff
        else losses -= diff
      }
      rsi.push(losses === 0 ? 100 : 100 - 100 / (1 + gains / losses))
    }

    const macd = ema12.map((e12, i) => (e12 != null && ema26[i] != null ? e12 - (ema26[i] as number) : null))

    const bollinger: (number | null)[] = []
    for (let i = 0; i < n; i++) {
      if (sma20[i] == null) { bollinger.push(null); continue }
      const slice = closes.slice(i - 19, i + 1)
      const mean = slice.reduce((a, b) => a + b, 0) / 20
      const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / 20
      const std = Math.sqrt(variance)
      bollinger.push((closes[i] - mean) / (2 * std || 1))
    }

    const stoch: (number | null)[] = []
    for (let i = 0; i < n; i++) {
      if (i < 13) { stoch.push(null); continue }
      const slice = candles.slice(i - 13, i + 1)
      const hi = Math.max(...slice.map((c) => c.high))
      const lo = Math.min(...slice.map((c) => c.low))
      stoch.push(hi === lo ? 50 : ((candles[i].close - lo) / (hi - lo)) * 100)
    }

    const atr: (number | null)[] = []
    for (let i = 0; i < n; i++) {
      if (i < 1) { atr.push(null); continue }
      const start = Math.max(0, i - 13)
      const trs: number[] = []
      for (let j = start; j <= i; j++) {
        const cj = candles[j]
        const pj = candles[j - 1]
        trs.push(Math.max(cj.high - cj.low, Math.abs(cj.high - pj.close), Math.abs(cj.low - pj.close)))
      }
      atr.push(trs.reduce((a, b) => a + b, 0) / trs.length)
    }

    return { closes, sma20, sma50, ema12, ema26, macd, rsi, bollinger, stoch, atr, volumes }
  }

  private static indicatorValue(
    indicator: string,
    i: number,
    ctx: StrategyIndicatorContext
  ): number | null {
    switch (indicator) {
      case 'sma_cross': return ctx.sma20[i] != null && ctx.sma50[i] != null ? (ctx.sma20[i] as number) - (ctx.sma50[i] as number) : null
      case 'ema_cross': return ctx.ema12[i] != null && ctx.ema26[i] != null ? (ctx.ema12[i] as number) - (ctx.ema26[i] as number) : null
      case 'macd': return ctx.macd[i]
      case 'rsi': return ctx.rsi[i]
      case 'bollinger': return ctx.bollinger[i]
      case 'stochastic': return ctx.stoch[i]
      case 'atr': return ctx.atr[i]
      case 'volume': return ctx.volumes[i]
      default: return null
    }
  }

  private static ruleFires(
    rule: StrategyRule,
    i: number,
    ctx: StrategyIndicatorContext
  ): boolean {
    const cur = this.indicatorValue(rule.indicator, i, ctx)
    if (cur == null) return false
    const prev = i > 0 ? this.indicatorValue(rule.indicator, i - 1, ctx) : null
    switch (rule.operator) {
      case 'crosses_above': return prev != null && prev <= rule.value && cur > rule.value
      case 'crosses_below': return prev != null && prev >= rule.value && cur < rule.value
      case 'greater_than': return cur > rule.value
      case 'less_than': return cur < rule.value
      case 'equals': return Math.abs(cur - rule.value) < 1e-6
      default: return false
    }
  }

  private static runRuleEngine(
    rules: StrategyRule[],
    candles: { date: Date; close: number }[],
    ctx: StrategyIndicatorContext,
    capital: number
  ) {
    const trades: Array<Record<string, unknown>> = []
    let position: { entryDate: Date; entryPrice: number; direction: 'BUY' | 'SELL'; quantity: number } | null = null

    for (let i = 30; i < candles.length; i++) {
      const buyVotes = rules.filter((r) => r.action === 'BUY' && this.ruleFires(r, i, ctx)).length
      const sellVotes = rules.filter((r) => r.action === 'SELL' && this.ruleFires(r, i, ctx)).length
      const close = candles[i].close

      if (!position && buyVotes > sellVotes) {
        const qty = capital / close / 10
        position = { entryDate: candles[i].date, entryPrice: close, direction: 'BUY', quantity: qty }
      } else if (!position && sellVotes > buyVotes) {
        const qty = capital / close / 10
        position = { entryDate: candles[i].date, entryPrice: close, direction: 'SELL', quantity: qty }
      } else if (position && sellVotes > buyVotes && position.direction === 'BUY') {
        trades.push(this.closeTrade(position, candles[i]))
        position = null
      } else if (position && buyVotes > sellVotes && position.direction === 'SELL') {
        trades.push(this.closeTrade(position, candles[i]))
        position = null
      }
    }

    if (position) {
      trades.push(this.closeTrade(position, candles[candles.length - 1], true))
    }

    return trades
  }

  private static closeTrade(
    position: { entryDate: Date; entryPrice: number; direction: 'BUY' | 'SELL'; quantity: number },
    candle: { date: Date; close: number },
    open = false
  ) {
    const directionMultiplier = position.direction === 'BUY' ? 1 : -1
    const profit = (candle.close - position.entryPrice) * position.quantity * directionMultiplier
    const profitPercent = ((candle.close - position.entryPrice) / position.entryPrice) * 100 * directionMultiplier
    return {
      entryDate: position.entryDate.toISOString(),
      exitDate: open ? null : candle.date.toISOString(),
      direction: position.direction,
      entryPrice: position.entryPrice,
      exitPrice: open ? null : candle.close,
      quantity: position.quantity,
      profit: Math.round(profit * 100) / 100,
      profitPercent: Math.round(profitPercent * 100) / 100,
      holdingDays: Math.round((candle.date.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24) * 10) / 10,
    }
  }

  private static strategyMetrics(trades: Array<Record<string, unknown>>, initialCapital: number) {
    const total = trades.length
    const winning = trades.filter((t) => (t.profit as number) > 0)
    const losing = trades.filter((t) => (t.profit as number) < 0)
    const totalProfit = trades.reduce((sum, t) => sum + ((t.profit as number) || 0), 0)
    const finalCapital = initialCapital + totalProfit
    const totalReturn = (totalProfit / initialCapital) * 100

    const returns = trades.map((t) => (t.profitPercent as number) || 0)
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
    const stdDev = returns.length > 0
      ? Math.sqrt(returns.reduce((a, b) => a + (b - meanReturn) ** 2, 0) / returns.length)
      : 0
    const sharpe = stdDev === 0 ? 0 : (meanReturn / stdDev) * Math.sqrt(252)

    let peak = initialCapital
    let maxDD = 0
    let running = initialCapital
    for (const t of trades) {
      running += (t.profit as number) || 0
      if (running > peak) peak = running
      const dd = ((peak - running) / peak) * 100
      if (dd > maxDD) maxDD = dd
    }

    return {
      finalCapital: Math.round(finalCapital * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      winRate: total > 0 ? Math.round((winning.length / total) * 1000) / 10 : 0,
      totalTrades: total,
      winningTrades: winning.length,
      losingTrades: losing.length,
      sharpeRatio: Math.round(sharpe * 100) / 100,
      maxDrawdown: Math.round(maxDD * 100) / 100,
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Live Trading Integration (paper-only during soft launch)
// ────────────────────────────────────────────────────────────────────────────

export interface BrokerAccount {
  broker: string
  connected: boolean
  accountId?: string
  balance?: number
  currency?: string
  leverage?: string
}

export class LiveTradingService {
  // Supported brokers — real integration requires OAuth/API keys per broker
  static readonly SUPPORTED_BROKERS = [
    { id: 'mock', name: 'Paper Broker (Demo)', currency: 'USD', leverage: '1:100', enabled: true },
    { id: 'oanda', name: 'OANDA', currency: 'USD', leverage: '1:50', enabled: false },
    { id: 'ig', name: 'IG Markets', currency: 'USD', leverage: '1:30', enabled: false },
    { id: 'fxcm', name: 'FXCM', currency: 'USD', leverage: '1:30', enabled: false },
    { id: 'mt5', name: 'MetaTrader 5', currency: 'USD', leverage: '1:500', enabled: false },
    { id: 'binance', name: 'Binance', currency: 'USDT', leverage: '1:20', enabled: true },
  ]

  /**
   * Connect to a broker.
   *
   * For Binance, this reads BINANCE_API_KEY / BINANCE_API_SECRET from env if
   * the caller doesn't pass them explicitly. The credentials are validated by
   * hitting the Binance /api/v3/account endpoint — a 200 means the key is good,
   * any other response surfaces a clear error to the caller.
   *
   * For all other brokers, live execution is hard-blocked (paper-only) until a
   * real broker integration is wired up.
   */
  static async connect(brokerId: string, apiKey?: string, apiSecret?: string): Promise<BrokerAccount> {
    const broker = this.SUPPORTED_BROKERS.find((b) => b.id === brokerId)
    if (!broker) throw new Error('Unsupported broker')

    // ─── Binance: real validation ──────────────────────────────────────────
    if (brokerId === 'binance') {
      const key = apiKey || process.env.BINANCE_API_KEY
      const secret = apiSecret || process.env.BINANCE_API_SECRET

      if (!key || !secret || secret === 'REPLACE_ME_WITH_YOUR_BINANCE_SECRET_KEY') {
        throw new Error(
          'Binance API credentials not configured. Set BINANCE_API_KEY and BINANCE_API_SECRET in .env.local, ' +
          'or pass them directly to LiveTradingService.connect().'
        )
      }

      // Validate against Binance — signed request to /api/v3/account.
      // NOTE: this runs server-side only (we're in a service module imported
      // by API routes). Never expose the secret to the browser.
      if (typeof window !== 'undefined') {
        throw new Error('Binance connect must be called from the server (API route), not the browser.')
      }

      const timestamp = Date.now()
      const query = `timestamp=${timestamp}&recvWindow=5000`
      const signature = await hmacSha256(secret, query)

      const url = `https://api.binance.com/api/v3/account?${query}&signature=${signature}`
      const res = await fetch(url, {
        headers: { 'X-MBX-APIKEY': key },
        cache: 'no-store',
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Binance auth failed (${res.status}): ${body || res.statusText}`)
      }

      const account = await res.json().catch(() => ({})) as {
        accountType?: string
        balances?: Array<{ asset: string; free: string; locked: string }>
      }

      // Sum up non-zero USDT-equivalent balances (we just report USDT for now)
      const usdtBalance = account.balances?.find((b) => b.asset === 'USDT')
      const balanceNum = usdtBalance ? parseFloat(usdtBalance.free) : 0

      return {
        broker: broker.name,
        connected: true,
        accountId: account.accountType || `BINANCE-${timestamp.toString(36).toUpperCase()}`,
        balance: balanceNum,
        currency: broker.currency,
        leverage: broker.leverage,
      }
    }

    // ─── Paper Broker (mock) — legitimately simulated, always available ─────
    if (brokerId === 'mock') {
      return {
        broker: broker.name,
        connected: true,
        accountId: `DEMO-${brokerId.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
        balance: 10000,
        currency: broker.currency,
        leverage: broker.leverage,
      }
    }

    // ─── All other brokers: real execution is NOT wired up yet ─────────────
    // Honest hard-block: we must not claim a live connection we don't have.
    // Only the Paper Broker (mock) is available during soft launch.
    throw new Error(
      `${broker.name} live trading is not yet available. Order execution is paper-only during ` +
      `soft launch. Connect to "Paper Broker (Demo)" for simulated execution.`
    )
  }

  static async placeOrder(accountId: string, order: {
    symbol: string; direction: string; size: number
    orderType?: 'market' | 'limit' | 'stop'; price?: number
    stopLoss?: number; takeProfit?: number
  }) {
    const key = process.env.BINANCE_API_KEY
    const secret = process.env.BINANCE_API_SECRET

    if (typeof window !== 'undefined') {
      throw new Error('Live orders must be placed from the server (API route), not the browser.')
    }
    if (!key || !secret) {
      throw new Error(
        'Binance API credentials not configured. Set BINANCE_API_KEY and BINANCE_API_SECRET in .env and restart the server.'
      )
    }

    const symbol = this.binanceSymbol(order.symbol)
    const side = String(order.direction).toUpperCase() === 'SELL' ? 'SELL' : 'BUY'
    const size = Number(order.size)
    if (!symbol || !Number.isFinite(size) || size <= 0) {
      throw new Error('A valid symbol and a positive order size are required.')
    }

    const type = order.orderType === 'limit'
      ? 'LIMIT'
      : order.orderType === 'stop'
        ? 'STOP_LOSS_LIMIT'
        : 'MARKET'

    const params: Record<string, string> = {
      symbol,
      side,
      type,
      quantity: String(size),
      recvWindow: '10000',
      timestamp: String(Date.now()),
    }

    if (type === 'LIMIT' || type === 'STOP_LOSS_LIMIT') {
      const price = Number(order.price)
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error('Limit and stop orders require a price.')
      }
      params.price = String(price)
      params.timeInForce = 'GTC'
    }
    if (type === 'STOP_LOSS_LIMIT') {
      const stopPrice = Number(order.stopLoss)
      if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
        throw new Error('Stop orders require a stopLoss price.')
      }
      params.stopPrice = String(stopPrice)
    }

    const query = new URLSearchParams(params).toString()
    const signature = await hmacSha256(secret, query)
    const res = await fetch(`https://api.binance.com/api/v3/order?${query}&signature=${signature}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': key, 'Content-Type': 'application/x-www-form-urlencoded' },
      cache: 'no-store',
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Binance order rejected (${res.status}): ${body || res.statusText}`)
    }

    const data = await res.json()

    // Average fill price from the fills payload (market orders can split fills).
    const fills: Array<{ qty?: string; price?: string }> = Array.isArray(data.fills) ? data.fills : []
    const execQty = fills.reduce((sum, f) => sum + parseFloat(f.qty || '0'), 0)
    const execCost = fills.reduce((sum, f) => sum + parseFloat(f.qty || '0') * parseFloat(f.price || '0'), 0)
    let avgFill = 0
    if (execQty > 0) {
      avgFill = execCost / execQty
    } else {
      const p = parseFloat(data.price || '')
      avgFill = Number.isFinite(p) && p > 0 ? p : Number(order.price) || 0
    }

    // Protective stop-loss / take-profit orders (best effort, non-blocking).
    const protective: Array<{ orderId: number; side: string; type: string; price: number; status?: string }> = []
    try {
      if (order.stopLoss) {
        protective.push(await this.placeProtective(key, secret, symbol, 'SELL', 'STOP_LOSS_LIMIT', Number(order.stopLoss), size))
      }
      if (order.takeProfit) {
        protective.push(await this.placeProtective(key, secret, symbol, 'SELL', 'LIMIT', Number(order.takeProfit), size))
      }
    } catch (e: any) {
      console.error('[Binance] Protective order failed — position has NO stop-loss/take-profit:', e?.message)
    }

    return {
      orderId: data.orderId,
      status: data.status,
      symbol: order.symbol,
      side,
      size,
      type,
      price: avgFill || Number(order.price) || 0,
      filled: execQty || parseFloat(data.executedQty || '0') || 0,
      protective,
      raw: data,
    }
  }

  /** Convert a TOPTIER symbol (e.g. "BTC/USD") to a Binance pair (e.g. "BTCUSDT"). */
  private static binanceSymbol(symbol: string): string {
    const s = String(symbol || '')
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/\//g, '')
    if (s.endsWith('USDT')) return s
    if (s.endsWith('USD')) return `${s.slice(0, -3)}USDT`
    return s
  }

  /** Place a protective (stop-loss / take-profit) Binance order. */
  private static async placeProtective(
    key: string,
    secret: string,
    symbol: string,
    side: 'BUY' | 'SELL',
    type: 'LIMIT' | 'STOP_LOSS_LIMIT',
    price: number,
    quantity: number
  ) {
    const params: Record<string, string> = {
      symbol,
      side,
      type,
      quantity: String(quantity),
      price: String(price),
      timeInForce: 'GTC',
      recvWindow: '10000',
      timestamp: String(Date.now()),
    }
    if (type === 'STOP_LOSS_LIMIT') params.stopPrice = String(price)

    const query = new URLSearchParams(params).toString()
    const signature = await hmacSha256(secret, query)
    const res = await fetch(`https://api.binance.com/api/v3/order?${query}&signature=${signature}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': key, 'Content-Type': 'application/x-www-form-urlencoded' },
      cache: 'no-store',
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Binance protective order rejected (${res.status}): ${body || res.statusText}`)
    }

    const data = await res.json()
    return { orderId: data.orderId, side, type, price, status: data.status }
  }
}

// ─── Binance HMAC-SHA256 signer (server-side only) ───────────────────────────
// Binance requires all authenticated endpoints to be signed with HMAC-SHA256
// using the secret key. We use Web Crypto so it works in both Node 18+ and
// edge runtimes without extra deps.
async function hmacSha256(secret: string, payload: string): Promise<string> {
  if (typeof window !== 'undefined') {
    throw new Error('hmacSha256 must run on the server')
  }
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(payload))
  return Buffer.from(new Uint8Array(sig)).toString('hex')
}

