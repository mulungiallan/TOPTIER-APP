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

export function macdSeries(candles: CandleInput[], fast = 12, slow = 26, signalPeriod = 9): {
  macd: number[]
  signal: number[]
  hist: number[]
} {
  const closes = candles.map((c) => c.close)
  const fastEma = emaSeries(closes, fast)
  const slowEma = emaSeries(closes, slow)
  const macd = closes.map((_, i) =>
    Number.isFinite(fastEma[i]) && Number.isFinite(slowEma[i]) ? fastEma[i] - slowEma[i] : NaN
  )
  const cleaned = macd.map((v) => (Number.isFinite(v) ? v : 0))
  const signal = emaSeries(cleaned, signalPeriod)
  const hist = macd.map((v, i) => (Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NaN))
  return { macd, signal, hist }
}

export function stochasticSeries(
  closes: number[],
  highs: number[],
  lows: number[],
  period = 14,
  kSmooth = 3,
  dSmooth = 3
): { k: number[]; d: number[] } {
  const n = closes.length
  const k = new Array<number>(n).fill(NaN)
  const d = new Array<number>(n).fill(NaN)
  if (n < period + 1) return { k, d }
  const kRaw = new Array<number>(n).fill(NaN)
  for (let i = period - 1; i < n; i++) {
    let lowest = Infinity
    let highest = -Infinity
    for (let j = i - period + 1; j <= i; j++) {
      if (lows[j] < lowest) lowest = lows[j]
      if (highs[j] > highest) highest = highs[j]
    }
    const rng = highest - lowest
    kRaw[i] = rng > 1e-12 ? ((closes[i] - lowest) / rng) * 100 : 50
  }
  for (let i = kSmooth - 1; i < n; i++) {
    let s = 0
    for (let j = i - kSmooth + 1; j <= i; j++) {
      if (Number.isFinite(kRaw[j])) s += kRaw[j]
      else {
        s = NaN
        break
      }
    }
    if (Number.isFinite(s)) k[i] = s / kSmooth
  }
  for (let i = dSmooth - 1; i < n; i++) {
    let s = 0
    for (let j = i - dSmooth + 1; j <= i; j++) {
      if (Number.isFinite(k[j])) s += k[j]
      else {
        s = NaN
        break
      }
    }
    if (Number.isFinite(s)) d[i] = s / dSmooth
  }
  return { k, d }
}

