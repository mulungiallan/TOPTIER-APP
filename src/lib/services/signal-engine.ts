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