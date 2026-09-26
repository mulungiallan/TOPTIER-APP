import { describe, expect, it } from 'vitest'
import { allRawSignals, bestRawSignal, computeIndicators, type CandleInput, type StrategyId } from './signal-engine'

function seedRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function makeCandles(seed: number, bars: number): CandleInput[] {
  const rnd = seedRandom(seed)
  const out: CandleInput[] = []
  let price = 100 + rnd() * 50
  let regime = 'range'
  let barsLeft = 0
  for (let i = 0; i < bars; i++) {
    if (barsLeft <= 0) {
      const r = rnd()
      regime = r < 0.25 ? 'up' : r < 0.5 ? 'down' : r < 0.75 ? 'range' : 'tight'
      barsLeft = 30 + Math.floor(rnd() * 70)
    }
    barsLeft--
    const step =
      regime === 'up'
        ? 0.002 + rnd() * 0.004
        : regime === 'down'
        ? -(0.002 + rnd() * 0.004)
        : regime === 'tight'
        ? (rnd() - 0.5) * 0.0006
        : (rnd() - 0.5) * 0.002
    const gap = (rnd() - 0.5) * 0.004
    const open = price * (1 + gap)
    const close = open * (1 + step + (rnd() - 0.5) * 0.008)
    const wickUp = rnd() * 0.006
    const wickDown = rnd() * 0.006
    const high = Math.max(open, close) * (1 + wickUp)
    const low = Math.min(open, close) * (1 - wickDown)
    out.push({ open, high, low, close, volume: 1000 + rnd() * 2000 })
    price = close
  }
  return out
}

// Crafted scenarios that pin down structural strategies. These prove each
// voter's fire conditions are REACHABLE (textbook setups, synthetic candles).
function candlesFromSeries(moves: { close: number; high?: number; low?: number }[]): CandleInput[] {
  return moves.map((m, i) => {
    const prev = i > 0 ? moves[i - 1].close : m.close * 0.999
    const open = prev
    const high = m.high ?? m.close * 1.001
    const low = m.low ?? m.close * 0.999
    return { open, high, low, close: m.close, volume: 1000 }
  })
}

function sum(v: number[]): number {
  return v.reduce((a, b) => a + b, 0)
}

function crashAndSpike(): CandleInput[] {
  // Sharp decline then a strong sustained recovery; sliced to the exact bar
  // where the target voter fires. Golden cross / ichimoku / supertrend turns
  // are structural: they need the cross MOMENT at the final bar, so we cut the
  // series there rather than guess candle types.
  const moves: { close: number }[] = []
  let p = 100
  for (let i = 0; i < 120; i++) {
    p *= 0.985
    moves.push({ close: p })
  }
  for (let i = 0; i < 30; i++) {
    p *= 1.03
    moves.push({ close: p })
  }
  p *= 1.3
  moves.push({ close: p })
  for (let i = 0; i < 12; i++) {
    p *= 1.015
    moves.push({ close: p })
  }
  return candlesFromSeries(moves)
}

function uptrendDipGap(): CandleInput[] {
  // Sustained uptrend, a sharp 6-bar dip (Tenkan drops under Kijun while price
  // stays above the older cloud), then a gap-up bar that is sliced to the exact
  // Tenkan/Kijun cross bar above the cloud.
  const moves: { close: number }[] = []
  let p = 100
  for (let i = 0; i < 100; i++) {
    p *= 1.008
    moves.push({ close: p })
  }
  for (let i = 0; i < 6; i++) {
    p *= 0.985
    moves.push({ close: p })
  }
  p *= 1.45
  moves.push({ close: p })
  for (let i = 0; i < 20; i++) {
    p *= 1.02
    moves.push({ close: p })
  }
  return candlesFromSeries(moves)
}

function sliceUntil(
  series: CandleInput[],
  pred: (s: NonNullable<ReturnType<typeof computeIndicators>>) => boolean
): CandleInput[] | null {
  for (let k = 60; k <= series.length; k++) {
    const snap = computeIndicators(series.slice(0, k))
    if (snap && pred(snap)) return series.slice(0, k)
  }
  return null
}