export function directionalIndicators(candles: CandleInput[], period = 14): {
  adx: number[]
  plusDi: number[]
  minusDi: number[]
} {
  const n = candles.length
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
  const plusDi = new Array<number>(n).fill(NaN)
  const minusDi = new Array<number>(n).fill(NaN)
  const adx = new Array<number>(n).fill(NaN)
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
  let adxVal = 0
  for (let i = period; i < n; i++) {
    if (i > period) {
      atr = (atr * (period - 1) + tr[i]) / period
      pdm = (pdm * (period - 1) + plusDm[i]) / period
      mdm = (mdm * (period - 1) + minusDm[i]) / period
    }
    const atrSafe = atr || 1e-9
    const pdi = (100 * pdm) / atrSafe
    const mdi = (100 * mdm) / atrSafe
    plusDi[i] = pdi
    minusDi[i] = mdi
    const sum = pdi + mdi
    dxs[i] = sum > 1e-9 ? (100 * Math.abs(pdi - mdi)) / sum : 0
    if (i === 2 * period - 1) {
      let s = 0
      for (let j = period; j <= i; j++) s += dxs[j]
      adxVal = s / period
      adx[i] = adxVal
    } else if (i > 2 * period - 1) {
      adxVal = (adxVal * (period - 1) + dxs[i]) / period
      adx[i] = adxVal
    }
  }
  return { adx, plusDi, minusDi }
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

// ─── Strategy-extra inputs (ports of the trading_app "100 strategies") ─────
// Each family below is computed ONCE per analysis and stored in the snapshot's
// `extra` bucket. Every voter keys off a FRESH event anchored to the last two
// bars (or a pattern resolution at the final bar), exactly like the Python bot
// strategies -- a condition that merely persists never re-trips.

function smaLast(v: number[], period: number, idx: number): number {
  if (idx < period - 1) return NaN
  let s = 0
  for (let j = idx - period + 1; j <= idx; j++) s += v[j]
  return s / period
}

function maxLast(v: number[], period: number, idx: number): number {
  if (idx < period - 1) return NaN
  let m = -Infinity
  for (let j = idx - period + 1; j <= idx; j++) if (v[j] > m) m = v[j]
  return m
}

function minLast(v: number[], period: number, idx: number): number {
  if (idx < period - 1) return NaN
  let m = Infinity
  for (let j = idx - period + 1; j <= idx; j++) if (v[j] < m) m = v[j]
  return m
}

function supertrendDir(candles: CandleInput[]): { now: number; prev: number } {
  const w = candles.slice(-150)
  const n = w.length
  if (n < 13) return { now: 0, prev: 0 }
  const atrArr = atrSeries(w, 10)
  const closes = w.map((c) => c.close)
  const upper = new Array<number>(n).fill(NaN)
  const lower = new Array<number>(n).fill(NaN)
  for (let i = 0; i < n; i++) {
    const a = atrArr[i]
    const mid = (w[i].high + w[i].low) / 2
    if (i === 0 || !Number.isFinite(a) || !Number.isFinite(upper[i - 1])) {
      upper[i] = Number.isFinite(a) ? mid + 3 * a : NaN
      lower[i] = Number.isFinite(a) ? mid - 3 * a : NaN
      continue
    }
    const upCand = mid + 3 * a
    const lowCand = mid - 3 * a
    upper[i] = closes[i - 1] <= upper[i - 1] ? Math.min(upCand, upper[i - 1]) : upCand
    lower[i] = closes[i - 1] >= lower[i - 1] ? Math.max(lowCand, lower[i - 1]) : lowCand
  }
  const dir = new Array<number>(n).fill(1)
  const trend = new Array<number>(n).fill(NaN)
  for (let i = 1; i < n; i++) {
    if (!Number.isFinite(lower[i]) || !Number.isFinite(lower[i - 1])) continue
    // The classic supertrend compares the CLOSE to the PREVIOUS bar's band.
    if (closes[i] > upper[i - 1]) dir[i] = 1
    else if (closes[i] < lower[i - 1]) dir[i] = -1
    else dir[i] = dir[i - 1]
    trend[i] = dir[i] === 1 ? lower[i] : upper[i]
  }
  return { now: dir[n - 1], prev: dir[n - 2] }
}

function psarValues(candles: CandleInput[]): { now: number; prev: number } {
  const w = candles.slice(-200)
  const n = w.length
  if (n < 20) return { now: NaN, prev: NaN }
  const highs = w.map((c) => c.high)
  const lows = w.map((c) => c.low)
  const sar = new Array<number>(n).fill(0)
  let trendUp = true
  let af = 0.02
  let ep = highs[0]
  sar[0] = lows[0]
  for (let i = 1; i < n; i++) {
    if (trendUp) {
      sar[i] = sar[i - 1] + af * (ep - sar[i - 1])
      sar[i] = Math.min(sar[i], lows[i - 1], i > 1 ? lows[i - 2] : lows[i - 1])
      if (lows[i] < sar[i]) {
        trendUp = false
        sar[i] = ep
        ep = lows[i]
        af = 0.02
      } else {
        if (highs[i] > ep) {
          ep = highs[i]
          af = Math.min(af + 0.02, 0.2)
        }
      }
    } else {
      sar[i] = sar[i - 1] + af * (ep - sar[i - 1])
      sar[i] = Math.max(sar[i], highs[i - 1], i > 1 ? highs[i - 2] : highs[i - 1])
      if (highs[i] > sar[i]) {
        trendUp = true
        sar[i] = ep
        ep = highs[i]
        af = 0.02
      } else {
        if (lows[i] < ep) {
          ep = lows[i]
          af = Math.min(af + 0.02, 0.2)
        }
      }
    }
  }
  return { now: sar[n - 1], prev: sar[n - 2] }
}

function ichimokuLast(
  candles: CandleInput[],
  tenkanP = 9,
  kijunP = 26,
  senkouBP = 52,
  displacement = 26
): {
  tenkanNow: number
  kijunNow: number
  tenkanPrev: number
  kijunPrev: number
  cloudTop: number
  cloudBottom: number
} {
  const none: ReturnType<typeof ichimokuLast> = {
    tenkanNow: NaN,
    kijunNow: NaN,
    tenkanPrev: NaN,
    kijunPrev: NaN,
    cloudTop: NaN,
    cloudBottom: NaN,
  }
  if (candles.length < kijunP + 3) return none
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const n = candles.length
  const at = (i: number) => {
    const t = (maxLast(highs, tenkanP, i) + minLast(lows, tenkanP, i)) / 2
    const k = (maxLast(highs, kijunP, i) + minLast(lows, kijunP, i)) / 2
    return { t, k }
  }
  const now = at(n - 1)
  const prev = at(n - 2)
  const cloudAt = (i: number) => {
    const base = at(i)
    const sa = (base.t + base.k) / 2
    const sb = (maxLast(highs, senkouBP, i) + minLast(lows, senkouBP, i)) / 2
    return { top: Math.max(sa, sb), bottom: Math.min(sa, sb) }
  }
  const cloudNow = cloudAt(n - 1 - displacement)
  return {
    tenkanNow: now.t,
    kijunNow: now.k,
    tenkanPrev: prev.t,
    kijunPrev: prev.k,
    cloudTop: Number.isFinite(cloudNow.top) ? cloudNow.top : NaN,
    cloudBottom: Number.isFinite(cloudNow.bottom) ? cloudNow.bottom : NaN,
  }
}

function cciAt(candles: CandleInput[], idx: number, period = 20): number {
  if (idx < period - 1) return NaN
  const tps: number[] = []
  for (let j = idx - period + 1; j <= idx; j++) tps.push((candles[j].high + candles[j].low + candles[j].close) / 3)
  const last = tps[tps.length - 1]
  const mean = tps.reduce((a, b) => a + b, 0) / period
  let md = 0
  for (const t of tps) md += Math.abs(t - mean)
  md /= period
  if (!(md > 1e-12)) return NaN
  return (last - mean) / (0.015 * md)
}

function williamsAt(candles: CandleInput[], idx: number, period = 14): number {
  if (idx < period - 1) return NaN
  const h = maxLast(candles.map((c) => c.high), period, idx)
  const l = minLast(candles.map((c) => c.low), period, idx)
  const rng = h - l
  if (!(rng > 1e-12)) return NaN
  return ((h - candles[idx].close) / rng) * -100
}

function vwapAt(candles: CandleInput[], end: number): number {
  const start = Math.max(0, end - 287)
  let pv = 0
  let v = 0
  for (let j = start; j <= end; j++) {
    pv += ((candles[j].high + candles[j].low + candles[j].close) / 3) * candles[j].volume
    v += candles[j].volume
  }
  if (!(v > 0)) return NaN
  return pv / v
}

function trailingPivots(v: number[], window: number): { high: boolean[]; low: boolean[] } {
  const span = window * 2 + 1
  const n = v.length
  const high = new Array<boolean>(n).fill(false)
  const low = new Array<boolean>(n).fill(false)
  for (let i = span - 1; i < n; i++) {
    let h = -Infinity
    let l = Infinity
    for (let j = i - span + 1; j <= i; j++) {
      if (v[j] > h) h = v[j]
      if (v[j] < l) l = v[j]
    }
    high[i] = v[i] === h
    low[i] = v[i] === l
  }
  return { high, low }
}

function pivotIndices(flags: boolean[]): number[] {
  const out: number[] = []
  for (let i = 0; i < flags.length; i++) if (flags[i]) out.push(i)
  return out
}

function donchianAt(highs: number[], lows: number[], end: number, period: number): { up: number; low: number } {
  let up = -Infinity
  let low = Infinity
  for (let j = Math.max(0, end - period + 1); j <= end; j++) {
    if (highs[j] > up) up = highs[j]
    if (lows[j] < low) low = lows[j]
  }
  return { up, low }
}

function retestSignal(candles: CandleInput[], tail = 120): 'long' | 'short' | null {
  const n = candles.length
  if (n < 40) return null
  const start = Math.max(0, n - tail)
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const atr = atrSeries(candles, 14)
  let state: 'await_long' | 'await_short' | null = null
  let level = 0
  let barsLeft = 0
  let position: 'long' | 'short' | null = null
  let positionBar = -1
  for (let i = Math.max(start + 20, 21); i < n; i++) {
    const c = closes[i]
    if (position == null && state == null) {
      const dc = donchianAt(highs, lows, i - 1, 20)
      if (c > dc.up) {
        state = 'await_long'
        level = dc.up
        barsLeft = 10
      } else if (c < dc.low) {
        state = 'await_short'
        level = dc.low
        barsLeft = 10
      }
    } else if (state != null) {
      const tol = 0.3 * (Number.isFinite(atr[i]) ? atr[i] : 0)
      if (state === 'await_long') {
        if (c >= level - tol && c <= level + tol) {
          position = 'long'
          positionBar = i
          state = null
        } else if (c < level - tol) {
          state = null
        }
      } else {
        if (c >= level - tol && c <= level + tol) {
          position = 'short'
          positionBar = i
          state = null
        } else if (c > level + tol) {
          state = null
        }
      }
      if (state != null) {
        barsLeft--
        if (barsLeft <= 0) state = null
      }
    }
    if (position != null) break
  }
  if (position != null && positionBar === n - 1) return position
  return null
}

function failedBreakoutSignal(candles: CandleInput[], tail = 40): 'long' | 'short' | null {
  const n = candles.length
  if (n < 13) return null
  const start = Math.max(0, n - tail)
  const closes = candles.map((c) => c.close)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  for (let i = start + 11; i < n; i++) {
    const dc = donchianAt(highs, lows, i - 2, 10)
    const cPrev = closes[i - 1]
    if (cPrev > dc.up && closes[i] <= dc.up) return i === n - 1 ? 'short' : null
    if (cPrev < dc.low && closes[i] >= dc.low) return i === n - 1 ? 'long' : null
  }
  return null
}

function supportResistanceBounce(candles: CandleInput[], pivotWindow = 5): 'long' | 'short' | null {
  const closes = candles.map((c) => c.close)
  const n = closes.length
  if (n < 30) return null
  // Nearest round level below/above the last close from swings on a TIGHT
  // window (psychological density) -- simpler: pivot extremes as SR.
  const { high, low } = trailingPivots(closes, pivotWindow)
  const hi = pivotIndices(high)
  const lo = pivotIndices(low)
  const c = closes[n - 1]
  const cPrev = closes[n - 2]
  let bestSup = 0
  let bestSupDist = Infinity
  let bestRes = 0
  let bestResDist = Infinity
  for (const idx of lo) {
    const lv = closes[idx]
    if (lv <= c) {
      const d = c - lv
      if (d < bestSupDist) {
        bestSupDist = d
        bestSup = lv
      }
    }
  }
  for (const idx of hi) {
    const h = closes[idx]
    if (h >= c) {
      const d = h - c
      if (d < bestResDist) {
        bestResDist = d
        bestRes = h
      }
    }
  }
  if (bestSupDist !== Infinity && bestSupDist <= 0.0015 * c && cPrev < bestSup && c > bestSup) return 'long'
  if (bestResDist !== Infinity && bestResDist <= 0.0015 * c && cPrev > bestRes && c < bestRes) return 'short'
  return null
}

function roundLevelReject(candles: CandleInput[]): 'long' | 'short' | null {
  const closes = candles.map((c) => c.close)
  const lows = candles.map((c) => c.low)
  const highs = candles.map((c) => c.high)
  const n = closes.length
  if (n < 5) return null
  const c = closes[n - 1]
  const cPrev = closes[n - 2]
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(Math.abs(c), 1e-12))) - 2)
  const base = Math.floor(c / step) * step
  const below = base
  const above = base + step
  const tol = 0.0002 * c
  if (lows[n - 1] >= below - tol && lows[n - 1] <= below + tol && c > below + tol && cPrev >= c) return 'long'
  if (highs[n - 1] >= above - tol && highs[n - 1] <= above + tol && c < above - tol && cPrev <= c) return 'short'
  return null
}

function engulfing(candles: CandleInput[]): 'bull' | 'bear' | null {
  if (candles.length < 3) return null
  const i = candles.length - 1
  const prev = candles[i - 1]
  const cur = candles[i]
  const prevRed = prev.close < prev.open
  const curGreen = cur.close > cur.open
  const prevGreen = prev.close > prev.open
  const curRed = cur.close < cur.open
  if (prevRed && curGreen && cur.close > prev.open && cur.open < prev.close) return 'bull'
  if (prevGreen && curRed && cur.close < prev.open && cur.open > prev.close) return 'bear'
  return null
}

