/**
 * indicators.ts
 *
 * TypeScript port of `trading_app/indicators.py` from the reference strategy
 * library. Every function is a line-by-line translation that preserves the
 * original's warm-up periods, NaN placement, `ddof` choice and edge-case
 * behaviour, so results match the Python implementation bar-for-bar.
 *
 * Divergences from pandas are deliberate and documented at each site; there are
 * only two:
 *   1. `session_vwap` buckets by UTC calendar day. The Python groups by
 *      `df.index.date`, i.e. the exchange-local date, which cannot be derived
 *      from a bare epoch timestamp here.
 *   2. Booleans are returned as `boolean[]` masks rather than nullable pandas
 *      `Series`, so downstream `&`/`|` composition is total.
 */

import {
  NAN,
  Series,
  Frame,
  abs,
  add,
  div,
  ewm,
  isNA,
  mul,
  pyMax,
  pyMin,
  replaceZero,
  rollingMax,
  rollingMaxCentered,
  rollingMean,
  rollingMin,
  rollingMinCentered,
  rollingStd,
  rowMaxSkipna,
  shift,
  sub,
} from "./series";

/** One OHLCV bar. `ts` is epoch milliseconds and is required for VWAP. */
export interface OHLCVBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ts?: number;
}

/** Column-oriented view of an OHLCV series (the TS stand-in for a DataFrame). */
export interface OHLCVColumns {
  open: Series;
  high: Series;
  low: Series;
  close: Series;
  volume: Series;
  ts?: number[];
}

/** Split bars into aligned columns, preserving `ts` when present. */
export function toColumns(bars: OHLCVBar[]): OHLCVColumns {
  const cols: OHLCVColumns = {
    open: bars.map((b) => b.open),
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
    volume: bars.map((b) => b.volume),
  };
  if (bars.length > 0 && typeof bars[0].ts === "number") {
    cols.ts = bars.map((b) => b.ts as number);
  }
  return cols;
}

/** Rolling mean with a full window requirement (warm-up stays NaN). */
export function sma(series: Series, period: number): Series {
  return rollingMean(series, period);
}

/**
 * Exponential moving average, `adjust=False`.
 *
 * `min_periods=period` is preserved from the reference: pandas masks the first
 * `period - 1` values even though the recursion is already defined there.
 */
export function ema(series: Series, period: number): Series {
  return ewm(series, { span: period, minPeriods: period });
}

/**
 * Rate of change in percent over `period` bars.
 *
 * One intentional divergence: a zero lag value yields NaN here, where the
 * Python would produce +/-Infinity. Those cannot be rendered or compared
 * meaningfully, so they are treated as missing.
 */
export function roc(series: Series, period = 10): Series {
  const past = shift(series, period);
  return mul(div(sub(series, past), replaceZero(past)), 100);
}

/** Rolling z-score using POPULATION std (`ddof=0`), as in the reference. */
export function zscore(series: Series, period = 20): Series {
  const m = rollingMean(series, period);
  const s = replaceZero(rollingStd(series, period, 0));
  return div(sub(series, m), s);
}

/** True range: the widest of high-low, |high - prevClose|, |low - prevClose|. */
export function trueRange(df: OHLCVColumns): Series {
  const prevClose = shift(df.close, 1);
  return rowMaxSkipna(sub(df.high, df.low), abs(sub(df.high, prevClose)), abs(sub(df.low, prevClose)));
}

/** Average true range (Wilder smoothing via `alpha = 1/period`). */
export function atr(df: OHLCVColumns, period = 14): Series {
  return ewm(trueRange(df), { alpha: 1 / period, minPeriods: period });
}

/**
 * Relative Strength Index.
 *
 * Preserves a quirk of the reference: it guards the LOSS denominator with
 * `.replace(0, NaN)`, so a window with no losses yields NaN rather than the
 * textbook RSI of 100. Faithfully reproduced - strategies calibrated against
 * the Python output depend on it.
 */
export function rsi(series: Series, period = 14): Series {
  const delta = shift(series, 1).map((prev, i) => (isNA(prev) ? NAN : series[i] - prev));
  const gain = delta.map((v) => (isNA(v) ? NAN : v > 0 ? v : 0));
  const loss = delta.map((v) => (isNA(v) ? NAN : v < 0 ? -v : 0));
  const avgGain = ewm(gain, { alpha: 1 / period, minPeriods: period });
  const avgLoss = replaceZero(ewm(loss, { alpha: 1 / period, minPeriods: period }));
  const rs = div(avgGain, avgLoss);
  return rs.map((v) => (isNA(v) ? NAN : 100 - 100 / (1 + v)));
}

/** MACD line, signal line and histogram. */
export function macd(series: Series, fast = 12, slow = 26, signal = 9): Frame {
  const line = sub(ema(series, fast), ema(series, slow));
  const signalLine = ema(line, signal);
  return { macd: line, signal: signalLine, hist: sub(line, signalLine) };
}

