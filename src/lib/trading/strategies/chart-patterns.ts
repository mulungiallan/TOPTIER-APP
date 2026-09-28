/**
 * Strategies #39-48 - Chart & Candlestick Patterns.
 *
 * Faithful port of `strategies/chart_patterns.py`. The detection math already
 * lives in `patterns.ts`; these wrappers add the entry convention (targets and
 * trailing stops are the backtester's job, not the strategy's).
 */

import { Series, gt, lt } from "./../series";
import { OHLCVColumns, sma } from "../indicators";
import {
  cupAndHandle,
  doji,
  doubleTopBottom,
  engulfing,
  hammerShootingStar,
  headAndShoulders,
  insideBarBreakout,
  morningEveningStar,
  threeSoldiersCrows,
  triangleWedgeBreakout,
} from "../patterns";

// ─── #39 ──────────────────────────────────────────────────────────────────────
export function s39HeadAndShoulders(df: OHLCVColumns, window = 5, tolerance = 0.03): Series {
  return headAndShoulders(df, window, tolerance);
}

// ─── #40 ──────────────────────────────────────────────────────────────────────
export function s40DoubleTopBottom(df: OHLCVColumns, window = 5, tolerance = 0.02): Series {
  return doubleTopBottom(df, window, tolerance);
}

// ─── #41 ──────────────────────────────────────────────────────────────────────
export function s41CupAndHandle(
  df: OHLCVColumns,
  cupWindow = 60,
  handleWindow = 15,
  depthTol = 0.5
): Series {
  return cupAndHandle(df, cupWindow, handleWindow, depthTol);
}

// ─── #42 ──────────────────────────────────────────────────────────────────────
export function s42WedgeBreakout(df: OHLCVColumns, window = 5, lookback = 100): Series {
  return triangleWedgeBreakout(df, window, lookback);
}

// ─── #43 ──────────────────────────────────────────────────────────────────────
/** Bullish engulfing in a downtrend, bearish engulfing in an uptrend. */
export function s43EngulfingReversal(df: OHLCVColumns, trendMa = 50): Series {
  const raw = engulfing(df);
  const ma = sma(df.close, trendMa);
  const trendDown = lt(df.close, ma);
  const trendUp = gt(df.close, ma);

  const signal: Series = new Array(df.close.length).fill(0);
  for (let i = 0; i < signal.length; i++) {
    if (raw[i] === 1 && trendDown[i]) signal[i] = 1;
    else if (raw[i] === -1 && trendUp[i]) signal[i] = -1;
  }
  return signal;
}

// ─── #44 ──────────────────────────────────────────────────────────────────────
export function s44HammerShootingStar(df: OHLCVColumns, wickBodyRatio = 2.0): Series {
  return hammerShootingStar(df, wickBodyRatio);
}

// ─── #45 ──────────────────────────────────────────────────────────────────────
/**
 * Fires on the bar AFTER the doji, using only that bar's own open/close - so
 * there is no lookahead despite the reference computing the next bar first.
 */
export function s45DojiConfirmation(df: OHLCVColumns, bodyRatioThreshold = 0.1): Series {
  const isDoji = doji(df, bodyRatioThreshold);
  const prevDoji = isDoji.map((_, i) => (i === 0 ? false : isDoji[i - 1]));

  const signal: Series = new Array(df.close.length).fill(0);
  for (let i = 0; i < signal.length; i++) {
    if (!prevDoji[i]) continue;
    if (df.close[i] > df.open[i]) signal[i] = 1;
    else if (df.close[i] < df.open[i]) signal[i] = -1;
  }
  return signal;
}

// ─── #46 ──────────────────────────────────────────────────────────────────────
export function s46MorningEveningStar(df: OHLCVColumns): Series {
  return morningEveningStar(df);
}

// ─── #47 ──────────────────────────────────────────────────────────────────────
export function s47InsideBarBreakout(df: OHLCVColumns): Series {
  return insideBarBreakout(df);
}

// ─── #48 ──────────────────────────────────────────────────────────────────────
/**
 * Three soldiers / crows, optionally gated on trend. With `trendFilter` off the
 * raw pattern series is returned unchanged, as in the reference.
 */
export function s48ThreeSoldiersCrows(
  df: OHLCVColumns,
  trendFilter = true,
  trendMa = 50
): Series {
  const raw = threeSoldiersCrows(df);
  if (!trendFilter) return raw;

  const ma = sma(df.close, trendMa);
  const trendUp = gt(df.close, ma);
  const trendDown = lt(df.close, ma);

  const signal: Series = new Array(df.close.length).fill(0);
  for (let i = 0; i < signal.length; i++) {
    if (raw[i] === 1 && trendUp[i]) signal[i] = 1;
    else if (raw[i] === -1 && trendDown[i]) signal[i] = -1;
  }
  return signal;
}