function hammerStar(candles: CandleInput[], minRatio = 2): 'bull' | 'bear' | null {
  if (candles.length < 4) return null
  const c = candles[candles.length - 1]
  const closes = candles.map((x) => x.close)
  const body = Math.abs(c.close - c.open)
  if (!(body > 0)) return null
  const lowerWick = Math.min(c.close, c.open) - c.low
  const upperWick = c.high - Math.max(c.close, c.open)
  const rng = c.high - c.low
  if (!(rng > 0)) return null
  const downMove = closes[candles.length - 2] < closes[candles.length - 3]
  if (downMove && lowerWick >= minRatio * body && upperWick <= 0.5 * body && c.close >= c.open) return 'bull'
  const upMove = closes[candles.length - 2] > closes[candles.length - 3]
  if (upMove && upperWick >= minRatio * body && lowerWick <= 0.5 * body && c.close <= c.open) return 'bear'
  return null
}

function dojiSet(candles: CandleInput[]): 'bull' | 'bear' | null {
  if (candles.length < 4) return null
  const i = candles.length - 1
  const d = candles[i - 1]
  const dRange = d.high - d.low
  if (!(dRange > 0) || Math.abs(d.close - d.open) > 0.1 * dRange) return null
  const c = candles[i].close
  if (c > d.high) return 'bull'
  if (c < d.low) return 'bear'
  return null
}

function starSet(candles: CandleInput[]): 'bull' | 'bear' | null {
  if (candles.length < 4) return null
  const i = candles.length - 1
  const c1 = candles[i - 2]
  const c2 = candles[i - 1]
  const c3 = candles[i]
  const body1 = c1.close - c1.open
  if (body1 < 0) {
    const size1 = -body1
    if (size1 > 0 && Math.abs(c2.close - c2.open) <= 0.35 * size1 && c3.close > c3.open && c3.close - c3.open >= 0.5 * size1 && c2.close < c1.open && c3.close > c2.close) {
      return 'bull'
    }
    return null
  }
  if (body1 > 0) {
    const size1 = body1
    if (Math.abs(c2.close - c2.open) <= 0.35 * size1 && c3.close < c3.open && c3.open - c3.close >= 0.5 * size1 && c2.close > c1.open && c3.close < c2.close) {
      return 'bear'
    }
  }
  return null
}

function insideBarSet(candles: CandleInput[]): 'bull' | 'bear' | null {
  if (candles.length < 3) return null
  const i = candles.length - 1
  const prev = candles[i - 1]
  const inside = candles[i - 2]
  const insideRng = inside.high - inside.low
  if (!(insideRng > 0)) return null
  if (prev.high > inside.high || prev.low < inside.low || prev.high - prev.low > insideRng) return null
  if (candles[i].close > inside.high) return 'bull'
  if (candles[i].close < inside.low) return 'bear'
  return null
}

function soldiersCrows(candles: CandleInput[]): 'bull' | 'bear' | null {
  if (candles.length < 5) return null
  const closes = candles.map((c) => c.close)
  const opens = candles.map((c) => c.open)
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const n = candles.length
  const nearHigh = (j: number) => highs[j] > lows[j] && closes[j] >= lows[j] + 0.7 * (highs[j] - lows[j])
  const nearLow = (j: number) => highs[j] > lows[j] && closes[j] <= lows[j] + 0.3 * (highs[j] - lows[j])
  const soldiers = () => {
    for (const j of [n - 3, n - 2, n - 1]) {
      if (closes[j] <= opens[j]) return false
      if (j > n - 3 && closes[j] <= closes[j - 1]) return false
      if (!nearHigh(j)) return false
    }
    for (const j of [n - 2, n - 1]) {
      const p = j - 1
      if (Math.min(opens[p], closes[p]) > opens[j] || opens[j] > Math.max(opens[p], closes[p])) return false
      if (closes[j] <= closes[j - 1]) return false
    }
    return true
  }
  const crows = () => {
    for (const j of [n - 3, n - 2, n - 1]) {
      if (closes[j] >= opens[j]) return false
      if (j > n - 3 && closes[j] >= closes[j - 1]) return false
      if (!nearLow(j)) return false
    }
    for (const j of [n - 2, n - 1]) {
      const p = j - 1
      if (Math.min(opens[p], closes[p]) > opens[j] || opens[j] > Math.max(opens[p], closes[p])) return false
      if (closes[j] >= closes[j - 1]) return false
    }
    return true
  }
  if (soldiers() && closes[n - 1] > closes[n - 2] && closes[n - 1] >= opens[n - 1]) return 'bull'
  if (crows() && closes[n - 1] < closes[n - 2] && closes[n - 1] <= opens[n - 1]) return 'bear'
  return null
}

function doubleTopBottom(candles: CandleInput[]): 'bull' | 'bear' | null {
  const closes = candles.map((c) => c.close)
  const n = closes.length
  if (n < 40) return null
  const { high, low } = trailingPivots(closes, 5)
  const hpi = pivotIndices(high)
  if (hpi.length >= 2) {
    const h1 = closes[hpi[hpi.length - 2]]
    const h2 = closes[hpi[hpi.length - 1]]
    if (h2 <= h1 * 1.002 && h2 >= h1 * 0.998) {
      let neck = Infinity
      for (let j = Math.max(0, n - 21); j < n - 1; j++) if (closes[j] < neck) neck = closes[j]
      if (closes[n - 1] < neck) return 'bear'
    }
  }
  const lpi = pivotIndices(low)
  if (lpi.length >= 2) {
    const l1 = closes[lpi[lpi.length - 2]]
    const l2 = closes[lpi[lpi.length - 1]]
    if (l2 <= l1 * 1.002 && l2 >= l1 * 0.998) {
      let neck = -Infinity
      for (let j = Math.max(0, n - 21); j < n - 1; j++) if (closes[j] > neck) neck = closes[j]
      if (closes[n - 1] > neck) return 'bull'
    }
  }
  return null
}

function headAndShoulders(candles: CandleInput[]): 'bull' | 'bear' | null {
  const closes = candles.map((c) => c.close)
  const n = closes.length
  if (n < 40) return null
  const { high, low } = trailingPivots(closes, 5)
  const hpi = pivotIndices(high)
  if (hpi.length >= 3) {
    const i1 = hpi[hpi.length - 3]
    const i2 = hpi[hpi.length - 2]
    const i3 = hpi[hpi.length - 1]
    const v1 = closes[i1]
    const v2 = closes[i2]
    const v3 = closes[i3]
    if (v2 > v1 && v2 > v3 && Math.abs(v1 - v3) <= 0.003 * Math.max(v1, v3)) {
      let neck = Infinity
      for (let j = i2; j <= i3; j++) if (closes[j] < neck) neck = closes[j]
      if (closes[n - 1] < neck) return 'bear'
    }
  }
  const lpi = pivotIndices(low)
  if (lpi.length >= 3) {
    const i1 = lpi[lpi.length - 3]
    const i2 = lpi[lpi.length - 2]
    const i3 = lpi[lpi.length - 1]
    const v1 = closes[i1]
    const v2 = closes[i2]
    const v3 = closes[i3]
    if (v2 < v1 && v2 < v3 && Math.abs(v1 - v3) <= 0.003 * Math.max(v1, v3)) {
      let neck = -Infinity
      for (let j = i2; j <= i3; j++) if (closes[j] > neck) neck = closes[j]
      if (closes[n - 1] > neck) return 'bull'
    }
  }
  return null
}

function triangleBreak(candles: CandleInput[], regress = 40): 'bull' | 'bear' | null {
  if (candles.length < regress + 2) return null
  const highs = candles.slice(-regress).map((c) => c.high)
  const lows = candles.slice(-regress).map((c) => c.low)
  const fit = (y: number[]) => {
    let sx = 0
    let sy = 0
    let sxx = 0
    let sxy = 0
    for (let i = 0; i < y.length; i++) {
      sx += i
      sy += y[i]
      sxx += i * i
      sxy += i * y[i]
    }
    const d = y.length * sxx - sx * sx
    if (Math.abs(d) < 1e-12) return { slope: 0, intercept: 0 }
    const slope = (y.length * sxy - sx * sy) / d
    return { slope, intercept: (sy - slope * sx) / y.length }
  }
  const r = fit(highs)
  const s = fit(lows)
  if (r.slope < 0 && s.slope > 0) {
    const resNow = r.slope * (regress - 1) + r.intercept
    const supNow = s.slope * (regress - 1) + s.intercept
    const c = candles[candles.length - 1].close
    if (c > resNow) return 'bull'
    if (c < supNow) return 'bear'
  }
  return null
}

