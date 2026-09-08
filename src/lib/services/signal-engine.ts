/**
 * TOPTIER Signal Engine
 *
 * A TypeScript port of the multi-timeframe confluence engine (files 2):
 * three independent strategies + a weighted confluence scorer that only emits
 * a signal when the ENTRY timeframe trigger agrees with the HIGHER timeframe
 * trend, momentum, volatility regime and volume. Below MIN_SCORE (0.6) nothing
 * fires. Risk levels are ATR-based with a mandatory minimum 2:1 reward:risk.
 *
 * Styles:
 *   scalp           entry 15m, confirms against 1h   (hours)
 *   intraday_swing  entry 1h,  confirms against 1d   (1-2 days)
 *   swing / position entry 1d, self-confirms         (3+ days)
 */

export interface CandleInput {
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type StyleId = 'scalp' | 'intraday_swing' | 'swing'

export interface StyleConfig {
  label: string
  entryLabel: string // '15m' | '1h' | 'Daily'
  confirmLabel: string
  expiryHours: number
  strategy: 'scalp' | 'swing' // stored on Signal rows, used by UI filters
}

export type CandleResolution = '1' | '5' | '15' | '30' | '60' | 'D' | 'W' | 'M'

export const STYLE_CONFIG: Record<StyleId, StyleConfig> = {
  scalp: {
    label: 'scalp',
    entryLabel: '15m',
    confirmLabel: '1h',
    expiryHours: 12,
    strategy: 'scalp',
  },
  intraday_swing: {
    label: 'intraday_swing',
    entryLabel: '1h',
    confirmLabel: '1d',
    expiryHours: 36,
    strategy: 'swing',
  },
  swing: {
    label: 'swing',
    entryLabel: 'Daily',
    confirmLabel: '1d',
    expiryHours: 72,
    strategy: 'swing',
  },
}

// Entry + confirmation resolutions per style (equal resolutions reuse 1 fetch).
export function resolutionsFor(style: StyleId): {
  entry: CandleResolution
  confirm: CandleResolution
} {
  switch (style) {
    case 'scalp':
      return { entry: '15', confirm: '60' }
    case 'intraday_swing':
      return { entry: '60', confirm: 'D' }
    case 'swing':
      return { entry: 'D', confirm: 'D' }
  }
}

export const MIN_SIGNAL_SCORE = 0.6
export const CONFLUENCE_WEIGHTS = {
  trend_alignment: 0.35,
  momentum: 0.25,
  volatility_regime: 0.15,
  volume_confirmation: 0.25,
}

// ─── Indicator helpers (Wilder/RMA like the Python engine) ──────────────────

export function emaSeries(values: number[], period: number): number[] {
  const n = values.length
  const out = new Array<number>(n).fill(NaN)
  if (n < period) return out
  const k = 2 / (period + 1)
  let prev = 0
  for (let i = 0; i < period; i++) prev += values[i]
  prev /= period
  out[period - 1] = prev
  for (let i = period; i < n; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function rsiSeries(closes: number[], period = 14): number[] {
  const n = closes.length
  const out = new Array<number>(n).fill(NaN)
  if (n < period + 1) return out
  const gains = new Array<number>(n).fill(0)
  const losses = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) {
    const diff = closes[i] - closes[i - 1]
    gains[i] = Math.max(diff, 0)
    losses[i] = Math.max(-diff, 0)
  }
  let avgG = 0
  let avgL = 0
  for (let i = 1; i < n; i++) {
    if (i === period) {
      let sg = 0
      let sl = 0
      for (let j = 1; j <= period; j++) {
        sg += gains[j]
        sl += losses[j]
      }
      avgG = sg / period
      avgL = sl / period
    } else if (i > period) {
      avgG = (avgG * (period - 1) + gains[i]) / period
      avgL = (avgL * (period - 1) + losses[i]) / period
    }
    if (i >= period) {
      out[i] = avgL < 1e-12 ? 100 : 100 - 100 / (1 + avgG / avgL)
    }
  }
  return out
}

export function atrSeries(candles: CandleInput[], period = 14): number[] {
  const n = candles.length
  const out = new Array<number>(n).fill(NaN)
  if (n < period + 1) return out
  const tr = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    const { high, low, close } = candles[i]
    const pc = i > 0 ? candles[i - 1].close : close
    tr[i] = Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc))
  }
  let prev = 0
  for (let i = 1; i < n; i++) {
    if (i === period) {
      let s = 0
      for (let j = 1; j <= period; j++) s += tr[j]
      prev = s / period
      out[i] = prev
    } else if (i > period) {
      prev = (prev * (period - 1) + tr[i]) / period
      out[i] = prev
    }
  }
  return out
}