/** Bollinger bands with population std, plus %B. */
export function bollingerBands(series: Series, period = 20, numStd = 2): Frame {
  const mid = sma(series, period);
  const std = rollingStd(series, period, 0);
  const upper = add(mid, mul(std, numStd));
  const lower = sub(mid, mul(std, numStd));
  return { mid, upper, lower, pctB: div(sub(series, lower), replaceZero(sub(upper, lower))) };
}

/** Keltner channels: EMA centre with ATR-based bands. */
export function keltnerChannels(df: OHLCVColumns, period = 20, mult = 1.5): Frame {
  const mid = ema(df.close, period);
  const rng = atr(df, period);
  return { mid, upper: add(mid, mul(rng, mult)), lower: sub(mid, mul(rng, mult)) };
}

/** Stochastic oscillator %K and %D. */
export function stochastic(df: OHLCVColumns, kPeriod = 14, dPeriod = 3): Frame {
  const lowN = rollingMin(df.low, kPeriod);
  const highN = rollingMax(df.high, kPeriod);
  const k = mul(div(sub(df.close, lowN), replaceZero(sub(highN, lowN))), 100);
  return { k, d: rollingMean(k, dPeriod) };
}

/** Williams %R. */
export function williamsR(df: OHLCVColumns, period = 14): Series {
  const highN = rollingMax(df.high, period);
  const lowN = rollingMin(df.low, period);
  return mul(div(sub(highN, df.close), replaceZero(sub(highN, lowN))), -100);
}

/**
 * Rolling mean absolute deviation - the denominator of the CCI formula.
 *
 * Computes, per window, `mean(|x - mean(window)|)`, matching
 * `rolling(period).apply(lambda x: np.mean(np.abs(x - x.mean())))`.
 */
function rollingMeanAbsDev(s: Series, window: number): Series {
  const out: Series = new Array(s.length).fill(NAN);
  for (let i = window - 1; i < s.length; i++) {
    const win = s.slice(i - window + 1, i + 1);
    if (win.some(isNA)) continue;
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    out[i] = win.reduce((a, b) => a + Math.abs(b - mean), 0) / win.length;
  }
  return out;
}

/** Commodity Channel Index. */
export function cci(df: OHLCVColumns, period = 20): Series {
  const tp = div(add(add(df.high, df.low), df.close), 3);
  const ma = rollingMean(tp, period);
  const md = replaceZero(rollingMeanAbsDev(tp, period));
  return div(sub(tp, ma), mul(md, 0.015));
}

/** Average Directional Index with +DI / -DI. */
export function adx(df: OHLCVColumns, period = 14): Frame {
  const n = df.close.length;
  const upMove = shift(df.high, 1).map((prev, i) => (isNA(prev) ? NAN : df.high[i] - prev));
  const downMove = shift(df.low, 1).map((prev, i) => (isNA(prev) ? NAN : -(df.low[i] - prev)));

  const plusDm: Series = new Array(n);
  const minusDm: Series = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = upMove[i];
    const d = downMove[i];
    // np.where(...) is False on NaN comparisons, so warm-up yields 0.0 exactly
    // as the reference does - not NaN.
    plusDm[i] = !isNA(u) && !isNA(d) && u > d && u > 0 ? u : 0;
    minusDm[i] = !isNA(u) && !isNA(d) && d > u && d > 0 ? d : 0;
  }

  const tr = trueRange(df);
  const atr_ = ewm(tr, { alpha: 1 / period, minPeriods: period });
  const smoothPlus = ewm(plusDm, { alpha: 1 / period, minPeriods: period });
  const smoothMinus = ewm(minusDm, { alpha: 1 / period, minPeriods: period });
  const plusDI = mul(mul(div(smoothPlus, replaceZero(atr_)), 100), 1);
  const minusDI = mul(mul(div(smoothMinus, replaceZero(atr_)), 100), 1);
  const sum = replaceZero(add(plusDI, minusDI));
  const dx = mul(div(abs(sub(plusDI, minusDI)), sum), 100);
  return { adx: ewm(dx, { alpha: 1 / period, minPeriods: period }), plusDI, minusDI };
}

/** Donchian channels. */
export function donchianChannels(df: OHLCVColumns, period = 20): Frame {
  const upper = rollingMax(df.high, period);
  const lower = rollingMin(df.low, period);
  return { upper, lower, mid: div(add(upper, lower), 2) };
}

/**
 * Parabolic SAR.
 *
 * Straight loop translation. Note the reference clamps against `i-2` as well as
 * `i-1` but substitutes `i-1` when `i == 1`; that fallback is preserved.
 */