export function computeStrategyExtra(candles: CandleInput[]): StrategyExtra {
  const closes = candles.map((c) => c.close)
  const n = candles.length
  const last = n - 1
  const prev = Math.max(last - 1, 0)

  const st = supertrendDir(candles)
  const psar = psarValues(candles)
  const ichi = ichimokuLast(candles)
  const rsi2Arr = rsiSeries(closes, 2)

  const bbPrev = {
    upper: rollingMean(closes.slice(-21, -1), 20) + 2 * rollingStd(closes.slice(-21, -1), 20),
    lower: rollingMean(closes.slice(-21, -1), 20) - 2 * rollingStd(closes.slice(-21, -1), 20),
  }

  return {
    stNow: st.now,
    stPrev: st.prev,
    psarNow: psar.now,
    psarPrev: psar.prev,
    ...ichi,
    sma50Now: smaLast(closes, 50, last),
    sma50Prev: smaLast(closes, 50, prev),
    sma200Now: smaLast(closes, 200, last),
    sma200Prev: smaLast(closes, 200, prev),
    rsi2Now: rsi2Arr[last],
    rsi2Prev: rsi2Arr[prev],
    rsi14Prev: n > 1 ? rsiSeries(closes, 14)[prev] : NaN,
    vwapNow: n > 0 ? vwapAt(candles, last) : NaN,
    vwapPrev: n > 1 ? vwapAt(candles, prev) : NaN,
    cciNow: n > 0 ? cciAt(candles, last) : NaN,
    cciPrev: n > 1 ? cciAt(candles, prev) : NaN,
    wrNow: n > 0 ? williamsAt(candles, last) : NaN,
    wrPrev: n > 1 ? williamsAt(candles, prev) : NaN,
    prevBbUpper: bbPrev.upper,
    prevBbLower: bbPrev.lower,
    retest: retestSignal(candles),
    failedBk: failedBreakoutSignal(candles),
    srBounce: supportResistanceBounce(candles),
    roundReject: roundLevelReject(candles),
    engulf: engulfing(candles),
    hammerStar: hammerStar(candles),
    dojiSet: dojiSet(candles),
    starSet: starSet(candles),
    insideBar: insideBarSet(candles),
    soldiers: soldiersCrows(candles),
    doubleTB: doubleTopBottom(candles),
    hs: headAndShoulders(candles),
    triBreak: triangleBreak(candles),
  }
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
  prevClose: number
  // File-9 strategy inputs: momentum (ROC), stat-arbitrage (rolling z-score),
  // market-making (deviation vs EMA fair value). Each carries prev* so the
  // voters only fire on a fresh cross, not on every bar beyond the trigger.
  roc20: number
  prevRoc20: number
  zscore20: number
  prevZ: number
  fairDev: number
  prevFairDev: number
  // is.txt strategy inputs — EMA cross (#1), MACD cross (#3), ADX trend (#4),
  // stochastic reversion (#16-20), ATR/Keltner channel breakout.
  ema10: number
  ema30: number
  prevEma10: number
  prevEma30: number
  macdHist: number
  prevMacdHist: number
  plusDi: number
  minusDi: number
  stochK: number
  stochD: number
  prevK: number
  prevD: number
  keltUpper: number
  keltLower: number
  prevKeltUpper: number
  prevKeltLower: number
  // Ported "100 strategies" extra inputs — trend-followers (supertrend, PSAR,
  // ichimoku, golden/death cross), reversion (VWAP, CCI, Williams %R, RSI2,
  // volatility squeeze), and candlestick/pattern detectors that resolve on
  // the LAST bar only (never persist across bars).
  extra: StrategyExtra
}

// Inputs for the ported 25 strategies, computed fresh per analysis. Every
// field carries the *prev* value required for a two-bar cross test so voters
// only fire on a FRESH event, mirroring the Python bot strategies.
export interface StrategyExtra {
  stNow: number
  stPrev: number
  psarNow: number
  psarPrev: number
  tenkanNow: number
  kijunNow: number
  tenkanPrev: number
  kijunPrev: number
  cloudTop: number
  cloudBottom: number
  sma50Now: number
  sma50Prev: number
  sma200Now: number
  sma200Prev: number
  rsi2Now: number
  rsi2Prev: number
  rsi14Prev: number
  vwapNow: number
  vwapPrev: number
  cciNow: number
  cciPrev: number
  wrNow: number
  wrPrev: number
  prevBbUpper: number
  prevBbLower: number
  retest: 'long' | 'short' | null
  failedBk: 'long' | 'short' | null
  srBounce: 'long' | 'short' | null
  roundReject: 'long' | 'short' | null
  engulf: 'bull' | 'bear' | null
  hammerStar: 'bull' | 'bear' | null
  dojiSet: 'bull' | 'bear' | null
  starSet: 'bull' | 'bear' | null
  insideBar: 'bull' | 'bear' | null
  soldiers: 'bull' | 'bear' | null
  doubleTB: 'bull' | 'bear' | null
  hs: 'bull' | 'bear' | null
  triBreak: 'bull' | 'bear' | null
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
  const ema10 = emaSeries(closes, 10)
  const ema30 = emaSeries(closes, 30)
  const { hist: macdHistSeries } = macdSeries(candles)
  const di = directionalIndicators(candles, 14)

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

  // File-9 inputs at the last two bars (i / i-1):
  const roc20At = (idx: number): number => {
    const j = idx - 20
    if (j < 0 || closes[j] === 0) return NaN
    return (closes[idx] - closes[j]) / closes[j]
  }
  const zAt = (idx: number): number => {
    const c = closes.slice(Math.max(0, idx - 19), idx + 1)
    if (c.length < 20) return NaN
    const m = rollingMean(c, c.length)
    const sd = rollingStd(c, c.length)
    if (!sd) return NaN
    return (closes[idx] - m) / sd
  }
  const zNow = zAt(n - 1)
  const zPrev = zAt(n - 2)
  const devNow = ema20[i] ? (closes[n - 1] - ema20[i]) / ema20[i] : NaN
  const devPrev = ema20[prev] ? (closes[n - 2] - ema20[prev]) / ema20[prev] : NaN

  const stoch = stochasticSeries(closes, highs, lows)
  const prevKeltUpper = ema20[prev] + 2 * (Number.isFinite(atr14[prev]) ? atr14[prev] : atr14[i])
  const prevKeltLower = ema20[prev] - 2 * (Number.isFinite(atr14[prev]) ? atr14[prev] : atr14[i])

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
    prevClose: closes[n - 2],
    roc20: Number.isFinite(roc20At(n - 1)) ? roc20At(n - 1) : 0,
    prevRoc20: Number.isFinite(roc20At(n - 2)) ? roc20At(n - 2) : 0,
    zscore20: Number.isFinite(zNow) ? zNow : 0,
    prevZ: Number.isFinite(zPrev) ? zPrev : 0,
    fairDev: Number.isFinite(devNow) ? devNow : 0,
    prevFairDev: Number.isFinite(devPrev) ? devPrev : 0,
    ema10: ema10[i],
    ema30: ema30[i],
    prevEma10: ema10[prev] ?? ema10[i],
    prevEma30: ema30[prev] ?? ema30[i],
    macdHist: macdHistSeries[i],
    prevMacdHist: macdHistSeries[i - 1],
    plusDi: di.plusDi[i],
    minusDi: di.minusDi[i],
    stochK: stoch.k[i],
    stochD: stoch.d[i],
    prevK: stoch.k[i - 1],
    prevD: stoch.d[i - 1],
    keltUpper: ema20[i] + 2 * atr14[i],
    keltLower: ema20[i] - 2 * atr14[i],
    prevKeltUpper,
    prevKeltLower,
    extra: computeStrategyExtra(candles),
  }
}

// ─── Three independent strategies ────────────────────────────────────────────

export type StrategyId =
  | 'trend'
  | 'mean_reversion'
  | 'breakout'
  | 'momentum'
  | 'stat_arbitrage'
  | 'market_making'
  | 'ema_cross'
  | 'macd_cross'
  | 'adx_trend'
  | 'stochastic_reversion'
  | 'atr_channel_breakout'
  | 'supertrend'
  | 'parabolic_sar'
  | 'ichimoku'
  | 'golden_death_cross'
  | 'buy_the_dip'
  | 'connors_rsi2'
  | 'vwap_reversion'
  | 'cci_reversion'
  | 'williams_r_reversion'
  | 'volatility_squeeze'
  | 'retest_entry'
  | 'failed_breakout_reversal'
  | 'support_resistance_bounce'
  | 'round_number_levels'
  | 'engulfing'
  | 'hammer_shooting_star'
  | 'doji_confirmation'
  | 'morning_evening_star'
  | 'inside_bar_breakout'
  | 'three_soldiers_crows'
  | 'double_top_bottom'
  | 'head_and_shoulders'
  | 'triangle_wedge_breakout'

