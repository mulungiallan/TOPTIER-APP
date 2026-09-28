/**
 * Strategies #1-15 - Trend & Momentum.
 *
 * Faithful port of `strategies/trend_momentum.py`. Single-asset strategies take
 * OHLCV columns and return a 1/-1/0 signal series, except #11, #12 and #13
 * which are portfolio-level in the reference too and take multiple price
 * series instead.
 */

import {
  Series,
  andMask,
  ffill,
  fillna,
  isNA,
  gt,
  lt,
  shift,
} from "../series";
import {
  OHLCVColumns,
  atr,
  donchianChannels,
  ema,
  ichimoku,
  macd,
  parabolicSar,
  roc,
  rsi,
  sma,
  supertrend,
} from "../indicators";
import { triangleWedgeBreakout } from "../patterns";
import { bandBreakoutSignal, crossoverSignal, trendFilterAdx } from "../engines";

export type MaType = "sma" | "ema";

function ma(close: Series, period: number, type: MaType): Series {
  return type === "ema" ? ema(close, period) : sma(close, period);
}

// ─── #1 ──────────────────────────────────────────────────────────────────────
export function s01MaCrossover(
  df: OHLCVColumns,
  fast = 10,
  slow = 50,
  maType: MaType = "sma"
): Series {
  return crossoverSignal(ma(df.close, fast, maType), ma(df.close, slow, maType));
}

// ─── #2 ──────────────────────────────────────────────────────────────────────
export function s02GoldenDeathCross(df: OHLCVColumns, fast = 50, slow = 200): Series {
  return s01MaCrossover(df, fast, slow, "sma");
}

// ─── #3 ──────────────────────────────────────────────────────────────────────
export function s03MacdCrossover(
  df: OHLCVColumns,
  fast = 12,
  slow = 26,
  signal = 9,
  zeroLineFilter = false
): Series {
  const m = macd(df.close, fast, slow, signal);
  let sig = crossoverSignal(m.macd, m.signal);
  if (zeroLineFilter) {
    // Suppress longs below the zero line and shorts above it.
    sig = sig.map((v, i) =>
      v === 1 && lt(m.macd, 0)[i] ? 0 : v === -1 && gt(m.macd, 0)[i] ? 0 : v
    );
  }
  return sig;
}

// ─── #4 ──────────────────────────────────────────────────────────────────────
export function s04AdxTrendGate(df: OHLCVColumns, period = 14, threshold = 25): Series {
  const [isTrending, direction] = trendFilterAdx(df, period, threshold);
  return direction.map((v, i) => (isTrending[i] ? v : 0));
}

// ─── #5 ──────────────────────────────────────────────────────────────────────
export function s05DonchianBreakout(df: OHLCVColumns, period = 20): Series {
  const dc = donchianChannels(df, period);
  return bandBreakoutSignal(df.close, dc.upper, dc.lower);
}

// ─── #6 ──────────────────────────────────────────────────────────────────────
/**
 * Turtle system. Returns both the signal and ATR-based position size, as the
 * reference does - Turtle needs the sizing to be faithful, not optional.
 */
export function s06TurtleSystem(
  df: OHLCVColumns,
  entryPeriod = 20,
  exitPeriod = 10,
  atrPeriod = 20,
  accountEquity = 100_000,
  riskPct = 0.01
): { signal: Series; size: Series } {
  const entryCh = donchianChannels(df, entryPeriod);
  const exitCh = donchianChannels(df, exitPeriod);
  const n = atr(df, atrPeriod);

  const signal: Series = new Array(df.close.length).fill(0);
  let position = 0;
  for (let i = 1; i < df.close.length; i++) {
    const c = df.close[i];
    // NaN band comparisons are false, so warm-up bars simply cannot enter.
    if (position === 0) {
      if (c > entryCh.upper[i - 1]) position = 1;
      else if (c < entryCh.lower[i - 1]) position = -1;
    } else if (position === 1 && c < exitCh.lower[i - 1]) position = 0;
    else if (position === -1 && c > exitCh.upper[i - 1]) position = 0;
    signal[i] = position;
  }

  const dollarRisk = accountEquity * riskPct;
  const size = n.map((a) => (a <= 0 || isNA(a) ? 0 : dollarRisk / a));
  return { signal, size };
}