function goldenCross(): CandleInput[] {
  // 200-bar decline, 49 bars of mild recovery (SMA50 still under SMA200), then
  // a single bar sized so that SMA50 crosses ABOVE SMA200 exactly at the end.
  const closes: number[] = []
  for (let i = 0; i < 200; i++) closes.push(100 - 0.08 * i)
  for (let i = 1; i <= 49; i++) closes.push(closes[closes.length - 1] + 0.05)
  const prevIdx = closes.length - 1
  const sum49 = sum(closes.slice(prevIdx - 48, prevIdx + 1))
  const sumPrev200 = sum(closes.slice(closes.length - 200))
  const last = (sumPrev200 - 4 * sum49) / 3 + 2
  closes.push(last)
  return candlesFromSeries(closes.map((c) => ({ close: c })))
}

function connorsDip(): CandleInput[] {
  // Strong uptrend then a brutal 2-bar crash and tiny recovery bar: connors_rsi2
  const moves: { close: number }[] = []
  let p = 100
  for (let i = 0; i < 260; i++) {
    p *= 1.008
    moves.push({ close: p })
  }
  p *= 0.75
  moves.push({ close: p })
  p *= 0.75
  moves.push({ close: p })
  p *= 1.005
  moves.push({ close: p })
  return candlesFromSeries(moves)
}

function vwapBounce(): CandleInput[] {
  const moves: { close: number }[] = []
  for (let i = 0; i < 90; i++) moves.push({ close: 100 })
  let p = 100
  for (let i = 0; i < 12; i++) {
    p *= 0.985
    moves.push({ close: p })
  }
  moves.push({ close: p * 1.12 }) // strong bounce just back to fair value
  return candlesFromSeries(moves)
}

function retestPullback(): CandleInput[] {
  const range = (close: number): CandleInput => ({ open: close, high: close + 0.2, low: close - 0.2, close, volume: 1500 })
  const out: CandleInput[] = []
  for (let i = 0; i < 60; i++) out.push(range(100 + 0.3 * Math.sin(i * 0.5)))
  out.push({ open: 100.3, high: 101.1, low: 100.7, close: 100.9, volume: 1500 }) // breakout bar
  out.push({ open: 100.9, high: 100.9, low: 100.6, close: 100.72, volume: 1500 })
  out.push({ open: 100.72, high: 100.85, low: 100.7, close: 100.78, volume: 1500 })
  out.push({ open: 100.78, high: 100.8, low: 100.6, close: 100.7, volume: 1500 })
  out.push({ open: 100.7, high: 100.6, low: 100.42, close: 100.5, volume: 1500 }) // touch of level at last bar
  return out
}

function failedBk(): CandleInput[] {
  const range = (close: number): CandleInput => ({ open: close, high: close + 0.15, low: close - 0.15, close, volume: 1500 })
  const out: CandleInput[] = []
  for (let i = 0; i < 90; i++) out.push(range(100 + 0.15 * Math.sin(i * 0.5)))
  out.push({ open: 100.2, high: 100.85, low: 100.6, close: 100.72, volume: 1500 }) // breakout bar
  out.push({ open: 100.72, high: 100.3, low: 100.1, close: 100.2, volume: 1500 }) // closes back inside
  return out
}

function doubleTop(): CandleInput[] {
  const closes: number[] = []
  const push = (target: number, steps: number, from?: number) => {
    const start = from ?? closes[closes.length - 1]
    for (let k = 1; k <= steps; k++) closes.push(start + ((target - start) * k) / steps)
  }
  push(110, 15, 100)
  closes.push(110, 110) // plateau top 1
  push(104, 13, 110)
  push(110, 14, 104)
  closes.push(110, 110) // plateau top 2
  push(101.8, 11, 110)
  closes.push(101.0) // neck break at last bar
  return candlesFromSeries(closes.map((c) => ({ close: c })))
}

function triangleConverge(): CandleInput[] {
  const out: CandleInput[] = []
  const bar = (high: number, low: number, close: number): CandleInput => ({ open: close, high, low, close, volume: 1500 })
  for (let i = 0; i < 20; i++) out.push(bar(103, 99, 101))
  for (let i = 0; i < 40; i++) {
    const h = 105 - 0.05 * i
    const l = 99 + 0.1 * i
    out.push(bar(h, l, (h + l) / 2))
  }
  out.push(bar(105.6, 104.4, 105.1)) // breakout above the resistance line
  return out
}