export interface RawSignal {
  direction: 'long' | 'short' | null
  strategy: StrategyId
  strength: number
  label: string
}

export function bestRawSignal(s: IndicatorSnapshot): RawSignal {
  const candidates = evaluateRawSignals(s)
  if (candidates.length === 0) return { direction: null, strategy: 'trend', strength: 0, label: '' }
  return candidates.reduce((a, b) => (b.strength > a.strength ? b : a))
}

function evaluateRawSignals(s: IndicatorSnapshot): RawSignal[] {
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

  // ─── File-9 voters (ported from trading_signals/strategies.py) ──────────
  // Only fire on a FRESH cross (prev writes-through are flattened), so a
  // stretched-but-not-crossing condition can't re-trip every bar.

  // 3. Momentum — 20-bar rate of change flipping sign, with a trend context.
  const momentumUp = s.prevRoc20 <= 0 && s.roc20 > 0 && s.adx14 > 15
  const momentumDown = s.prevRoc20 >= 0 && s.roc20 < 0 && s.adx14 > 15
  if (momentumUp)
    candidates.push({
      direction: 'long',
      strategy: 'momentum',
      strength: Math.min(Math.abs(s.roc20) / 0.005, 1),
      label: `Momentum turn — 20-bar ROC ${(s.roc20 * 100).toFixed(2)}% (ADX ${s.adx14.toFixed(0)})`,
    })
  if (momentumDown)
    candidates.push({
      direction: 'short',
      strategy: 'momentum',
      strength: Math.min(Math.abs(s.roc20) / 0.005, 1),
      label: `Momentum turn — 20-bar ROC ${(s.roc20 * 100).toFixed(2)}% (ADX ${s.adx14.toFixed(0)})`,
    })

  // 6. Stat-arbitrage proxy — price z-score vs its own 20-bar mean breaks ±2σ.
  const zBrokeLow = s.prevZ >= -2 && s.zscore20 < -2
  const zBrokeHigh = s.prevZ <= 2 && s.zscore20 > 2
  if (zBrokeLow)
    candidates.push({
      direction: 'long',
      strategy: 'stat_arbitrage',
      strength: Math.min((Math.abs(s.zscore20) - 2) / 2 + 0.5, 1),
      label: `Price ${s.zscore20.toFixed(1)}σ below its 20-bar mean — reversion long`,
    })
  if (zBrokeHigh)
    candidates.push({
      direction: 'short',
      strategy: 'stat_arbitrage',
      strength: Math.min((Math.abs(s.zscore20) - 2) / 2 + 0.5, 1),
      label: `Price ${s.zscore20.toFixed(1)}σ above its 20-bar mean — reversion short`,
    })

  // 7. Market-making bias — price deviation vs EMA20 fair value crosses ±0.2%.
  const devBrokeLow = s.prevFairDev >= -0.002 && s.fairDev < -0.002
  const devBrokeHigh = s.prevFairDev <= 0.002 && s.fairDev > 0.002
  if (devBrokeLow)
    candidates.push({
      direction: 'long',
      strategy: 'market_making',
      strength: Math.min(Math.abs(s.fairDev) / 0.006, 1),
      label: `Price ${(s.fairDev * 100).toFixed(2)}% below EMA20 fair value — lean long`,
    })
  if (devBrokeHigh)
    candidates.push({
      direction: 'short',
      strategy: 'market_making',
      strength: Math.min(Math.abs(s.fairDev) / 0.006, 1),
      label: `Price ${(s.fairDev * 100).toFixed(2)}% above EMA20 fair value — lean short`,
    })

  // ─── is.txt voters (#1, #3, #4, #16-20, ATR channel) ──────────────────

  // 1. EMA cross — fast EMA10 crossing through slow EMA30 = trend flip.
  const emaCrossoverUp = s.prevEma10 <= s.prevEma30 && s.ema10 > s.ema30
  const emaCrossoverDown = s.prevEma10 >= s.prevEma30 && s.ema10 < s.ema30
  if (emaCrossoverUp)
    candidates.push({
      direction: 'long',
      strategy: 'ema_cross',
      strength: Math.min(Math.abs(s.ema10 - s.ema30) / (s.lastClose * 0.0005), 1),
      label: 'EMA10/30 bullish cross',
    })
  if (emaCrossoverDown)
    candidates.push({
      direction: 'short',
      strategy: 'ema_cross',
      strength: Math.min(Math.abs(s.ema10 - s.ema30) / (s.lastClose * 0.0005), 1),
      label: 'EMA10/30 bearish cross',
    })

  // 3. MACD cross — histogram positive and expanding, or negative and contracting.
  const macdUp = s.macdHist > 0 && s.macdHist > s.prevMacdHist
  const macdDown = s.macdHist < 0 && s.macdHist < s.prevMacdHist
  if (macdUp)
    candidates.push({
      direction: 'long',
      strategy: 'macd_cross',
      strength: Math.min(Math.abs(s.macdHist) / (s.lastClose * 0.001) + 0.4, 1),
      label: 'MACD histogram rising above zero',
    })
  if (macdDown)
    candidates.push({
      direction: 'short',
      strategy: 'macd_cross',
      strength: Math.min(Math.abs(s.macdHist) / (s.lastClose * 0.001) + 0.4, 1),
      label: 'MACD histogram falling below zero',
    })

  // 4. ADX trend — only when the trend is strong enough, trade the stronger DI.
  const diBull = s.adx14 >= 20 && s.plusDi > s.minusDi
  const diBear = s.adx14 >= 20 && s.minusDi > s.plusDi
  if (diBull)
    candidates.push({
      direction: 'long',
      strategy: 'adx_trend',
      strength: Math.min(s.adx14 / 50, 1),
      label: `ADX ${s.adx14.toFixed(0)} trending with +DI above −DI`,
    })
  if (diBear)
    candidates.push({
      direction: 'short',
      strategy: 'adx_trend',
      strength: Math.min(s.adx14 / 50, 1),
      label: `ADX ${s.adx14.toFixed(0)} trending with −DI above +DI`,
    })

  // 16-20. Stochastic reversion — %K/%D cross in oversold/overbought zones.
  const stochBull = s.prevK <= s.prevD && s.stochK > s.stochD && s.stochK < 30
  const stochBear = s.prevK >= s.prevD && s.stochK < s.stochD && s.stochK > 70
  if (stochBull)
    candidates.push({
      direction: 'long',
      strategy: 'stochastic_reversion',
      strength: Math.min((30 - s.stochK) / 30 + 0.5, 1),
      label: `Stochastic %K ${s.stochK.toFixed(0)} oversold bull cross`,
    })
  if (stochBear)
    candidates.push({
      direction: 'short',
      strategy: 'stochastic_reversion',
      strength: Math.min((s.stochK - 70) / 30 + 0.5, 1),
      label: `Stochastic %K ${s.stochK.toFixed(0)} overbought bear cross`,
    })

  // ATR/Keltner channel — two consecutive closes outside EMA20 ± 2·ATR.
  const keltBrokeUp = s.lastClose > s.keltUpper && s.prevClose > s.prevKeltUpper
  const keltBrokeDown = s.lastClose < s.keltLower && s.prevClose < s.prevKeltLower
  if (keltBrokeUp)
    candidates.push({
      direction: 'long',
      strategy: 'atr_channel_breakout',
      strength: Math.min(Math.abs(s.lastClose - s.keltUpper) / s.atr14 / 2 + 0.5, 1),
      label: '2-bar break above ATR channel',
    })
  if (keltBrokeDown)
    candidates.push({
      direction: 'short',
      strategy: 'atr_channel_breakout',
      strength: Math.min(Math.abs(s.keltLower - s.lastClose) / s.atr14 / 2 + 0.5, 1),
      label: '2-bar break below ATR channel',
    })

  // ─── Ported "100 strategies" voters ────────────────────────────────────
  // Each keys off a FRESH event: a two-bar cross, a flip between the last two
  // bars, or a pattern that RESOLVES on the final bar. Nothing persists.

  const e = s.extra
  const fin = (v: number) => Number.isFinite(v)

  // 9. Supertrend flip.
  if (e.stPrev === -1 && e.stNow === 1)
    candidates.push({ direction: 'long', strategy: 'supertrend', strength: 0.7, label: 'Supertrend flipped bullish' })
  if (e.stPrev === 1 && e.stNow === -1)
    candidates.push({ direction: 'short', strategy: 'supertrend', strength: 0.7, label: 'Supertrend flipped bearish' })

  // 7. Parabolic SAR — close crossed back through SAR between the last two bars.
  if (fin(e.psarPrev) && fin(e.psarNow) && s.prevClose < e.psarPrev && s.lastClose > e.psarNow)
    candidates.push({ direction: 'long', strategy: 'parabolic_sar', strength: 0.65, label: 'Parabolic SAR bullish flip' })
  if (fin(e.psarPrev) && fin(e.psarNow) && s.prevClose > e.psarPrev && s.lastClose < e.psarNow)
    candidates.push({ direction: 'short', strategy: 'parabolic_sar', strength: 0.65, label: 'Parabolic SAR bearish flip' })

  // 8. Ichimoku — Tenkan/Kijun cross with cloud confirmation.
  if (
    fin(e.tenkanNow) &&
    fin(e.kijunNow) &&
    e.tenkanPrev <= e.kijunPrev &&
    e.tenkanNow > e.kijunNow &&
    s.lastClose > e.cloudTop
  )
    candidates.push({ direction: 'long', strategy: 'ichimoku', strength: 0.7, label: 'Ichimoku TK cross above cloud' })
  if (
    fin(e.tenkanNow) &&
    fin(e.kijunNow) &&
    e.tenkanPrev >= e.kijunPrev &&
    e.tenkanNow < e.kijunNow &&
    s.lastClose < e.cloudBottom
  )
    candidates.push({ direction: 'short', strategy: 'ichimoku', strength: 0.7, label: 'Ichimoku TK cross below cloud' })

  // 2. Golden cross (SMA50 over SMA200) / death cross.
  if (fin(e.sma50Now) && fin(e.sma200Now) && e.sma50Prev <= e.sma200Prev && e.sma50Now > e.sma200Now)
    candidates.push({
      direction: 'long',
      strategy: 'golden_death_cross',
      strength: Math.min(Math.abs(e.sma50Now - e.sma200Now) / (s.lastClose * 0.002) + 0.4, 1),
      label: 'Golden cross — SMA50 above SMA200',
    })
  if (fin(e.sma50Now) && fin(e.sma200Now) && e.sma50Prev >= e.sma200Prev && e.sma50Now < e.sma200Now)
    candidates.push({
      direction: 'short',
      strategy: 'golden_death_cross',
      strength: Math.min(Math.abs(e.sma50Now - e.sma200Now) / (s.lastClose * 0.002) + 0.4, 1),
      label: 'Death cross — SMA50 below SMA200',
    })

  // 15. Buy the dip — above SMA200, RSI14 dips below 40 then turns back up.
  if (fin(e.sma200Now) && fin(s.rsi14) && fin(e.rsi14Prev) && s.lastClose > e.sma200Now && s.rsi14 < 40 && s.rsi14 > e.rsi14Prev)
    candidates.push({
      direction: 'long',
      strategy: 'buy_the_dip',
      strength: Math.min((40 - s.rsi14) / 40 + 0.4, 1),
      label: `Buy-the-dip — RSI ${s.rsi14.toFixed(0)} turning up above SMA200`,
    })

  // 17. Connors RSI(2) — RSI2 climbs out of oversold (or falls from overbought).
  if (fin(e.rsi2Now) && fin(e.rsi2Prev) && fin(e.sma200Now) && e.rsi2Now < 10 && e.rsi2Now > e.rsi2Prev && s.lastClose > e.sma200Now)
    candidates.push({ direction: 'long', strategy: 'connors_rsi2', strength: 0.7, label: `Connors RSI2 ${e.rsi2Now.toFixed(0)} recovering` })
  if (fin(e.rsi2Now) && fin(e.rsi2Prev) && fin(e.sma200Now) && e.rsi2Now > 90 && e.rsi2Now < e.rsi2Prev && s.lastClose < e.sma200Now)
    candidates.push({ direction: 'short', strategy: 'connors_rsi2', strength: 0.7, label: `Connors RSI2 ${e.rsi2Now.toFixed(0)} rolling over` })

  // 23. VWAP reversion — close stretched below/above VWAP closes the gap.
  if (fin(e.vwapNow) && fin(e.vwapPrev)) {
    const belowNow = 1 - s.lastClose / e.vwapNow > 0.006
    const belowPrev = 1 - s.prevClose / e.vwapPrev > 0.006
    if (belowPrev && !belowNow)
      candidates.push({
        direction: 'long',
        strategy: 'vwap_reversion',
        strength: Math.min(Math.max(1 - s.lastClose / e.vwapNow, 0) / 0.006, 1),
        label: `VWAP fade — price ${(Math.abs(1 - s.lastClose / e.vwapNow) * 100).toFixed(2)}% below VWAP`,
      })
    const aboveNow = s.lastClose / e.vwapNow - 1 > 0.006
    const abovePrev = s.prevClose / e.vwapPrev - 1 > 0.006
    if (abovePrev && !aboveNow)
      candidates.push({
        direction: 'short',
        strategy: 'vwap_reversion',
        strength: Math.min(Math.max(s.lastClose / e.vwapNow - 1, 0) / 0.006, 1),
        label: `VWAP fade — price ${(Math.abs(s.lastClose / e.vwapNow - 1) * 100).toFixed(2)}% above VWAP`,
      })
  }

  // 25. CCI reversion — cross back through ±100.
  if (fin(e.cciPrev) && fin(e.cciNow) && e.cciPrev < -100 && e.cciNow > -100)
    candidates.push({
      direction: 'long',
      strategy: 'cci_reversion',
      strength: Math.min(Math.abs(e.cciNow) / 150 + 0.4, 1),
      label: `CCI ${e.cciNow.toFixed(0)} crossed back above −100`,
    })
  if (fin(e.cciPrev) && fin(e.cciNow) && e.cciPrev > 100 && e.cciNow < 100)
    candidates.push({
      direction: 'short',
      strategy: 'cci_reversion',
      strength: Math.min(Math.abs(e.cciNow) / 150 + 0.4, 1),
      label: `CCI ${e.cciNow.toFixed(0)} crossed back below +100`,
    })

  // 26. Williams %R reversion — cross back through −80 / −20.
  if (fin(e.wrPrev) && fin(e.wrNow) && e.wrPrev <= -80 && e.wrNow > -80)
    candidates.push({
      direction: 'long',
      strategy: 'williams_r_reversion',
      strength: Math.min(Math.abs(e.wrNow) / 80 + 0.3, 1),
      label: `Williams %R ${e.wrNow.toFixed(0)} broke back from oversold`,
    })
  if (fin(e.wrPrev) && fin(e.wrNow) && e.wrPrev >= -20 && e.wrNow < -20)
    candidates.push({
      direction: 'short',
      strategy: 'williams_r_reversion',
      strength: Math.min(Math.abs(e.wrNow) / 80 + 0.3, 1),
      label: `Williams %R ${e.wrNow.toFixed(0)} broke back from overbought`,
    })

  // 31. Volatility squeeze — BB locked inside Keltner then released with a break.
  const squeezedPrev =
    fin(e.prevBbUpper) && fin(e.prevBbLower) && fin(s.prevKeltUpper) && fin(s.prevKeltLower) && e.prevBbUpper < s.prevKeltUpper && e.prevBbLower > s.prevKeltLower
  if (squeezedPrev && s.lastClose > s.bbUpper)
    candidates.push({ direction: 'long', strategy: 'volatility_squeeze', strength: 0.7, label: 'Volatility squeeze release — break above BB upper' })
  if (squeezedPrev && s.lastClose < s.bbLower)
    candidates.push({ direction: 'short', strategy: 'volatility_squeeze', strength: 0.7, label: 'Volatility squeeze release — break below BB lower' })

  // 32. Retest entry — breakout then successful pullback test, resolved at last bar.
  if (e.retest === 'long') candidates.push({ direction: 'long', strategy: 'retest_entry', strength: 0.7, label: 'Retest of breakout level (bullish)' })
  if (e.retest === 'short') candidates.push({ direction: 'short', strategy: 'retest_entry', strength: 0.7, label: 'Retest of breakdown level (bearish)' })

  // 33. Failed breakout reversal.
  if (e.failedBk === 'long') candidates.push({ direction: 'long', strategy: 'failed_breakout_reversal', strength: 0.7, label: 'Failed downside breakdown — reversal' })
  if (e.failedBk === 'short') candidates.push({ direction: 'short', strategy: 'failed_breakout_reversal', strength: 0.7, label: 'Failed upside breakout — reversal' })

  // 34. Support/resistance bounce.
  if (e.srBounce === 'long') candidates.push({ direction: 'long', strategy: 'support_resistance_bounce', strength: 0.6, label: 'Bounce off swing support' })
  if (e.srBounce === 'short') candidates.push({ direction: 'short', strategy: 'support_resistance_bounce', strength: 0.6, label: 'Rejection at swing resistance' })

  // 37. Round-number levels.
  if (e.roundReject === 'long') candidates.push({ direction: 'long', strategy: 'round_number_levels', strength: 0.6, label: 'Rejection at round-number support' })
  if (e.roundReject === 'short') candidates.push({ direction: 'short', strategy: 'round_number_levels', strength: 0.6, label: 'Rejection at round-number resistance' })

  // 43-48. Candlestick patterns (resolve on last bar only).
  if (e.engulf === 'bull') candidates.push({ direction: 'long', strategy: 'engulfing', strength: 0.65, label: 'Bullish engulfing' })
  if (e.engulf === 'bear') candidates.push({ direction: 'short', strategy: 'engulfing', strength: 0.65, label: 'Bearish engulfing' })
  if (e.hammerStar === 'bull') candidates.push({ direction: 'long', strategy: 'hammer_shooting_star', strength: 0.6, label: 'Hammer at lows' })
  if (e.hammerStar === 'bear') candidates.push({ direction: 'short', strategy: 'hammer_shooting_star', strength: 0.6, label: 'Shooting star at highs' })
  if (e.dojiSet === 'bull') candidates.push({ direction: 'long', strategy: 'doji_confirmation', strength: 0.55, label: 'Doji followed by upside break' })
  if (e.dojiSet === 'bear') candidates.push({ direction: 'short', strategy: 'doji_confirmation', strength: 0.55, label: 'Doji followed by downside break' })
  if (e.starSet === 'bull') candidates.push({ direction: 'long', strategy: 'morning_evening_star', strength: 0.7, label: 'Morning star confirmed' })
  if (e.starSet === 'bear') candidates.push({ direction: 'short', strategy: 'morning_evening_star', strength: 0.7, label: 'Evening star confirmed' })
  if (e.insideBar === 'bull') candidates.push({ direction: 'long', strategy: 'inside_bar_breakout', strength: 0.55, label: 'Inside-bar runaway close' })
  if (e.insideBar === 'bear') candidates.push({ direction: 'short', strategy: 'inside_bar_breakout', strength: 0.55, label: 'Inside-bar breakdown close' })
  if (e.soldiers === 'bull') candidates.push({ direction: 'long', strategy: 'three_soldiers_crows', strength: 0.75, label: 'Three white soldiers' })
  if (e.soldiers === 'bear') candidates.push({ direction: 'short', strategy: 'three_soldiers_crows', strength: 0.75, label: 'Three black crows' })

  // 40. Double top/bottom.
  if (e.doubleTB === 'bull') candidates.push({ direction: 'long', strategy: 'double_top_bottom', strength: 0.7, label: 'Double bottom neckline break' })
  if (e.doubleTB === 'bear') candidates.push({ direction: 'short', strategy: 'double_top_bottom', strength: 0.7, label: 'Double top neckline break' })

  // 39. Head and shoulders.
  if (e.hs === 'bull') candidates.push({ direction: 'long', strategy: 'head_and_shoulders', strength: 0.75, label: 'Inverse head-and-shoulders break' })
  if (e.hs === 'bear') candidates.push({ direction: 'short', strategy: 'head_and_shoulders', strength: 0.75, label: 'Head-and-shoulders neckline break' })

  // 35/42. Triangle / wedge breakout.
  if (e.triBreak === 'bull') candidates.push({ direction: 'long', strategy: 'triangle_wedge_breakout', strength: 0.7, label: 'Ascending triangle/wedge breakout' })
  if (e.triBreak === 'bear') candidates.push({ direction: 'short', strategy: 'triangle_wedge_breakout', strength: 0.7, label: 'Descending triangle/wedge breakdown' })

  return candidates
}