// ─── #7 ──────────────────────────────────────────────────────────────────────
export function s07ParabolicSar(
  df: OHLCVColumns,
  afStart = 0.02,
  afStep = 0.02,
  afMax = 0.2
): Series {
  return crossoverSignal(df.close, parabolicSar(df, afStart, afStep, afMax));
}

// ─── #8 ──────────────────────────────────────────────────────────────────────
export function s08Ichimoku(
  df: OHLCVColumns,
  tenkanP = 9,
  kijunP = 26,
  senkouBP = 52,
  displacement = 26
): Series {
  const ich = ichimoku(df, tenkanP, kijunP, senkouBP, displacement);
  // Rowwise max/min across the two senkou lines. rowMaxSkipna is used for max;
  // min must skip NaN symmetrically, hence the explicit two-value form.
  const cloudTop = ich.senkouA.map((a, i) =>
    isNA(a) ? ich.senkouB[i] : isNA(ich.senkouB[i]) ? a : Math.max(a, ich.senkouB[i])
  );
  const cloudBottom = ich.senkouA.map((a, i) =>
    isNA(a) ? ich.senkouB[i] : isNA(ich.senkouB[i]) ? a : Math.min(a, ich.senkouB[i])
  );
  const aboveCloud = gt(df.close, cloudTop);
  const belowCloud = lt(df.close, cloudBottom);
  const tkCross = crossoverSignal(ich.tenkan, ich.kijun);

  const signal: Series = new Array(df.close.length).fill(0);
  for (let i = 0; i < signal.length; i++) {
    if (tkCross[i] === 1 && aboveCloud[i]) signal[i] = 1;
    else if (tkCross[i] === -1 && belowCloud[i]) signal[i] = -1;
  }
  // replace(0, NaN).ffill().fillna(0): hold the last confirmed reading.
  return fillna(
    ffill(
      signal.map((v) => (v === 0 ? NaN : v))
    ),
    0
  );
}

// ─── #9 ──────────────────────────────────────────────────────────────────────
export function s09Supertrend(df: OHLCVColumns, period = 10, multiplier = 3.0): Series {
  return supertrend(df, period, multiplier).direction;
}

// ─── #10 ─────────────────────────────────────────────────────────────────────
export function s10MomentumRoc(df: OHLCVColumns, period = 10, threshold = 0.0): Series {
  const r = roc(df.close, period);
  const signal: Series = new Array(df.close.length).fill(NaN);
  const above = gt(r, threshold);
  const below = r.map((v) => v < -threshold);
  for (let i = 0; i < signal.length; i++) {
    if (above[i]) signal[i] = 1;
    else if (below[i]) signal[i] = -1;
  }
  return fillna(ffill(signal), 0);
}

// ─── #11 ─────────────────────────────────────────────────────────────────────
/**
 * Relative-strength rotation across a universe of assets.
 *
 * Portfolio-level in the reference too: `prices` is wide (one entry per asset)
 * and the return is target weights, not a single signal series.
 *
 * The reference rebalances with `prices.resample("M")`, which needs a
 * DatetimeIndex, so `ts` (bar timestamps in epoch ms) is required to reproduce
 * the same rebalance dates. Without it we fall back to a 21-bar cadence, which
 * only approximates a monthly rebalance on daily bars.
 */
