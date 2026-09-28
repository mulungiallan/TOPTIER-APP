/**
 * patterns.ts
 *
 * TypeScript port of `trading_app/patterns.py` from the reference strategy
 * library. Two tiers, exactly as in the Python:
 *
 *   - Candlestick detectors (#43, #44, #45, #47): exact OHLC arithmetic.
 *   - Chart-pattern detectors (#39, #40, #42, #35): built on pivot detection,
 *     approximate and tolerance-based, as the reference itself documents.
 *
 * Signal convention matches the library: +1 long, -1 short, 0 no signal.
 * Boolean detectors return `boolean[]` masks.
 */

import {
  Series,
  add,
  andMask,
  div,
  ge,
  gt,
  isNA,
  le,
  lt,
  mul,
  notMask,
  replaceZero,
  sub,
} from "./series";
import { OHLCVColumns, rollingPivots } from "./indicators";

/** Candlestick absolute body size. */
function body(df: OHLCVColumns): Series {
  return sub(df.close, df.open).map((v) => (isNA(v) ? Number.NaN : Math.abs(v)));
}

/** Upper wick: high minus the top of the body. */
function upperWick(df: OHLCVColumns): Series {
  return df.high.map((h, i) => (isNA(h) ? Number.NaN : h - Math.max(df.open[i], df.close[i])));
}

/** Lower wick: the bottom of the body minus low. */
function lowerWick(df: OHLCVColumns): Series {
  return df.low.map((l, i) => (isNA(l) ? Number.NaN : Math.min(df.open[i], df.close[i]) - l));
}

/** High-low range, with zero collapsed to NaN as the reference does. */
function range(df: OHLCVColumns): Series {
  return replaceZero(sub(df.high, df.low));
}