export function allRawSignals(s: IndicatorSnapshot): RawSignal[] {
  return evaluateRawSignals(s)
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

// ─── AMD sniper detector (ported from files 5 / amd_detector.py) ───────────
// Objective, rules-based Accumulation·Manipulation·Distribution price action:
//   ACCUMULATION / DISTRIBUTION  -> volatility compresses into a tight range
//                                   after a prior directional move.
//   MANIPULATION (liquidity sweep)-> price wicks beyond the range high/low
//                                   (where stops / breakout orders cluster) and
//                                   closes back inside it — the stop hunt.
//   SNIPER ENTRY                  -> confirmation candle after a sweep fires in
//                                   the OPPOSITE direction of the fake breakout,
//                                   with a stop placed just beyond the sweep's
//                                   own wick (tighter than a generic ATR stop).
// The most recent candles are excluded from the range boundaries on purpose —
// a sweep can't poke "beyond" a range that already contains its own wick.

export interface AmdRangeState {
  isRange: boolean
  rangeHigh: number
  rangeLow: number
  compressionRatio: number // current ATR vs ATR `lookback` bars ago; <1 = compressing
  barsInRange: number
  priorTrend: 'up' | 'down' | 'flat' // context before the range formed
}

export interface AmdSweepEvent {
  occurred: boolean
  direction: 'buy_side_sweep' | 'sell_side_sweep' | 'none'
  sweepExtreme: number // the wick price that ran the liquidity
  barIndex: number
}

export interface AmdSniperSignal {
  direction: 'long' | 'short' | 'none'
  entry: number
  stop: number // just beyond the sweep wick, with a small ATR buffer
  phase: 'accumulation' | 'distribution' | 'manipulation_only' | 'none'
  reason: string
  confidence: number // 0-1
  inMacroWindow: boolean // price-and-time filter (files 6)
  macroWindowName: string
}

export type AmdPhase = 'accumulation' | 'distribution' | 'manipulation_only'

// ─── Macro windows (price-and-time filter, ported from files 6) ────────────
// Theory: liquidity sweeps / reversals (the "manipulation" and "distribution"
// legs of AMD) cluster inside recurring session-open windows — London opens and
// the NY AM session — in New York local time, handling Daylight Saving via the
// IANA tz database. Kept separate from the price-pattern detector on purpose:
// "did price form the pattern" and "did it happen in a window that matters" are
// two independent questions.

export interface MacroWindowInfo {
  name: string
  session: 'london' | 'new_york'
  startHour: number // NY local wall-clock
  startMinute: number
  endHour: number
  endMinute: number
}

export const MACRO_WINDOWS: MacroWindowInfo[] = [
  { name: 'london_macro_1', session: 'london', startHour: 4, startMinute: 45, endHour: 5, endMinute: 15 },
  { name: 'london_macro_2', session: 'london', startHour: 5, startMinute: 45, endHour: 6, endMinute: 15 },
  { name: 'ny_am_macro_1', session: 'new_york', startHour: 9, startMinute: 45, endHour: 10, endMinute: 15 },
  { name: 'ny_am_macro_2', session: 'new_york', startHour: 10, startMinute: 15, endHour: 11, endMinute: 15 },
]

// Phases in this set are REJECTED outright when the sweep+reversal candle falls
// outside a macro window. Add 'accumulation' here to time-gate both sides.
export const REQUIRE_MACRO_WINDOW_FOR: AmdPhase[] = ['distribution']
export const MACRO_TIME_CONFIDENCE_BONUS = 0.15 // bonus for ANY phase firing inside a window
const NY_TZ = 'America/New_York'

function nyWallClock(date: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10)
  let hour = get('hour')
  if (hour === 24) hour = 0 // hour12:false yields "24" at midnight
  return { hour, minute: get('minute') }
}

