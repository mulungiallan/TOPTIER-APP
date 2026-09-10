/**
 * TOPTIER Strategy Suite (file 9 integration for the AI Chat Analyser)
 *
 * When an analyzed message mentions a real ticker/pair, the analyser runs the
 * full 8-strategy signal suite from trading_signals/strategies.py against that
 * symbol's recent price history and returns each strategy's read plus the
 * composite/consensus. This is the same logic ported into the signals engine
 * and the MT5 bot, grouped here so the chat analyser can reuse it directly.
 *
 * Everything is deterministic (no LLM calls) — it degrades to an empty list if
 * no symbol is mentioned or the data source is unreachable.
 */

import { liveMarketData } from '@/lib/services/live-market-data'

export type StrategyRead = 'long' | 'short' | 'flat'

export interface StrategySuiteRead {
  symbol: string // token as written in the message (display)
  liveSymbol: string // normalized provider symbol
  price: number | null
  asOf: string | null
  reads: Record<string, StrategyRead>
  composite: number // sum of the 8 reads (long=1, short=-1, flat=0)
  consensus: StrategyRead // majority vote, threshold 30% of voters
}

// Token -> provider symbol. Forex pairs must use the "XXX=YYY" form for Yahoo.
// Keep the most common TO-ETIER symbols first so regex matching prefers them.
const SYMBOL_TABLE: Array<{ token: string; live: string; label: string }> = [
  { token: 'eurusd', live: 'EURUSD=X', label: 'EUR/USD' },
  { token: 'gbpusd', live: 'GBPUSD=X', label: 'GBP/USD' },
  { token: 'usdjpy', live: 'USDJPY=X', label: 'USD/JPY' },
  { token: 'usdchf', live: 'USDCHF=X', label: 'USD/CHF' },
  { token: 'usdcad', live: 'USDCAD=X', label: 'USD/CAD' },
  { token: 'audusd', live: 'AUDUSD=X', label: 'AUD/USD' },
  { token: 'nzdusd', live: 'NZDUSD=X', label: 'NZD/USD' },
  { token: 'eurjpy', live: 'EURJPY=X', label: 'EUR/JPY' },
  { token: 'gbpjpy', live: 'GBPJPY=X', label: 'GBP/JPY' },
  { token: 'eurusd', live: 'EURUSD=X', label: 'EUR/USD' },
  { token: 'usdtry', live: 'USDTRY=X', label: 'USD/TRY' },
  { token: 'usdzar', live: 'USDZAR=X', label: 'USD/ZAR' },
  { token: 'btc', live: 'BTC-USD', label: 'BTC/USD' },
  { token: 'bitcoin', live: 'BTC-USD', label: 'BTC/USD' },
  { token: 'eth', live: 'ETH-USD', label: 'ETH/USD' },
  { token: 'ethereum', live: 'ETH-USD', label: 'ETH/USD' },
  { token: 'sol', live: 'SOL-USD', label: 'SOL/USD' },
  { token: 'bnb', live: 'BNB-USD', label: 'BNB/USD' },
  { token: 'xrp', live: 'XRP-USD', label: 'XRP/USD' },
  { token: 'doge', live: 'DOGE-USD', label: 'DOGE/USD' },
  { token: 'ada', live: 'ADA-USD', label: 'ADA/USD' },
  { token: 'xauusd', live: 'GC=F', label: 'Gold' },
  { token: 'gold', live: 'GC=F', label: 'Gold' },
  { token: 'xagusd', live: 'SI=F', label: 'Silver' },
  { token: 'silver', live: 'SI=F', label: 'Silver' },
  { token: 'usdbrent', live: 'BZ=F', label: 'Brent crude' },
  { token: 'usoil', live: 'CL=F', label: 'WTI crude' },
  { token: 'crude', live: 'CL=F', label: 'WTI crude' },
  { token: 'nas100', live: 'NDX', label: 'Nasdaq 100' },
  { token: 'nasdaq', live: 'NDX', label: 'Nasdaq 100' },
  { token: 'spx500', live: '^GSPC', label: 'S&P 500' },
  { token: 's&p 500', live: '^GSPC', label: 'S&P 500' },
  { token: 'us30', live: '^DJI', label: 'Dow Jones' },
  { token: 'dow', live: '^DJI', label: 'Dow Jones' },
  { token: 'aapl', live: 'AAPL', label: 'Apple' },
  { token: 'tsla', live: 'TSLA', label: 'Tesla' },
  { token: 'nvda', live: 'NVDA', label: 'NVIDIA' },
  { token: 'msft', live: 'MSFT', label: 'Microsoft' },
  { token: 'amzn', live: 'AMZN', label: 'Amazon' },
  { token: 'googl', live: 'GOOGL', label: 'Alphabet' },
  { token: 'meta', live: 'META', label: 'Meta' },
]

