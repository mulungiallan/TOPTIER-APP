/**
 * Strategies #29-38 - Breakout & Range.
 *
 * Faithful port of `strategies/breakout_range.py`.
 *
 * Note on #30: the reference requires intraday bars with a DatetimeIndex and
 * groups bars into sessions. It takes an optional `sessionId` array here for
 * the same purpose. With no session map (i.e. on daily bars) every bar is its
 * own session, the session is never longer than `openingBars`, and the strategy
 * correctly never fires - which is exactly what the reference does on daily
 * data.
 */

import {
  Series,
  andMask,
  ffill,
  fillna,
  gt,
  isNA,
  lt,
  notMask,
  rollingMax,
  rollingMin,
  roundHalfToEven,
  shift,
  sub,
} from "../series";
import {
  OHLCVColumns,
  atr,
  bollingerBands,
  donchianChannels,
  keltnerChannels,
  rollingPivots,
} from "../indicators";
import { triangleWedgeBreakout } from "../patterns";
import { applyFilter, bandBreakoutSignal, volumeConfirms } from "../engines";

/** `Series.replace(0, NaN).ffill().fillna(0)` - the reference's "hold last" idiom. */
function holdLast(signal: Series): Series {
  return fillna(
    ffill(
      signal.map((v) => (v === 0 ? NaN : v))
    ),
    0
  );
}

// ─── #29 ──────────────────────────────────────────────────────────────────────
export function s29RangeBreakout(df: OHLCVColumns, period = 20): Series {
  const upper = rollingMax(df.high, period);
  const lower = rollingMin(df.low, period);
  return bandBreakoutSignal(df.close, upper, lower);
}

// ─── #30 ──────────────────────────────────────────────────────────────────────
export function s30OpeningRangeBreakout(
  df: OHLCVColumns,
  openingBars = 15,
  sessionId?: number[]
): Series {
  const signal: Series = new Array(df.close.length).fill(0);
  const n = df.close.length;

  // With no session map each bar is its own session, so the session length is 1
  // and the `len <= openingBars` guard skips every bar - matching the reference.
  const sessions = sessionId ?? df.close.map((_, i) => i);

  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sessions[j + 1] === sessions[i]) j++;
    const len = j - i + 1;
    if (len > openingBars) {
      let orHigh = NaN;
      let orLow = NaN;
      for (let k = i; k < i + openingBars; k++) {
        if (isNA(orHigh) || df.high[k] > orHigh) orHigh = df.high[k];
        if (isNA(orLow) || df.low[k] < orLow) orLow = df.low[k];
      }
      let position = 0;
      for (let k = i + openingBars; k <= j; k++) {
        const c = df.close[k];
        if (position === 0) {
          if (c > orHigh) position = 1;
          else if (c < orLow) position = -1;
        }
        signal[k] = position;
      }
    }
    i = j + 1;
  }
  return signal;
}

// ─── #31 ──────────────────────────────────────────────────────────────────────
export function s31VolatilitySqueezeBreakout(
  df: OHLCVColumns,
  bbPeriod = 20,
  bbStd = 2.0,
  kcPeriod = 20,
  kcMult = 1.5
): Series {
  const bb = bollingerBands(df.close, bbPeriod, bbStd);
  const kc = keltnerChannels(df, kcPeriod, kcMult);
  const squeezeOn = andMask(lt(bb.upper, kc.upper), gt(bb.lower, kc.lower));
  const prevSqueeze = squeezeOn.map((_, i) => (i === 0 ? false : squeezeOn[i - 1]));
  const squeezeRelease = andMask(prevSqueeze, notMask(squeezeOn));
  // 3-bar momentum.
  const momentum = sub(df.close, shift(df.close, 3));

  const signal: Series = new Array(df.close.length).fill(0);
  for (let i = 0; i < signal.length; i++) {
    if (!squeezeRelease[i] || isNA(momentum[i])) continue;
    if (momentum[i] > 0) signal[i] = 1;
    else if (momentum[i] < 0) signal[i] = -1;
  }
  return holdLast(signal);
}