export function adxSeries(candles: CandleInput[], period = 14): number[] {
  const n = candles.length
  const out = new Array<number>(n).fill(NaN)
  if (n < period + 2) return out
  const tr = new Array<number>(n).fill(0)
  const plusDm = new Array<number>(n).fill(0)
  const minusDm = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) {
    const { high, low } = candles[i]
    const pc = candles[i - 1].close
    tr[i] = Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc))
    const up = high - candles[i - 1].high
    const dn = candles[i - 1].low - low
    plusDm[i] = up > dn && up > 0 ? up : 0
    minusDm[i] = dn > up && dn > 0 ? dn : 0
  }
  let atr = 0
  let pdm = 0
  let mdm = 0
  for (let j = 1; j <= period; j++) {
    atr += tr[j]
    pdm += plusDm[j]
    mdm += minusDm[j]
  }
  atr /= period
  pdm /= period
  mdm /= period
  const dxs = new Array<number>(n).fill(0)
  let adx = 0
  for (let i = period; i < n; i++) {
    if (i > period) {
      atr = (atr * (period - 1) + tr[i]) / period
      pdm = (pdm * (period - 1) + plusDm[i]) / period
      mdm = (mdm * (period - 1) + minusDm[i]) / period
    }
    const atrSafe = atr || 1e-9
    const pdi = (100 * pdm) / atrSafe
    const mdi = (100 * mdm) / atrSafe
    const sum = pdi + mdi
    dxs[i] = sum > 1e-9 ? (100 * Math.abs(pdi - mdi)) / sum : 0
    if (i === 2 * period - 1) {
      let s = 0
      for (let j = period; j <= i; j++) s += dxs[j]
      adx = s / period
      out[i] = adx
    } else if (i > 2 * period - 1) {
      adx = (adx * (period - 1) + dxs[i]) / period
      out[i] = adx
    }
  }
  return out
}

function rollingMean(values: number[], lookback: number): number {
  const slice = values.slice(-lookback)
  if (slice.length === 0) return NaN
  return slice.reduce((a, b) => a + b, 0) / slice.length
}

function rollingStd(values: number[], lookback: number): number {
  const slice = values.slice(-lookback)
  if (slice.length < 2) return NaN
  const mean = rollingMean(slice, slice.length)
  return Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1))
}

// ─── Indicator snapshot ──────────────────────────────────────────────────────

export interface IndicatorSnapshot {
  ema20: number
  ema50: number
  prevEma20: number
  prevEma50: number
  rsi14: number
  atr14: number
  atrTailMean: number
  adx14: number
  bbUpper: number
  bbLower: number
  donUpper: number
  donLower: number
  prevDonUpper: number
  prevDonLower: number
  volZ: number
  lastClose: number
}