/**
 * Extract up to `limit` market symbols referenced in free text. Only tokens
 * in the known table match (an LLM-free, deterministic approach).
 */
export function detectSymbols(text: string, limit = 3): Array<{ token: string; live: string; label: string }> {
  const lower = ` ${text.toLowerCase()} `
  const found: Array<{ token: string; live: string; label: string }> = []
  const seen = new Set<string>()

  for (const entry of SYMBOL_TABLE) {
    // Word-boundary-ish match to avoid matching "eth" inside "method".
    const re = new RegExp(`(?:^|[^a-z])${escapeRe(entry.token)}(?:[^a-z0-9]|$)`, 'i')
    if (re.test(lower)) {
      if (!seen.has(entry.live)) {
        seen.add(entry.live)
        found.push(entry)
      }
    }
    if (found.length >= limit) break
  }

  return found
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Fetch recent candles for a provider symbol and run the 8-strategy suite.
 * Pure strategy logic (no providers) lives below for easy testing.
 */
export async function runStrategySuite(symbolToken: string): Promise<StrategySuiteRead | null> {
  try {
    const [liveSymbol] = detectSymbols(symbolToken, 1).map((s) => s.live)
    const symbol = liveSymbol || symbolToken

    const candles = await liveMarketData.getHistoricalData(symbol, 'D', 250)
    if (!candles || candles.length < 60) return null

    const closes = candles.map((c) => c.close)
    const highs = candles.map((c) => c.high)
    const lows = candles.map((c) => c.low)

    const reads: Record<string, StrategyRead> = {
      trend_following: readTrendFollowing(closes),
      mean_reversion: readMeanReversion(closes),
      momentum: readMomentum(closes),
      swing_trading: readSwingTrading(closes),
      scalping: readScalping(closes, highs, lows),
      stat_arbitrage: readStatArbitrage(closes),
      market_making_bias: readMarketMakingBias(closes),
      breakout: readBreakout(closes, highs, lows),
    }

    const composite = Object.values(reads).reduce(
      (sum, r) => sum + (r === 'long' ? 1 : r === 'short' ? -1 : 0),
      0
    )
    const consensus: StrategyRead =
      composite >= 8 * 0.3 ? 'long' : composite <= -8 * 0.3 ? 'short' : 'flat'

    return {
      symbol: symbolToken,
      liveSymbol: symbol,
      price: closes[closes.length - 1],
      asOf: candles[candles.length - 1]?.date ?? null,
      reads,
      composite,
      consensus,
    }
  } catch (err) {
    console.warn(`[strategy-suite] failed for ${symbolToken}:`, err)
    return null
  }
}

// ─── Pure strategy reads (ported from trading_signals/strategies.py) ─────────

function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let prev = 0
  for (let i = 0; i < period; i++) prev += values[i]
  prev /= period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

function rsi(values: number[], period = 14): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  if (values.length < period + 1) return out
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1]
    avgGain += Math.max(d, 0)
    avgLoss += Math.max(-d, 0)
  }
  avgGain /= period
  avgLoss /= period
  out[period] = avgLoss < 1e-12 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period
    out[i] = avgLoss < 1e-12 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

function atr(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN)
  if (closes.length < period + 1) return out
  const tr = new Array<number>(closes.length).fill(0)
  for (let i = 0; i < closes.length; i++) {
    const pc = i > 0 ? closes[i - 1] : closes[i]
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - pc), Math.abs(lows[i] - pc))
  }
  let prev = 0
  for (let i = 1; i <= period; i++) prev += tr[i]
  prev /= period
  out[period] = prev
  for (let i = period + 1; i < closes.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period
    out[i] = prev
  }
  return out
}