// ─── #32 ──────────────────────────────────────────────────────────────────────
/**
 * Breakout, then wait for a retest of the broken level within a tolerance band
 * before entering. Exits on a breach of the shorter Donchian channel.
 */
export function s32RetestEntry(
  df: OHLCVColumns,
  period = 20,
  exitPeriod = 10,
  toleranceAtrMult = 0.3,
  confirmBars = 10
): Series {
  const dc = donchianChannels(df, period);
  const exitCh = donchianChannels(df, exitPeriod);
  const a = atr(df, 14);

  const signal: Series = new Array(df.close.length).fill(0);
  let kind: "long" | "short" | null = null;
  let level = NaN;
  let barsLeft = 0;
  let position = 0;

  for (let i = period; i < df.close.length; i++) {
    const c = df.close[i];
    if (position === 0) {
      if (kind === null) {
        if (c > dc.upper[i - 1]) {
          kind = "long";
          level = dc.upper[i - 1];
          barsLeft = confirmBars;
        } else if (c < dc.lower[i - 1]) {
          kind = "short";
          level = dc.lower[i - 1];
          barsLeft = confirmBars;
        }
      } else {
        const tol = toleranceAtrMult * a[i];
        if (kind === "long") {
          if (Math.abs(c - level) <= tol && c > level - tol) {
            position = 1;
            kind = null;
          } else if (c < level - tol) {
            kind = null; // failed retest, invalidate
          }
        } else {
          if (Math.abs(c - level) <= tol && c < level + tol) {
            position = -1;
            kind = null;
          } else if (c > level + tol) {
            kind = null;
          }
        }
        if (kind !== null) {
          barsLeft -= 1;
          if (barsLeft <= 0) kind = null;
        }
      }
    } else if (position === 1 && c < exitCh.lower[i - 1]) position = 0;
    else if (position === -1 && c > exitCh.upper[i - 1]) position = 0;
    signal[i] = position;
  }
  return signal;
}

// ─── #33 ──────────────────────────────────────────────────────────────────────
export function s33FailedBreakoutReversal(
  df: OHLCVColumns,
  period = 20,
  confirmBars = 3
): Series {
  const dc = donchianChannels(df, period);
  const signal: Series = new Array(df.close.length).fill(0);
  let pending: "long" | "short" | null = null;
  let start = 0;

  for (let i = period; i < df.close.length; i++) {
    const c = df.close[i];
    if (pending === null) {
      if (c > dc.upper[i - 1]) {
        pending = "long";
        start = i;
      } else if (c < dc.lower[i - 1]) {
        pending = "short";
        start = i;
      }
    } else {
      const barsSince = i - start;
      if (pending === "long" && c < dc.mid[i]) {
        signal[i] = -1;
        pending = null;
      } else if (pending === "short" && c > dc.mid[i]) {
        signal[i] = 1;
        pending = null;
      } else if (barsSince > confirmBars) {
        pending = null;
      }
    }
  }
  return holdLast(signal);
}

// ─── #34 ──────────────────────────────────────────────────────────────────────
export function s34SupportResistanceBounce(
  df: OHLCVColumns,
  window = 5,
  tolerancePct = 0.5
): Series {
  const { pivotHigh, pivotLow } = rollingPivots(df.close, window);
  // `close.where(piv)` blanks every non-pivot bar, then ffill carries the last
  // level forward. Leading bars stay NaN, which makes the comparisons false.
  const resistanceLevels = ffill(df.close.map((c, i) => (pivotHigh[i] ? c : NaN)));
  const supportLevels = ffill(df.close.map((c, i) => (pivotLow[i] ? c : NaN)));

  const nearSupport = df.close.map(
    (c, i) =>
      !isNA(supportLevels[i]) &&
      supportLevels[i] !== 0 &&
      (Math.abs(c - supportLevels[i]) / supportLevels[i]) * 100 < tolerancePct
  );
  const nearResistance = df.close.map(
    (c, i) =>
      !isNA(resistanceLevels[i]) &&
      resistanceLevels[i] !== 0 &&
      (Math.abs(c - resistanceLevels[i]) / resistanceLevels[i]) * 100 < tolerancePct
  );
  const bullishConfirm = gt(df.close, df.open);
  const bearishConfirm = lt(df.close, df.open);

  const signal: Series = new Array(df.close.length).fill(0);
  for (let i = 0; i < signal.length; i++) {
    if (nearSupport[i] && bullishConfirm[i]) signal[i] = 1;
    else if (nearResistance[i] && bearishConfirm[i]) signal[i] = -1;
  }
  return signal;
}