const NEW_IDS: StrategyId[] = [
  'supertrend',
  'parabolic_sar',
  'ichimoku',
  'golden_death_cross',
  'buy_the_dip',
  'connors_rsi2',
  'vwap_reversion',
  'cci_reversion',
  'williams_r_reversion',
  'volatility_squeeze',
  'retest_entry',
  'failed_breakout_reversal',
  'support_resistance_bounce',
  'round_number_levels',
  'engulfing',
  'hammer_shooting_star',
  'doji_confirmation',
  'morning_evening_star',
  'inside_bar_breakout',
  'three_soldiers_crows',
  'double_top_bottom',
  'head_and_shoulders',
  'triangle_wedge_breakout',
]

describe('signal-engine ported strategies', () => {
  it('computes indicators + raw signals across diverse synthetic series', () => {
    const fired = new Set<StrategyId>()
    for (let seed = 1; seed <= 8; seed++) {
      const candles = makeCandles(seed * 7919, 320)
      const snap = computeIndicators(candles)
      expect(snap).not.toBeNull()
      if (!snap) throw new Error('computeIndicators returned null')
      const s = bestRawSignal(snap)
      expect(['long', 'short']).toContain(s.direction)
      if (s.direction !== null) {
        expect(s.strategy).toBeTruthy()
        expect(Number.isFinite(s.strength)).toBe(true)
        expect(s.strength).toBeGreaterThanOrEqual(0)
        expect(s.strength).toBeLessThanOrEqual(1)
        expect(s.label.length).toBeGreaterThan(0)
        fired.add(s.strategy)
      }
    }
    expect(fired.size).toBeGreaterThan(0)
  })

  it('coverage: every new strategy id has a voter that fires on SOME series', () => {
    const fired = new Set<StrategyId>()
    const scenarios: CandleInput[][] = []
    for (let seed = 1; seed <= 40; seed++) scenarios.push(makeCandles(seed * 104729, 420))
    for (let seed = 1; seed <= 20; seed++) scenarios.push(makeCandles(seed * 7919, 320))
    scenarios.push(goldenCross())
    scenarios.push(connorsDip())
    scenarios.push(vwapBounce())
    scenarios.push(retestPullback())
    scenarios.push(failedBk())
    scenarios.push(doubleTop())
    scenarios.push(triangleConverge())
    const crash = crashAndSpike()
    const gap = uptrendDipGap()
    const ichiSeries = sliceUntil(crash, (s) => s.extra.tenkanPrev <= s.extra.kijunPrev && s.extra.tenkanNow > s.extra.kijunNow && s.lastClose > s.extra.cloudTop) ?? sliceUntil(gap, (s) => s.extra.tenkanPrev <= s.extra.kijunPrev && s.extra.tenkanNow > s.extra.kijunNow && s.lastClose > s.extra.cloudTop)
    const stSeries = sliceUntil(crash, (s) => s.extra.stPrev === -1 && s.extra.stNow === 1)
    expect(ichiSeries, 'ichimoku cross bar not found').not.toBeNull()
    expect(stSeries, 'supertrend flip bar not found').not.toBeNull()
    if (!ichiSeries) throw new Error('ichimoku cross bar not found')
    if (!stSeries) throw new Error('supertrend flip bar not found')
    scenarios.push(ichiSeries)
    scenarios.push(stSeries)
    for (const candles of scenarios) {
      const snap = computeIndicators(candles)
      if (!snap) continue
      for (const raw of allRawSignals(snap)) {
        if (raw.direction !== null) fired.add(raw.strategy)
        expect(Number.isFinite(raw.strength)).toBe(true)
        expect(raw.strength).toBeGreaterThanOrEqual(0)
        expect(raw.strength).toBeLessThanOrEqual(1)
        expect(raw.label.length).toBeGreaterThan(0)
      }
    }
    const missing = NEW_IDS.filter((id) => !fired.has(id))
    expect(missing, `voters never fired across scenarios: ${missing.join(', ')}`).toEqual([])
  })
})