function windowToMinutes(w: { startHour: number; startMinute: number; endHour: number; endMinute: number }) {
  return { start: w.startHour * 60 + w.startMinute, end: w.endHour * 60 + w.endMinute }
}

export function activeMacro(date: Date): MacroWindowInfo | null {
  const t = nyWallClock(date)
  const now = t.hour * 60 + t.minute
  for (const w of MACRO_WINDOWS) {
    const { start, end } = windowToMinutes(w)
    if (now >= start && now <= end) return w
  }
  return null
}

export function describeMacroStatus(date: Date): string {
  const active = activeMacro(date)
  if (active) {
    const { start, end } = windowToMinutes(active)
    return `Inside ${active.name} (${active.session} session, ${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')}-${Math.floor(end / 60)}:${String(end % 60).padStart(2, '0')} NY time)`
  }

  // Soonest upcoming window: scan forward minute-by-minute (DST-safe because
  // every probe maps back through the same NY tz).
  const found = nextMacroInfo(date)
  return `Outside all macro windows. Next: ${found.name} in ${found.hours}h ${found.minutes}m`
}

export function nextMacroInfo(date: Date): { name: string; hours: number; minutes: number } {
  const horizonMs = 48 * 60 * 60 * 1000
  for (let ms = 60_000; ms <= horizonMs; ms += 60_000) {
    const probe = new Date(date.getTime() + ms)
    const w = activeMacro(probe)
    if (w) {
      const mins = Math.floor(ms / 60000)
      return { name: w.name, hours: Math.floor(mins / 60), minutes: mins % 60 }
    }
  }
  return { name: MACRO_WINDOWS[0].name, hours: 24, minutes: 0 }
}