function fromMask(mask: boolean[], _n: number): Series {
  return mask.map((v) => (v ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Candlestick patterns
// ---------------------------------------------------------------------------

/** +1 bullish engulfing, -1 bearish engulfing. */
export function engulfing(df: OHLCVColumns): Series {
  const prevOpen = shiftSeries(df.open, 1);
  const prevClose = shiftSeries(df.close, 1);
  const b = body(df);
  const prevBody = shiftSeries(b, 1);

  const bullish = andMask(
    gt(df.close, df.open),
    lt(prevClose, prevOpen),
    ge(df.close, prevOpen),
    le(df.open, prevClose),
    gt(b, prevBody)
  );
  const bearish = andMask(
    lt(df.close, df.open),
    gt(prevClose, prevOpen),
    ge(df.open, prevClose),
    le(df.close, prevOpen),
    gt(b, prevBody)
  );

  return bullish.map((v, i) => (v ? 1 : bearish[i] ? -1 : 0));
}

/** +1 hammer (bullish reversal), -1 shooting star (bearish reversal). */
export function hammerShootingStar(df: OHLCVColumns, wickBodyRatio = 2): Series {
  const b = replaceZero(body(df));
  const lower = lowerWick(df);
  const upper = upperWick(df);
  const hammer = andMask(gt(lower, mul(b, wickBodyRatio)), lt(upper, b));
  const star = andMask(gt(upper, mul(b, wickBodyRatio)), lt(lower, b));
  return hammer.map((v, i) => (v ? 1 : star[i] ? -1 : 0));
}

/**
 * Doji (indecision) mask: body smaller than `bodyRatioThreshold` of the range.
 *
 * The reference notes direction comes from the NEXT candle's confirmation,
 * handled by the strategy layer - this mask deliberately carries no direction.
 */
export function doji(df: OHLCVColumns, bodyRatioThreshold = 0.1): boolean[] {
  return div(body(df), range(df)).map((v) => !isNA(v) && v < bodyRatioThreshold);
}

/** +1 morning star (bottom reversal), -1 evening star (top reversal). */
export function morningEveningStar(df: OHLCVColumns): Series {
  const b0 = shiftSeries(body(df), 2);
  const b1 = shiftSeries(body(df), 1);
  const b2 = body(df);
  const c0 = shiftSeries(df.close, 2);
  const c2 = df.close;
  const o0 = shiftSeries(df.open, 2);
  const o2 = df.open;

  const smallMiddle = lt(b1, mul(b0, 0.5));
  const midpoint = div(add(o0, c0), 2);
  const strongLastUp = andMask(gt(c2, o2), gt(b2, mul(b0, 0.5)), gt(c2, midpoint));
  const strongLastDown = andMask(lt(c2, o2), gt(b2, mul(b0, 0.5)), lt(c2, midpoint));

  const morning = andMask(lt(c0, o0), smallMiddle, strongLastUp);
  const evening = andMask(gt(c0, o0), smallMiddle, strongLastDown);
  return morning.map((v, i) => (v ? 1 : evening[i] ? -1 : 0));
}

/** True where the bar's range sits fully inside the prior bar's range. */
export function insideBar(df: OHLCVColumns): boolean[] {
  return andMask(lt(df.high, shiftSeries(df.high, 1)), gt(df.low, shiftSeries(df.low, 1)));
}

/**
 * +1 on an upside break of the most recent inside bar's mother candle,
 * -1 on the downside break.
 */
export function insideBarBreakout(df: OHLCVColumns): Series {
  const ib = insideBar(df);
  const motherHigh = ffill(ib.map((v, i) => (v ? shiftSeries(df.high, 1)[i] : Number.NaN)));
  const motherLow = ffill(ib.map((v, i) => (v ? shiftSeries(df.low, 1)[i] : Number.NaN)));
  const prevIb = shiftBool(ib, 1);

  const longBreak = andMask(gt(df.close, motherHigh), prevIb);
  const shortBreak = andMask(lt(df.close, motherLow), prevIb);
  return longBreak.map((v, i) => (v ? 1 : shortBreak[i] ? -1 : 0));
}

/** +1 three white soldiers, -1 three black crows. */
export function threeSoldiersCrows(df: OHLCVColumns): Series {
  const up = gt(df.close, df.open);
  const down = lt(df.close, df.open);
  const higherClose = gt(df.close, shiftSeries(df.close, 1));
  const lowerClose = lt(df.close, shiftSeries(df.close, 1));

  const soldiers = andMask(
    up,
    shiftBool(up, 1),
    shiftBool(up, 2),
    higherClose,
    shiftBool(higherClose, 1)
  );
  const crows = andMask(
    down,
    shiftBool(down, 1),
    shiftBool(down, 2),
    lowerClose,
    shiftBool(lowerClose, 1)
  );
  return soldiers.map((v, i) => (v ? 1 : crows[i] ? -1 : 0));
}

// ---------------------------------------------------------------------------
// Pivot-based chart patterns (approximate, tolerance-based)
// ---------------------------------------------------------------------------

/**
 * +1 on a confirmed double-bottom neckline break, -1 on a double-top break.
 *
 * Two consecutive pivot highs within `tolerance` of each other define a
 * double top; the signal fires on the first close back through the intervening
 * trough. Approximate by construction, as documented in the reference.
 */
export function doubleTopBottom(df: OHLCVColumns, window = 5, tolerance = 0.02): Series {
  const out: Series = new Array(df.close.length).fill(0);
  const { pivotHigh, pivotLow } = rollingPivots(df.close, window);

  const highIdx: number[] = [];
  const lowIdx: number[] = [];
  pivotHigh.forEach((v, i) => {
    if (v) highIdx.push(i);
  });
  pivotLow.forEach((v, i) => {
    if (v) lowIdx.push(i);
  });

  for (let i = 1; i < highIdx.length; i++) {
    const a = highIdx[i - 1];
    const b = highIdx[i];
    const p1 = df.close[a];
    const p2 = df.close[b];
    if (p1 === 0 || Math.abs(p1 - p2) / p1 >= tolerance) continue;
    let trough = Infinity;
    for (let k = a; k <= b; k++) trough = Math.min(trough, df.close[k]);
    for (let k = b + 1; k < df.close.length; k++) {
      if (df.close[k] < trough) {
        out[k] = -1;
        break;
      }
    }
  }

  for (let i = 1; i < lowIdx.length; i++) {
    const a = lowIdx[i - 1];
    const b = lowIdx[i];
    const p1 = df.close[a];
    const p2 = df.close[b];
    if (p1 === 0 || Math.abs(p1 - p2) / p1 >= tolerance) continue;
    let peak = -Infinity;
    for (let k = a; k <= b; k++) peak = Math.max(peak, df.close[k]);
    for (let k = b + 1; k < df.close.length; k++) {
      if (df.close[k] > peak) {
        out[k] = 1;
        break;
      }
    }
  }
  return out;
}

/**
 * Simplified head-and-shoulders: three consecutive pivot highs where the middle
 * one is the head and the shoulders are within `tolerance`. -1 on the neckline
 * break; the inverse on pivot lows gives +1.
 */
export function headAndShoulders(df: OHLCVColumns, window = 5, tolerance = 0.03): Series {
  const out: Series = new Array(df.close.length).fill(0);
  const { pivotHigh, pivotLow } = rollingPivots(df.close, window);

  const highs: number[] = [];
  const lows: number[] = [];
  pivotHigh.forEach((v, i) => {
    if (v) highs.push(i);
  });
  pivotLow.forEach((v, i) => {
    if (v) lows.push(i);
  });

  for (let i = 2; i < highs.length; i++) {
    const ls = df.close[highs[i - 2]];
    const head = df.close[highs[i - 1]];
    const rs = df.close[highs[i]];
    if (!(head > ls && head > rs) || ls === 0 || Math.abs(ls - rs) / ls >= tolerance) continue;
    let neck = Infinity;
    for (let k = highs[i - 2]; k <= highs[i]; k++) neck = Math.min(neck, df.close[k]);
    for (let k = highs[i] + 1; k < df.close.length; k++) {
      if (df.close[k] < neck) {
        out[k] = -1;
        break;
      }
    }
  }

  for (let i = 2; i < lows.length; i++) {
    const ls = df.close[lows[i - 2]];
    const head = df.close[lows[i - 1]];
    const rs = df.close[lows[i]];
    if (!(head < ls && head < rs) || ls === 0 || Math.abs(ls - rs) / ls >= tolerance) continue;
    let neck = -Infinity;
    for (let k = lows[i - 2]; k <= lows[i]; k++) neck = Math.max(neck, df.close[k]);
    for (let k = lows[i] + 1; k < df.close.length; k++) {
      if (df.close[k] > neck) {
        out[k] = 1;
        break;
      }
    }
  }
  return out;
}

/**
 * Least-squares trendline through the most recent pivot highs (resistance) or
 * pivot lows (support) within `lookback` bars, projected at every bar.
 * NaN where fewer than two pivots are available yet.
 */
export function trendlineFromPivots(
  df: OHLCVColumns,
  useHighs: boolean,
  window = 5,
  lookback = 100
): Series {
  const n = df.close.length;
  const line: Series = new Array(n).fill(Number.NaN);
  const { pivotHigh, pivotLow } = rollingPivots(df.close, window);
  const mask = useHighs ? pivotHigh : pivotLow;

  const pivots: number[] = [];
  mask.forEach((v, i) => {
    if (v) pivots.push(i);
  });
  if (pivots.length < 2) return line;

  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - lookback);
    const recent = pivots.filter((p) => p <= i && p >= from).slice(-lookback);
    if (recent.length < 2) continue;
    const { slope, intercept } = leastSquares(recent, (p) => df.close[p]);
    line[i] = slope * i + intercept;
  }
  return line;
}

/** Ordinary least squares for `y = slope * x + intercept`. */
function leastSquares(xs: number[], yAt: (x: number) => number): { slope: number; intercept: number } {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (const x of xs) {
    const y = yAt(x);
    sx += x;
    sy += y;
    sxy += x * y;
    sxx += x * x;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}

/**
 * +1 on a breakout above the resistance trendline, -1 on a breakdown below
 * support. Covers triangles (#35) and wedges (#42), which share the same
 * converging-trendline geometry.
 *
 * The reference forward-fills and then zero-fills, so bars before any signal
 * report 0 rather than NaN.
 */
export function triangleWedgeBreakout(df: OHLCVColumns, window = 5, lookback = 100): Series {
  const resistance = trendlineFromPivots(df, true, window, lookback);
  const support = trendlineFromPivots(df, false, window, lookback);
  const n = df.close.length;
  const out: Series = new Array(n).fill(Number.NaN);

  for (let i = 0; i < n; i++) {
    const r = resistance[i];
    const s = support[i];
    const longE = !isNA(r) && df.close[i] > r;
    const shortE = !isNA(s) && df.close[i] < s;
    // pandas assigns the long mask first, then the short mask, so a bar that
    // somehow satisfies both ends up SHORT. Check short first to match.
    if (shortE) out[i] = -1;
    else if (longE) out[i] = 1;
  }

  const filled = ffill(out);
  return filled.map((v) => (isNA(v) ? 0 : v));
}

/**
 * Simplified cup-and-handle: a rounded decline-and-recovery over `cupWindow`
 * bars returning to within 5% of its start, a shallow pullback over
 * `handleWindow`, then a breakout above the cup's starting high.
 */
export function cupAndHandle(
  df: OHLCVColumns,
  cupWindow = 60,
  handleWindow = 15,
  depthTol = 0.5
): Series {
  const close = df.close;
  const out: Series = new Array(close.length).fill(0);

  for (let i = cupWindow + handleWindow; i < close.length; i++) {
    const cup = close.slice(i - cupWindow - handleWindow, i - handleWindow);
    if (cup.length < cupWindow) continue;
    const handle = close.slice(i - handleWindow, i);

    const cupStart = cup[0];
    const cupEnd = cup[cup.length - 1];
    const cupMin = Math.min(...cup);
    const cupDepth = cupStart - cupMin;
    if (cupDepth <= 0) continue;

    const recovered = cupStart === 0 || Math.abs(cupEnd - cupStart) / cupStart < 0.05;
    const handleDepth = handle[0] - Math.min(...handle);
    const shallowHandle = handleDepth < cupDepth * depthTol;
    const breakout = close[i] > cupStart;

    if (recovered && shallowHandle && breakout) out[i] = 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function shiftSeries(s: Series, n: number): Series {
  const out: Series = new Array(s.length).fill(Number.NaN);
  for (let i = 0; i < s.length; i++) {
    const j = i - n;
    if (j >= 0) out[i] = s[j];
  }
  return out;
}

function shiftBool(m: boolean[], n: number): boolean[] {
  const out: boolean[] = new Array(m.length).fill(false);
  for (let i = 0; i < m.length; i++) {
    const j = i - n;
    if (j >= 0) out[i] = m[j];
  }
  return out;
}

function ffill(s: Series): Series {
  const out: Series = new Array(s.length);
  let last = Number.NaN;
  for (let i = 0; i < s.length; i++) {
    if (isNA(s[i])) out[i] = last;
    else {
      out[i] = s[i];
      last = s[i];
    }
  }
  return out;
}

export { fromMask, notMask };
