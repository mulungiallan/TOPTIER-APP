/**
 * Strategies #16-28 - Mean Reversion / Counter-Trend.
 *
 * Faithful port of `strategies/mean_reversion.py`. #21, #22 and #28 are
 * multi-asset in the reference (they take wide DataFrames) and are therefore
 * not part of this single-asset port.
 */

import { Series, ffill, fillna, gt, isNA, shift } from "../series";
import {
  OHLCVColumns,
  bollingerBands,
  cci,
  rsi,
  sessionVwap,
  sma,
  stochastic,
  williamsR,
  zscore,
} from "../indicators";
import {
  bandReversionSignal,
  crossoverSignal,
  oscillatorReversionSignal,
  zscoreSignal,
} from "../engines";

/** `s.replace(0, NaN).ffill().fillna(0)` - the reference's "hold last" idiom. */
function holdLast(signal: Series): Series {
  return fillna(
    ffill(
      signal.map((v) => (v === 0 ? NaN : v))
    ),
    0
  );
}

// ─── #16 ──────────────────────────────────────────────────────────────────────
export function s16RsiReversion(
  df: OHLCVColumns,
  period = 14,
  lowTh = 30,
  highTh = 70,
  exitMid = 50
): Series {
  return oscillatorReversionSignal(rsi(df.close, period), lowTh, highTh, exitMid);
}

// ─── #17 ──────────────────────────────────────────────────────────────────────
export function s17ConnorsRsi2(
  df: OHLCVColumns,
  rsiPeriod = 2,
  buyTh = 10,
  sellTh = 90,
  trendMa = 200,
  exitMa = 5
): Series {
  const r = rsi(df.close, rsiPeriod);
  const trendUp = gt(df.close, sma(df.close, trendMa));
  const exitLine = sma(df.close, exitMa);

  const signal: Series = new Array(df.close.length).fill(0);
  let position = 0;
  for (let i = 0; i < signal.length; i++) {
    if (position === 0 && r[i] < buyTh && trendUp[i]) {
      position = 1;
    } else if (
      position === 1 &&
      (df.close[i] > exitLine[i] || r[i] > sellTh)
    ) {
      position = 0;
    }
    signal[i] = position;
  }
  return signal;
}

// ─── #18 ──────────────────────────────────────────────────────────────────────
export function s18BollingerReversion(
  df: OHLCVColumns,
  period = 20,
  numStd = 2.0
): Series {
  const bb = bollingerBands(df.close, period, numStd);
  return bandReversionSignal(df.close, bb.upper, bb.lower, bb.mid);
}

// ─── #19 ──────────────────────────────────────────────────────────────────────
export function s19StochasticReversion(
  df: OHLCVColumns,
  kPeriod = 14,
  dPeriod = 3,
  lowTh = 20,
  highTh = 80
): Series {
  const st = stochastic(df, kPeriod, dPeriod);
  const cross = crossoverSignal(st.k, st.d);
  const signal: Series = new Array(df.close.length).fill(0);
  for (let i = 0; i < signal.length; i++) {
    if (cross[i] === 1 && st.k[i] < lowTh) signal[i] = 1;
    else if (cross[i] === -1 && st.k[i] > highTh) signal[i] = -1;
  }
  return holdLast(signal);
}

// ─── #20 ──────────────────────────────────────────────────────────────────────
export function s20ZscoreReversion(
  df: OHLCVColumns,
  period = 20,
  entry = 2.0,
  exit = 0.0
): Series {
  return zscoreSignal(zscore(df.close, period), entry, exit);
}

// ─── #23 ──────────────────────────────────────────────────────────────────────
export function s23VwapReversion(df: OHLCVColumns, devThresholdPct = 0.5): Series {
  const vwap = sessionVwap(df);
  const dev = df.close.map((c, i) =>
    isNA(vwap[i]) || vwap[i] === 0 ? NaN : ((c - vwap[i]) / vwap[i]) * 100
  );
  const signal: Series = new Array(df.close.length).fill(NaN);
  for (let i = 0; i < signal.length; i++) {
    if (isNA(dev[i])) continue;
    if (dev[i] < -devThresholdPct) signal[i] = 1;
    else if (dev[i] > devThresholdPct) signal[i] = -1;
    // Deviation back inside a tenth of the band flattens the position. This
    // writes 0 (not NaN), so ffill leaves it alone and it stays flat.
    else if (Math.abs(dev[i]) < devThresholdPct * 0.1) signal[i] = 0;
  }
  return fillna(ffill(signal), 0);
}

// ─── #24 ──────────────────────────────────────────────────────────────────────
/**
 * Overnight reversal. The reference generates this at the close and expects the
 * execution layer to act at the next session's open.
 */
export function s24OvernightReversal(
  df: OHLCVColumns,
  momentumLookback = 1,
  thresholdPct = 1.0
): Series {
  const intradayRet = df.close.map((c, i) =>
    df.open[i] === 0 || isNA(df.open[i]) ? NaN : ((c - df.open[i]) / df.open[i]) * 100
  );
  const signal: Series = new Array(df.close.length).fill(0);
  for (let i = 0; i < signal.length; i++) {
    if (isNA(intradayRet[i])) continue;
    if (intradayRet[i] > thresholdPct) signal[i] = -1;
    else if (intradayRet[i] < -thresholdPct) signal[i] = 1;
  }
  void momentumLookback; // vestigial in the reference too: the return is the
  // one-bar intraday move regardless of this value.
  return signal;
}

// ─── #25 ──────────────────────────────────────────────────────────────────────
export function s25CciReversion(
  df: OHLCVColumns,
  period = 20,
  lowTh = -100,
  highTh = 100
): Series {
  return oscillatorReversionSignal(cci(df, period), lowTh, highTh, 0);
}

// ─── #26 ──────────────────────────────────────────────────────────────────────
export function s26WilliamsRReversion(
  df: OHLCVColumns,
  period = 14,
  lowTh = -80,
  highTh = -20
): Series {
  return oscillatorReversionSignal(williamsR(df, period), lowTh, highTh, -50);
}

// ─── #27 ──────────────────────────────────────────────────────────────────────
export function s27FadeTheGap(
  df: OHLCVColumns,
  gapThresholdPct = 1.0,
  maxHoldBars = 5
): Series {
  const prevClose = shift(df.close, 1);
  const gapPct = df.open.map((o, i) =>
    isNA(prevClose[i]) || prevClose[i] === 0
      ? NaN
      : ((o - prevClose[i]) / prevClose[i]) * 100
  );

  const signal: Series = new Array(df.close.length).fill(0);
  let position = 0;
  let holdCount = 0;
  for (let i = 0; i < signal.length; i++) {
    if (position === 0) {
      if (!isNA(gapPct[i])) {
        if (gapPct[i] > gapThresholdPct) {
          position = -1;
          holdCount = 0;
        } else if (gapPct[i] < -gapThresholdPct) {
          position = 1;
          holdCount = 0;
        }
      }
    } else {
      holdCount += 1;
      const filled =
        (position === -1 && df.close[i] <= prevClose[i]) ||
        (position === 1 && df.close[i] >= prevClose[i]);
      if (filled || holdCount >= maxHoldBars) position = 0;
    }
    signal[i] = position;
  }
  return signal;
}