export const AMD_RANGE_LOOKBACK = 20
export const AMD_COMPRESSION_MAX = 0.75
export const AMD_RANGE_EXCLUDE_RECENT = 3
export const AMD_WICK_BUFFER_ATR = 0.1
export const AMD_SNIPER_MIN_SCORE = 0.6

export function detectAmdRange(
  candles: CandleInput[],
  lookback = AMD_RANGE_LOOKBACK,
  compressionMax = AMD_COMPRESSION_MAX,
  excludeRecent = AMD_RANGE_EXCLUDE_RECENT
): AmdRangeState {
  const minLen = lookback * 3 + excludeRecent
  if (candles.length < minLen) {
    return { isRange: false, rangeHigh: 0, rangeLow: 0, compressionRatio: 1, barsInRange: 0, priorTrend: 'flat' }
  }

  const atr = atrSeries(candles, 14)
  const atrAt = (i: number): number => (Number.isFinite(atr[i]) ? atr[i] : atr[atr.length - 1] || 1)

  const rangeWindow = candles.slice(candles.length - (lookback + excludeRecent), candles.length - excludeRecent)
  const atrNow = atrAt(rangeWindow.length - 1)

  const preWindowForAtr = candles.slice(
    candles.length - (lookback * 2 + excludeRecent),
    candles.length - (lookback + excludeRecent)
  )
  const atrThen = preWindowForAtr.length ? atrAt(preWindowForAtr.length - 1) : atrNow
  const compressionRatio = atrThen ? atrNow / atrThen : 1

  const rangeHigh = Math.max(...rangeWindow.map((c) => c.high))
  const rangeLow = Math.min(...rangeWindow.map((c) => c.low))
  const isRange = compressionRatio <= compressionMax

  // What happened BEFORE the range (the leg into it).
  const preWindow = candles.slice(
    candles.length - (lookback * 3 + excludeRecent),
    candles.length - (lookback + excludeRecent)
  )
  let priorTrend: 'up' | 'down' | 'flat' = 'flat'
  if (preWindow.length) {
    const preMove = preWindow[preWindow.length - 1].close - preWindow[0].close
    const validAtr = preWindow.map((_, i) => atrAt(i)).filter(Number.isFinite)
    const preAtr = validAtr.length ? validAtr.reduce((a, b) => a + b, 0) / validAtr.length : 1
    if (preMove > preAtr) priorTrend = 'up'
    else if (preMove < -preAtr) priorTrend = 'down'
  }

  return {
    isRange,
    rangeHigh,
    rangeLow,
    compressionRatio: Math.round(compressionRatio * 1000) / 1000,
    barsInRange: lookback,
    priorTrend,
  }
}

export function detectAmdLiquiditySweep(
  candles: CandleInput[],
  range: AmdRangeState,
  wickBufferAtr = AMD_WICK_BUFFER_ATR
): AmdSweepEvent {
  if (!range.isRange) return { occurred: false, direction: 'none', sweepExtreme: 0, barIndex: -1 }

  const atr = atrSeries(candles, 14)
  const atrLast = Number.isFinite(atr[atr.length - 1]) ? atr[atr.length - 1] : 1
  const buffer = wickBufferAtr * atrLast

  // Check the last 3 closed candles for a wick poking beyond the range boundary
  // that closes back inside it — the manipulation / stop-hunt signature.
  for (let i = 1; i <= 3; i++) {
    const bar = candles[candles.length - i]
    const sweptHigh = bar.high > range.rangeHigh + buffer && bar.close < range.rangeHigh
    const sweptLow = bar.low < range.rangeLow - buffer && bar.close > range.rangeLow
    if (sweptHigh) return { occurred: true, direction: 'buy_side_sweep', sweepExtreme: bar.high, barIndex: candles.length - i }
    if (sweptLow) return { occurred: true, direction: 'sell_side_sweep', sweepExtreme: bar.low, barIndex: candles.length - i }
  }

  return { occurred: false, direction: 'none', sweepExtreme: 0, barIndex: -1 }
}

export function detectAmdSniperEntry(candles: CandleInput[], barTime?: Date): AmdSniperSignal {
  const range = detectAmdRange(candles)
  if (!range.isRange) {
    return { direction: 'none', entry: 0, stop: 0, phase: 'none', reason: 'no accumulation/distribution range detected', confidence: 0, inMacroWindow: false, macroWindowName: '' }
  }

  const sweep = detectAmdLiquiditySweep(candles, range)
  if (!sweep.occurred) {
    return { direction: 'none', entry: 0, stop: 0, phase: 'none', reason: 'range present but no liquidity sweep yet', confidence: 0, inMacroWindow: false, macroWindowName: '' }
  }

  const last = candles[candles.length - 1]
  const atr = atrSeries(candles, 14)
  const atrValue = Number.isFinite(atr[atr.length - 1]) ? atr[atr.length - 1] : 1

  let direction: 'long' | 'short' | 'none'
  let stop = 0
  let phase: AmdPhase
  let reason: string

  if (sweep.direction === 'buy_side_sweep') {
    // Fake breakout up → confirmation is price trading back down through the range.
    const confirmed = last.close < range.rangeHigh && last.close < last.open
    phase = range.priorTrend === 'up' || range.priorTrend === 'flat' ? 'distribution' : 'manipulation_only'
    direction = confirmed ? 'short' : 'none'
    stop = sweep.sweepExtreme + 0.2 * atrValue
    reason = 'Buy-side liquidity swept above range high, price rejected back inside — distribution short'
  } else {
    // Sell-side sweep (fake breakdown) → confirmation is price reclaiming the range.
    const confirmed = last.close > range.rangeLow && last.close > last.open
    phase = range.priorTrend === 'down' || range.priorTrend === 'flat' ? 'accumulation' : 'manipulation_only'
    direction = confirmed ? 'long' : 'none'
    stop = sweep.sweepExtreme - 0.2 * atrValue
    reason = 'Sell-side liquidity swept below range low, price reclaimed the range — accumulation long'
  }

  if (direction === 'none') {
    return { direction: 'none', entry: 0, stop: 0, phase: 'none', reason: 'sweep occurred, awaiting reversal confirmation candle', confidence: 0.2, inMacroWindow: false, macroWindowName: '' }
  }

  // Price-and-time filter (files 6): the sweep+reversal candle's timestamp gates
  // whether the pattern is allowed to count. Phases in REQUIRE_MACRO_WINDOW_FOR
  // are REJECTED outright outside a macro window (the pattern is treated as
  // noise there); other phases just get a confidence bonus when in-window.
  const macro = barTime ? activeMacro(barTime) : null
  const inWindow = macro !== null

  if (barTime && REQUIRE_MACRO_WINDOW_FOR.includes(phase) && !inWindow) {
    return {
      direction: 'none',
      entry: 0,
      stop: 0,
      phase: 'none',
      reason: `${phase} sweep+reversal detected, but outside a required macro time window — ${describeMacroStatus(barTime)}`,
      confidence: 0.15,
      inMacroWindow: false,
      macroWindowName: '',
    }
  }

  // Confidence: tighter compression + accumulation/distribution context = higher.
  const compressionScore = Math.max(0, 1 - range.compressionRatio)
  const trendContextScore = phase === 'accumulation' || phase === 'distribution' ? 1 : 0.5
  let confidence = Math.min(1, 0.4 + 0.35 * compressionScore + 0.25 * trendContextScore)

  let finalReason = reason
  if (inWindow) {
    confidence = Math.min(1, confidence + MACRO_TIME_CONFIDENCE_BONUS)
    finalReason += ` | inside ${macro!.name} macro window`
  } else if (barTime) {
    finalReason += ` | outside any macro window (${describeMacroStatus(barTime)})`
  }

  return {
    direction,
    entry: last.close,
    stop,
    phase,
    reason: finalReason,
    confidence: Math.round(confidence * 100) / 100,
    inMacroWindow: inWindow,
    macroWindowName: macro?.name ?? '',
  }
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