/**
 * engines.ts
 *
 * TypeScript port of the reference library's `engines.py` - the reusable
 * "engines" that most of the 100 strategies are thin configurations of.
 *
 * Signal convention (identical to the reference):
 *    1 = long, -1 = short, 0 = flat.
 * Signals are point-in-time: a value computed through bar t is assumed to be
 * actable at bar t+1's open in the backtester.
 *
 * Parity note: several of these rely on pandas' NaN-comparison behaviour, where
 * a comparison against NaN is False rather than an error. That is load-bearing
 * - it is what makes indicator warm-up bars produce "no signal" instead of
 * throwing - so the boolean helpers here must stay NaN-safe.
 */

import {
  Series,
  andMask,
  ffill,
  fillna,
  isNA,
  mul,
  replaceZero,
  rollingMean,
  shift,
  sub,
  gt,
  ge,
  lt,
  le,
} from "./series";
import { OHLCVColumns, adx } from "./indicators";

/** Build an all-NaN series with `value` written wherever `mask` is true. */
function fromMask(length: number, mask: boolean[], value: number): Series {
  const out: Series = new Array(length).fill(NaN);
  for (let i = 0; i < length; i++) if (mask[i]) out[i] = value;
  return out;
}

/** `Series.ffill().fillna(0)` - the reference's "sticky signal" idiom. */
function ffill0(s: Series): Series {
  return fillna(ffill(s), 0);
}

/** `Series.mask(cond, value)` */
function maskSet(s: Series, cond: boolean[], value: number): Series {
  return s.map((v, i) => (cond[i] ? value : v));
}

// ---------------------------------------------------------------------------
// 1. Crossover engine (MAs, MACD/signal, Tenkan/Kijun, price/SAR,
//    price/Supertrend - anything of the form "A crosses B")
// ---------------------------------------------------------------------------
export function crossoverSignal(a: Series, b: Series): Series {
  const diff = sub(a, b);
  const prev = shift(diff, 1);
  // NaN-safe: a NaN diff or a NaN previous diff yields no cross.
  const crossUp = andMask(gt(diff, 0), le(prev, 0));
  const crossDown = andMask(lt(diff, 0), ge(prev, 0));
  // Parity-critical ordering: the reference writes +1 on cross-up bars, -1 on
  // cross-down bars, blanks the rest to NaN, THEN forward-fills. Both marks must
  // land before the ffill. Filling the up-mask first and overwriting the down
  // bars afterwards looks equivalent but is not: the fill would carry the stale
  // +1 forward again on the bar after every down cross, so a short position
  // would only ever last one bar.
  return ffill0(maskSet(fromMask(diff.length, crossUp, 1), crossDown, -1));
}

// ---------------------------------------------------------------------------
// 2. Oscillator mean-reversion engine (RSI, Stochastic, CCI, Williams %R)
// ---------------------------------------------------------------------------
export function oscillatorReversionSignal(
  osc: Series,
  lowTh: number,
  highTh: number,
  exitMid: number | null = null
): Series {
  const prev = shift(osc, 1);
  const wasBelow = lt(prev, lowTh);
  const crossUp = andMask(wasBelow, ge(osc, lowTh));
  const wasAbove = gt(prev, highTh);
  const crossDown = andMask(wasAbove, le(osc, highTh));

  const crossUpSignal = fromMask(osc.length, crossUp, 1);
  let s = ffill0(maskSet(crossUpSignal, crossDown, -1));

  if (exitMid !== null) {
    const longExit = andMask(eq(s, 1), ge(osc, exitMid));
    const shortExit = andMask(eq(s, -1), le(osc, exitMid));
    // The reference re-runs the state machine after zeroing the exits, which
    // is why it replaces 0 with NaN and re-applies the crosses before filling.
    s = maskSet(s, orX(longExit, shortExit), 0);
    s = replaceZero(s);
    s = maskSet(s, crossUp, 1);
    s = maskSet(s, crossDown, -1);
    s = ffill0(s);
  }
  return s;
}

function orX(a: boolean[], b: boolean[]): boolean[] {
  const out: boolean[] = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] || b[i];
  return out;
}

function eq(s: Series, v: number): boolean[] {
  return s.map((x) => x === v);
}