// ─── #35 ──────────────────────────────────────────────────────────────────────
export function s35TriangleBreakout(df: OHLCVColumns, window = 5, lookback = 100): Series {
  return triangleWedgeBreakout(df, window, lookback);
}

// ─── #36 ──────────────────────────────────────────────────────────────────────
export function s36FlagPennantContinuation(
  df: OHLCVColumns,
  flagpoleLookback = 10,
  flagpoleMovePct = 5.0,
  consolidationBars = 8,
  consolidationRangePct = 2.0
): Series {
  const prevMove = shift(df.close, flagpoleLookback);
  const movePct = df.close.map((c, i) =>
    isNA(prevMove[i]) || prevMove[i] === 0 ? NaN : ((c - prevMove[i]) / prevMove[i]) * 100
  );
  const hiRoll = rollingMax(df.high, consolidationBars);
  const loRoll = rollingMin(df.low, consolidationBars);
  const recentRangePct = df.close.map(
    (c, i) => (isNA(hiRoll[i]) || isNA(loRoll[i]) || c === 0 ? NaN : ((hiRoll[i] - loRoll[i]) / c) * 100)
  );
  const tightConsolidation = recentRangePct.map((v) => v < consolidationRangePct);
  const upShift = shift(movePct, consolidationBars);
  const strongUp = upShift.map((v) => v > flagpoleMovePct);
  const strongDown = upShift.map((v) => v < -flagpoleMovePct);
  const breakoutUp = gt(df.close, shift(hiRoll, 1));
  const breakoutDown = lt(df.close, shift(loRoll, 1));
  // shift(1).fillna(False): the first bar has no prior reading, so it is False.
  // (A boolean shift, since `shift` only operates on numeric series.)
  const prevTight = tightConsolidation.map((_, i) => (i === 0 ? false : tightConsolidation[i - 1]));

  const signal: Series = new Array(df.close.length).fill(0);
  for (let i = 0; i < signal.length; i++) {
    if (!prevTight[i]) continue;
    if (strongUp[i] && breakoutUp[i]) signal[i] = 1;
    else if (strongDown[i] && breakoutDown[i]) signal[i] = -1;
  }
  return signal;
}

// ─── #37 ──────────────────────────────────────────────────────────────────────
export function s37RoundNumberLevels(
  df: OHLCVColumns,
  increment = 1.0,
  tolerancePct = 0.1
): Series {
  const nearestLevel = df.close.map((c) =>
    isNA(c) || increment === 0 ? NaN : roundHalfToEven(c / increment) * increment
  );
  const distPct = df.close.map(
    (c, i) =>
      isNA(nearestLevel[i]) || nearestLevel[i] === 0
        ? NaN
        : (Math.abs(c - nearestLevel[i]) / nearestLevel[i]) * 100
  );
  const nearLevel = distPct.map((v) => v < tolerancePct);
  const bullishConfirm = gt(df.close, df.open);
  const bearishConfirm = lt(df.close, df.open);
  const aboveLevel = gt(df.close, nearestLevel);

  const signal: Series = new Array(df.close.length).fill(0);
  for (let i = 0; i < signal.length; i++) {
    if (!nearLevel[i]) continue;
    if (bullishConfirm[i] && !aboveLevel[i]) signal[i] = 1;
    else if (bearishConfirm[i] && aboveLevel[i]) signal[i] = -1;
  }
  return signal;
}

// ─── #38 ──────────────────────────────────────────────────────────────────────
/** Filter-only: gate an existing breakout signal on above-average volume. */
export function s38VolumeBreakoutConfirmation(
  baseSignal: Series,
  volume: Series,
  lookback = 20,
  mult = 1.5
): Series {
  return applyFilter(baseSignal, volumeConfirms(volume, lookback, mult));
}