function rollingZscore(values: number[], window: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  for (let i = window - 1; i < values.length; i++) {
    const slice = values.slice(i - window + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length
    const sd = Math.sqrt(
      slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1)
    )
    out[i] = sd > 0 ? (values[i] - mean) / sd : NaN
  }
  return out
}

function last<T>(arr: T[]): T {
  return arr[arr.length - 1]
}

export function readTrendFollowing(closes: number[]): StrategyRead {
  const fast = sma(closes, 50)
  const slow = sma(closes, 200)
  const f = last(fast)
  const s = last(slow)
  if (!Number.isFinite(f) || !Number.isFinite(s)) return 'flat'
  return f > s ? 'long' : f < s ? 'short' : 'flat'
}

export function readMeanReversion(closes: number[]): StrategyRead {
  const bbPeriod = 20
  const r = rsi(closes, 14)
  const last20 = closes.slice(-bbPeriod)
  const mid = last20.reduce((a, b) => a + b, 0) / last20.length
  const sd = Math.sqrt(
    last20.reduce((a, b) => a + (b - mid) ** 2, 0) / (last20.length - 1)
  )
  const upper = mid + 2 * sd
  const lower = mid - 2 * sd
  const c = last(closes)
  const ri = last(r)
  if (c < lower && ri < 30) return 'long'
  if (c > upper && ri > 70) return 'short'
  return 'flat'
}

export function readMomentum(closes: number[], lookback = 20): StrategyRead {
  if (closes.length <= lookback) return 'flat'
  const prev = closes[closes.length - 1 - lookback]
  if (!prev) return 'flat'
  const roc = (last(closes) - prev) / prev
  return roc > 0 ? 'long' : roc < 0 ? 'short' : 'flat'
}

export function readSwingTrading(closes: number[]): StrategyRead {
  const fast = ema(closes, 10)
  const slow = ema(closes, 30)
  const r = rsi(closes, 14)
  const f = last(fast)
  const s = last(slow)
  const ri = last(r)
  if (!Number.isFinite(f) || !Number.isFinite(s)) return 'flat'
  if (f > s && ri < 65 && ri > 40) return 'long'
  if (f < s && ri > 35 && ri < 60) return 'short'
  return 'flat'
}

export function readScalping(closes: number[], highs: number[], lows: number[]): StrategyRead {
  const fast = ema(closes, 3)
  const slow = ema(closes, 8)
  const atrs = atr(highs, lows, closes, 14)
  const f = last(fast)
  const s = last(slow)
  const a = last(atrs)
  if (!Number.isFinite(f) || !Number.isFinite(s) || !Number.isFinite(a)) return 'flat'
  const volOk = a > (atrs.filter(Number.isFinite).slice(-50).reduce((x, y) => x + y, 0) / 50) * 0.5
  if (!volOk) return 'flat'
  return f > s ? 'long' : f < s ? 'short' : 'flat'
}

export function readStatArbitrage(closes: number[], window = 20): StrategyRead {
  const z = rollingZscore(closes, window)
  const zi = last(z)
  if (!Number.isFinite(zi)) return 'flat'
  return zi > 2 ? 'short' : zi < -2 ? 'long' : 'flat'
}

export function readMarketMakingBias(closes: number[], window = 20): StrategyRead {
  const fv = ema(closes, window)
  const fair = last(fv)
  const c = last(closes)
  if (!Number.isFinite(fair) || !fair) return 'flat'
  const dev = (c - fair) / fair
  return dev < -0.002 ? 'long' : dev > 0.002 ? 'short' : 'flat'
}

export function readBreakout(closes: number[], highs: number[], lows: number[], window = 20): StrategyRead {
  const c = last(closes)
  const priorHigh = Math.max(...highs.slice(-window - 1, -1))
  const priorLow = Math.min(...lows.slice(-window - 1, -1))
  if (c > priorHigh) return 'long'
  if (c < priorLow) return 'short'
  return 'flat'
}