export function parabolicSar(
  df: OHLCVColumns,
  afStart = 0.02,
  afStep = 0.02,
  afMax = 0.2
): Series {
  const high = df.high;
  const low = df.low;
  const n = high.length;
  const sar: Series = new Array(n).fill(0);
  if (n === 0) return sar;

  let trendUp = true;
  let af = afStart;
  let ep = high[0];
  sar[0] = low[0];

  for (let i = 1; i < n; i++) {
    const prevSar = sar[i - 1];
    const prev2Low = i > 1 ? low[i - 2] : low[i - 1];
    const prev2High = i > 1 ? high[i - 2] : high[i - 1];

    if (trendUp) {
      sar[i] = prevSar + af * (ep - prevSar);
      sar[i] = Math.min(sar[i], low[i - 1], prev2Low);
      if (low[i] < sar[i]) {
        trendUp = false;
        sar[i] = ep;
        ep = low[i];
        af = afStart;
      } else {
        if (high[i] > ep) {
          ep = high[i];
          af = Math.min(af + afStep, afMax);
        }
      }
    } else {
      sar[i] = prevSar + af * (ep - prevSar);
      sar[i] = Math.max(sar[i], high[i - 1], prev2High);
      if (high[i] > sar[i]) {
        trendUp = true;
        sar[i] = ep;
        ep = high[i];
        af = afStart;
      } else {
        if (low[i] < ep) {
          ep = low[i];
          af = Math.min(af + afStep, afMax);
        }
      }
    }
  }
  return sar;
}

/**
 * Supertrend.
 *
 * The band recursion depends on Python's asymmetric `min`/`max` NaN behaviour
 * (see {@link pyMin}), so it uses those helpers rather than `Math.min`. Before
 * ATR warms up both bands are NaN, the `close > band` guards evaluate False,
 * and direction initialises to -1 - all matching the reference.
 */
export function supertrend(
  df: OHLCVColumns,
  period = 10,
  multiplier = 3
): Frame {
  const n = df.close.length;
  const hl2 = div(add(df.high, df.low), 2);
  const rng = atr(df, period);
  const upperBasic = add(hl2, mul(rng, multiplier));
  const lowerBasic = sub(hl2, mul(rng, multiplier));

  const upper: Series = upperBasic.slice();
  const lower: Series = lowerBasic.slice();
  for (let i = 1; i < n; i++) {
    upper[i] = df.close[i - 1] > upper[i - 1] ? upperBasic[i] : pyMin(upperBasic[i], upper[i - 1]);
    lower[i] = df.close[i - 1] < lower[i - 1] ? lowerBasic[i] : pyMax(lowerBasic[i], lower[i - 1]);
  }

  const trend: Series = new Array(n).fill(NAN);
  const direction: number[] = new Array(n).fill(NAN);
  if (n === 0) return { supertrend: trend, direction };

  direction[0] = 1;
  trend[0] = lower[0];
  for (let i = 1; i < n; i++) {
    if (trend[i - 1] === upper[i - 1]) direction[i] = df.close[i] <= upper[i] ? -1 : 1;
    else direction[i] = df.close[i] >= lower[i] ? 1 : -1;
    trend[i] = direction[i] === 1 ? lower[i] : upper[i];
  }
  return { supertrend: trend, direction };
}

/** Ichimoku Cloud (unshifted Tenkan/Kijun, displaced Senkou lines, Chikou). */
export function ichimoku(
  df: OHLCVColumns,
  tenkanP = 9,
  kijunP = 26,
  senkouBP = 52,
  displacement = 26
): Frame {
  const mid = (hi: Series, lo: Series, p: number) => div(add(rollingMax(hi, p), rollingMin(lo, p)), 2);
  const tenkan = mid(df.high, df.low, tenkanP);
  const kijun = mid(df.high, df.low, kijunP);
  return {
    tenkan,
    kijun,
    senkouA: shift(div(add(tenkan, kijun), 2), displacement),
    senkouB: shift(mid(df.high, df.low, senkouBP), displacement),
    chikou: shift(df.close, -displacement),
  };
}

/**
 * Session VWAP, resetting each UTC calendar day.
 *
 * Division by zero is guarded so a zero-volume session yields NaN, matching
 * the reference's `.replace(0, NaN)`.
 */
export function sessionVwap(df: OHLCVColumns): Series {
  const n = df.close.length;
  const out: Series = new Array(n).fill(NAN);
  if (n === 0) return out;

  const typical = div(add(add(df.high, df.low), df.close), 3);
  let cumPv = 0;
  let cumVol = 0;
  let curDay: string | null = null;

  for (let i = 0; i < n; i++) {
    const ts = df.ts?.[i];
    const day = ts === undefined ? "session" : new Date(ts).toISOString().slice(0, 10);
    if (day !== curDay) {
      curDay = day;
      cumPv = 0;
      cumVol = 0;
    }
    cumPv += typical[i] * df.volume[i];
    cumVol += df.volume[i];
    out[i] = cumVol === 0 || isNA(typical[i]) ? NAN : cumPv / cumVol;
  }
  return out;
}

/**
 * Local swing highs/lows, used by every pivot-based chart pattern.
 *
 * A point is a pivot high when it is the maximum within +/- `window` bars
 * (centred window), so the first and last `window` positions are never pivots.
 */
export function rollingPivots(
  series: Series,
  window = 5
): { pivotHigh: boolean[]; pivotLow: boolean[] } {
  const rollMax = rollingMaxCentered(series, window * 2 + 1);
  const rollMin = rollingMinCentered(series, window * 2 + 1);
  return {
    pivotHigh: series.map((v, i) => !isNA(v) && v === rollMax[i]),
    pivotLow: series.map((v, i) => !isNA(v) && v === rollMin[i]),
  };
}