export function computeIndicators(candles: CandleInput[]): IndicatorSnapshot | null {
  const n = candles.length
  if (n < 60) return null
  const closes = candles.map((c) => c.close)
  const volumes = candles.map((c) => c.volume)
  const ema20 = emaSeries(closes, 20)
  const ema50 = emaSeries(closes, 50)
  const rsi14 = rsiSeries(closes, 14)
  const atr14 = atrSeries(candles, 14)
  const adx14 = adxSeries(candles, 14)

  let i = n - 1
  let prev = n - 2
  while (i > 20 && !Number.isFinite(ema20[i])) i--
  while (prev > 20 && !Number.isFinite(ema20[prev]) && !Number.isFinite(ema50[prev])) prev--
  if (![ema20[i], ema50[i], rsi14[i], atr14[i], adx14[i]].every(Number.isFinite)) return null

  // Bollinger (last 20 closes)
  const bb = {
    mid: rollingMean(closes.slice(-20), 20),
    upper: 0,
    lower: 0,
  }
  const sd = rollingStd(closes.slice(-20), 20)
  bb.upper = bb.mid + 2 * sd
  bb.lower = bb.mid - 2 * sd

  // Donchian (last 20 highs/lows) and the previous window for breakout compare
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const donUpper = Math.max(...highs.slice(-20))
  const donLower = Math.min(...lows.slice(-20))
  const prevDonUpper = Math.max(...highs.slice(-21, -1))
  const prevDonLower = Math.min(...lows.slice(-21, -1))

  // Volume z-score over last 20
  const volMean = rollingMean(volumes.slice(-20), 20)
  const volSd = rollingStd(volumes.slice(-20), 20)
  const volZ = volSd > 0 ? (volumes[n - 1] - volMean) / volSd : NaN

  const atrTail = atr14.filter(Number.isFinite)
  const atrTailMean = rollingMean(atrTail.slice(-20), Math.min(20, atrTail.length))

  return {
    ema20: ema20[i],
    ema50: ema50[i],
    prevEma20: ema20[prev] ?? ema20[i],
    prevEma50: ema50[prev] ?? ema50[i],
    rsi14: rsi14[i],
    atr14: atr14[i],
    atrTailMean: Number.isFinite(atrTailMean) ? atrTailMean : atr14[i],
    adx14: adx14[i],
    bbUpper: bb.upper,
    bbLower: bb.lower,
    donUpper,
    donLower,
    prevDonUpper,
    prevDonLower,
    volZ: Number.isFinite(volZ) ? volZ : 0,
    lastClose: closes[n - 1],
  }
}

// ─── Three independent strategies ────────────────────────────────────────────

export type StrategyId = 'trend' | 'mean_reversion' | 'breakout'

export interface RawSignal {
  direction: 'long' | 'short' | null
  strategy: StrategyId
  strength: number
  label: string
}

export function bestRawSignal(s: IndicatorSnapshot): RawSignal {
  const crossedUp = s.prevEma20 <= s.prevEma50 && s.ema20 > s.ema50
  const crossedDown = s.prevEma20 >= s.prevEma50 && s.ema20 < s.ema50
  const trending = s.adx14 > 20

  const oversold = s.rsi14 < 30 && s.lastClose <= s.bbLower
  const overbought = s.rsi14 > 70 && s.lastClose >= s.bbUpper

  const brokeUp = s.lastClose > s.prevDonUpper && s.volZ > 1
  const brokeDown = s.lastClose < s.prevDonLower && s.volZ > 1

  const candidates: RawSignal[] = []
  if (crossedUp && trending)
    candidates.push({
      direction: 'long',
      strategy: 'trend',
      strength: Math.min(s.adx14 / 50, 1),
      label: `EMA20/50 bullish cross (ADX ${s.adx14.toFixed(0)})`,
    })
  if (crossedDown && trending)
    candidates.push({
      direction: 'short',
      strategy: 'trend',
      strength: Math.min(s.adx14 / 50, 1),
      label: `EMA20/50 bearish cross (ADX ${s.adx14.toFixed(0)})`,
    })
  if (oversold)
    candidates.push({
      direction: 'long',
      strategy: 'mean_reversion',
      strength: Math.min((30 - s.rsi14) / 30 + 0.5, 1),
      label: `RSI ${s.rsi14.toFixed(0)} oversold at lower Bollinger band`,
    })
  if (overbought)
    candidates.push({
      direction: 'short',
      strategy: 'mean_reversion',
      strength: Math.min((s.rsi14 - 70) / 30 + 0.5, 1),
      label: `RSI ${s.rsi14.toFixed(0)} overbought at upper Bollinger band`,
    })
  if (brokeUp)
    candidates.push({
      direction: 'long',
      strategy: 'breakout',
      strength: Math.min(s.volZ / 3, 1),
      label: `Donchian breakout (volume ${s.volZ.toFixed(1)}σ)`,
    })
  if (brokeDown)
    candidates.push({
      direction: 'short',
      strategy: 'breakout',
      strength: Math.min(s.volZ / 3, 1),
      label: `Donchian breakdown (volume ${s.volZ.toFixed(1)}σ)`,
    })

  if (candidates.length === 0) return { direction: null, strategy: 'trend', strength: 0, label: '' }
  return candidates.reduce((a, b) => (b.strength > a.strength ? b : a))
}