// ---------------------------------------------------------------------------
// 3. Band / channel breakout & reversion engines
// ---------------------------------------------------------------------------
/**
 * +1 when close breaks above the *previous* upper band, -1 below the previous
 * lower band. Note the reference deliberately does not test for a crossing
 * here - it is a state test, and the ffill makes the position sticky.
 */
export function bandBreakoutSignal(close: Series, upper: Series, lower: Series): Series {
  const longE = gt(close, shift(upper, 1));
  const shortE = lt(close, shift(lower, 1));
  return ffill0(maskSet(fromMask(close.length, longE, 1), shortE, -1));
}

/** Mean-reversion against bands: buy the lower band, sell the upper, flat at mid. */
export function bandReversionSignal(
  close: Series,
  upper: Series,
  lower: Series,
  mid: Series
): Series {
  const longE = lt(close, lower);
  const shortE = gt(close, upper);
  const s = ffill0(maskSet(fromMask(close.length, longE, 1), shortE, -1));
  const longExit = andMask(eq(s, 1), ge(close, mid));
  const shortExit = andMask(eq(s, -1), le(close, mid));
  // No fill after the mask: the result is allowed to sit flat at 0.
  return maskSet(s, orX(longExit, shortExit), 0);
}

// ---------------------------------------------------------------------------
// 4. Z-score / spread engine
// ---------------------------------------------------------------------------
export function zscoreSignal(
  z: Series,
  entry = 2.0,
  exit = 0.0,
  stop: number | null = 3.5
): Series {
  const out: Series = new Array(z.length);
  let position = 0;
  for (let i = 0; i < z.length; i++) {
    const val = z[i];
    if (isNA(val)) {
      out[i] = position;
      continue;
    }
    if (stop !== null && Math.abs(val) > stop) position = 0;
    else if (position === 0) {
      if (val < -entry) position = 1;
      else if (val > entry) position = -1;
    } else if (position === 1 && val >= -exit) position = 0;
    else if (position === -1 && val <= exit) position = 0;
    out[i] = position;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. Volume / trend confirmation filters
// ---------------------------------------------------------------------------
export function volumeConfirms(volume: Series, lookback = 20, mult = 1.5): boolean[] {
  const avg = rollingMean(volume, lookback);
  return gt(volume, mul(avg, mult));
}

/** Returns `[isTrending, direction]` as in the reference. */
export function trendFilterAdx(
  df: OHLCVColumns,
  period = 14,
  threshold = 25
): [boolean[], Series] {
  const a = adx(df, period);
  const isTrending = gt(a.adx, threshold);
  const direction: Series = a.plusDI.map((p, i) => (p > a.minusDI[i] ? 1 : -1));
  return [isTrending, direction];
}

/** Zero out a signal wherever `gate` is false. */
export function applyFilter(signal: Series, gate: boolean[]): Series {
  return signal.map((v, i) => (gate[i] ? v : 0));
}

// ---------------------------------------------------------------------------
// 6. Position sizing
// ---------------------------------------------------------------------------
/** Turtle-style: size so a 1-ATR move risks `riskPct` of equity. */
export function atrPositionSize(
  accountEquity: number,
  riskPct: number,
  atrValue: number,
  dollarsPerPoint = 1.0
): number {
  const dollarRisk = accountEquity * riskPct;
  if (atrValue <= 0 || isNA(atrValue)) return 0.0;
  return dollarRisk / (atrValue * dollarsPerPoint);
}

/** `kellyScale = 0.5` gives "half-Kelly", the usual practical discount. */
export function kellyFraction(
  winProb: number,
  winLossRatio: number,
  kellyScale = 0.5
): number {
  const fStar = winProb - (1 - winProb) / winLossRatio;
  return Math.max(0.0, fStar) * kellyScale;
}

export function martingaleSize(
  baseSize: number,
  consecutiveLosses: number,
  multiplier = 2.0,
  maxDoublings = 4
): number {
  return baseSize * Math.pow(multiplier, Math.min(consecutiveLosses, maxDoublings));
}

export function antiMartingaleSize(
  baseSize: number,
  consecutiveWins: number,
  multiplier = 1.5,
  maxScaleups = 4
): number {
  return baseSize * Math.pow(multiplier, Math.min(consecutiveWins, maxScaleups));
}