export function s11RelativeStrengthRotation(
  prices: Record<string, Series>,
  lookback = 63,
  topK = 3,
  ts?: number[]
): Record<string, Series> {
  const names = Object.keys(prices);
  const len = names.length > 0 ? prices[names[0]].length : 0;

  // Trailing `lookback` return per asset, NaN during warm-up.
  const rets: Record<string, Series> = {};
  for (const name of names) {
    const p = prices[name];
    rets[name] = p.map((v, i) =>
      i < lookback || isNA(p[i - lookback]) || p[i - lookback] === 0
        ? NaN
        : v / p[i - lookback] - 1
    );
  }

  const weights: Record<string, Series> = {};
  for (const name of names) weights[name] = new Array(len).fill(0);

  // A rebalance date applies from that bar onward, matching `weights.loc[d:, :]`.
  const isRebalance = ts
    ? isLastBarOfMonth(ts)
    : (i: number) => i > 0 && (i + 1) % 21 === 0;

  let current: string[] = [];
  for (let i = 0; i < len; i++) {
    if (isRebalance(i)) {
      current = names
        .filter((n) => !isNA(rets[n][i]))
        .sort((a, b) => (rets[b][i] as number) - (rets[a][i] as number))
        .slice(0, topK);
    }
    const w = current.length > 0 ? 1 / current.length : 0;
    for (const n of names) weights[n][i] = current.includes(n) ? w : 0;
  }
  return weights;
}

/** True on the final bar of each calendar month, matching `resample("M").last()`. */
function isLastBarOfMonth(ts: number[]): (i: number) => boolean {
  const monthOf = (i: number) => {
    const d = new Date(ts[i]);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
  return (i: number) => i === ts.length - 1 || monthOf(i) !== monthOf(i + 1);
}

// ─── #12 ─────────────────────────────────────────────────────────────────────
/** True where an asset is within `proximity` of its `lookback`-bar high. */
export function s12NewHighMomentum(
  prices: Record<string, Series>,
  lookback = 252,
  proximity = 0.05
): Record<string, boolean[]> {
  const out: Record<string, boolean[]> = {};
  for (const [name, p] of Object.entries(prices)) {
    const flags: boolean[] = new Array(p.length);
    for (let i = 0; i < p.length; i++) {
      if (i < lookback - 1 || isNA(p[i])) {
        flags[i] = false;
        continue;
      }
      let hi = NaN;
      for (let j = i - lookback + 1; j <= i; j++) {
        if (isNA(p[j])) continue;
        hi = isNA(hi) ? p[j] : Math.max(hi, p[j]);
      }
      flags[i] = isNA(hi) ? false : p[i] >= hi * (1 - proximity);
    }
    out[name] = flags;
  }
  return out;
}

// ─── #13 ─────────────────────────────────────────────────────────────────────
/** 1 = hold asset, -1 = hold benchmark, 0 = hold cash. */
export function s13DualMomentum(
  asset: Series,
  benchmark: Series,
  cashReturn = 0.0,
  lookback = 252
): Series {
  const ret = (s: Series): Series =>
    s.map((v, i) =>
      i < lookback || isNA(s[i - lookback]) || s[i - lookback] === 0
        ? NaN
        : v / s[i - lookback] - 1
    );
  const assetRet = ret(asset);
  const benchRet = ret(benchmark);
  const signal: Series = new Array(asset.length).fill(0);
  for (let i = 0; i < signal.length; i++) {
    const a = assetRet[i];
    const b = benchRet[i];
    const better = !isNA(a) && !isNA(b) && a > b;
    const notBetter = !isNA(a) && !isNA(b) && a <= b;
    if (better && a > cashReturn) signal[i] = 1;
    else if (notBetter && b > cashReturn) signal[i] = -1;
  }
  return signal;
}

// ─── #14 ─────────────────────────────────────────────────────────────────────
export function s14TrendlineChannel(
  df: OHLCVColumns,
  window = 5,
  lookback = 100
): Series {
  return triangleWedgeBreakout(df, window, lookback);
}

// ─── #15 ─────────────────────────────────────────────────────────────────────
export function s15BuyTheDip(
  df: OHLCVColumns,
  trendMa = 200,
  rsiPeriod = 14,
  rsiDip = 40
): Series {
  const trendUp = gt(df.close, sma(df.close, trendMa));
  const r = rsi(df.close, rsiPeriod);
  const prevR = shift(r, 1);
  const dip = lt(r, rsiDip);
  const recovering = gt(r, prevR);
  const signal: Series = new Array(df.close.length).fill(0);
  const hit = andMask(andMask(trendUp, dip), recovering);
  for (let i = 0; i < signal.length; i++) if (hit[i]) signal[i] = 1;
  return signal;
}