// ─── Confluence scoring ─────────────────────────────────────────────────────

export function higherTfTrend(s: IndicatorSnapshot): 'long' | 'short' | 'neutral' {
  if (s.ema20 > s.ema50) return 'long'
  if (s.ema20 < s.ema50) return 'short'
  return 'neutral'
}

export function scoreSignal(
  entry: IndicatorSnapshot,
  confirm: IndicatorSnapshot,
  raw: RawSignal
): number {
  if (!raw.direction) return 0
  const w = CONFLUENCE_WEIGHTS
  let score = 0

  // Trend alignment: higher timeframe agrees with the direction.
  const htf = higherTfTrend(confirm)
  score += w.trend_alignment * (htf === raw.direction ? 1 : 0)

  // Momentum: RSI on the right side of 50 for the trade direction.
  score += w.momentum * (raw.direction === 'long' ? (entry.rsi14 > 50 ? 1 : 0.3) : entry.rsi14 < 50 ? 1 : 0.3)

  // Volatility regime: ATR should be expanding vs its own recent average.
  score += w.volatility_regime * (entry.atr14 >= entry.atrTailMean ? 1 : 0.4)

  // Volume confirmation.
  score += w.volume_confirmation * (entry.volZ > 0 ? 1 : 0.3)

  return Math.round(score * Math.min(Math.max(raw.strength, 0), 1) * 1000) / 1000
}

// ─── ATR-based trade plan ────────────────────────────────────────────────────

export interface TradeLevels {
  entry: number
  stop: number
  target1: number
  target2: number
  target3: number
  riskReward: number
}

// stop = 1.5 x ATR, first target at minimum 2:1 RR (stop x 2.0 = 3 ATR).
export function deriveLevels(direction: 'BUY' | 'SELL', price: number, atrValue: number): TradeLevels {
  const stopDist = Math.max(1.5 * atrValue, price * 0.0008)
  const t1 = 2.0 * stopDist
  const t2 = 2.8 * stopDist
  const t3 = 4.2 * stopDist
  const riskReward = Math.round((t1 / stopDist) * 100) / 100
  return direction === 'BUY'
    ? { entry: price, stop: price - stopDist, target1: price + t1, target2: price + t2, target3: price + t3, riskReward }
    : { entry: price, stop: price + stopDist, target1: price - t1, target2: price - t2, target3: price - t3, riskReward }
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export interface EngineResult {
  direction: 'BUY' | 'SELL'
  score: number
  confidence: number
  atr14: number
  reason: string
}

export function analyzeSignal(
  entryCandles: CandleInput[],
  confirmCandles: CandleInput[] | null,
  style: StyleId
): EngineResult | null {
  const entry = computeIndicators(entryCandles)
  if (!entry) return null

  const confirmRaw = confirmCandles && confirmCandles !== entryCandles ? confirmCandles : entryCandles
  const confirm = computeIndicators(confirmRaw)
  if (!confirm) return null

  const raw = bestRawSignal(entry)
  if (!raw.direction) return null

  const score = scoreSignal(entry, confirm, raw)
  if (score < MIN_SIGNAL_SCORE) return null

  const direction = raw.direction === 'long' ? 'BUY' : 'SELL'
  const cfg = STYLE_CONFIG[style]
  const selfConfirm = confirmRaw === entryCandles

  const parts = [raw.label]
  const htf = higherTfTrend(confirm)
  if (htf === raw.direction) {
    parts.push(selfConfirm ? 'trend-confirmed on same TF' : `aligns with ${cfg.confirmLabel} trend`)
  }
  parts.push(`RSI ${entry.rsi14.toFixed(0)}`)
  parts.push(entry.atr14 >= entry.atrTailMean ? 'ATR expanding' : 'ATR flat')
  parts.push(entry.volZ > 0 ? `volume ${entry.volZ.toFixed(1)}σ` : 'below-avg volume')
  if (entry.adx14 > 20) parts.push(`ADX ${entry.adx14.toFixed(0)}`)

  return {
    direction,
    score,
    confidence: Math.max(1, Math.min(99, Math.round(score * 100))),
    atr14: entry.atr14,
    reason: parts.join(' · ').slice(0, 160),
  }
}