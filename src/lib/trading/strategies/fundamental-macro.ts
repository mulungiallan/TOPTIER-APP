/**
 * Strategies #87-94 - Fundamental & Macro.
 *
 * Faithful port of `strategies/fundamental_macro.py`.
 *
 * None of these run off price history alone: they need a fundamentals feed
 * (financial statements), a macro release feed, or an earnings calendar. Each
 * function documents the metric names it expects so a real data provider can be
 * dropped in; the screening and position logic is fully implemented.
 *
 * Two shapes appear repeatedly and are worth knowing:
 *   - the SCREENS (#87-90, #92) return a per-bar boolean or 1/0/-1 mask, one
 *     series per ticker (or per pair of yield series), not a single signal;
 *   - the CALENDAR strategies (#93, #94) need the bar timestamps, so they take
 *     an `index` array of epoch-ms in addition to the prices.
 */

import { Series, isNA, replaceZero, rollingStd } from "../series";
import { zscore } from "../indicators";
import { zscoreSignal } from "../engines";

/** Fundamentals keyed by metric, one series per metric (e.g. `pe`, `roe`). */
export type Metrics = Record<string, Series>;

/** `np.sign`, which propagates NaN exactly as numpy does. */
function sign(s: Series): Series {
  return s.map((v) => (isNA(v) ? NaN : v > 0 ? 1 : v < 0 ? -1 : 0));
}

// ─── #87 ──────────────────────────────────────────────────────────────────────
/**
 * Deep-value screen on `pe`, `pb` and `debt_equity`. When `price` and
 * `intrinsicValue` are both supplied the screen is additionally gated on the
 * market price being at least `marginOfSafety` below the estimate.
 */
export function s87ValueInvesting(
  fundamentals: Metrics,
  peMax = 15,
  pbMax = 1.5,
  debtEquityMax = 1.0,
  marginOfSafety = 0.2,
  price?: Series,
  intrinsicValue?: Series
): boolean[] {
  const { pe, pb, debtEquity } = requireMetrics(fundamentals, ["pe", "pb", "debt_equity"]);
  const screen = pe.map(
    (p, i) =>
      !isNA(p) && p < peMax && !isNA(pb[i]) && pb[i] < pbMax && !isNA(debtEquity[i]) && debtEquity[i] < debtEquityMax
  );
  if (price === undefined || intrinsicValue === undefined) return screen;
  const undervalued = price.map(
    (p, i) => !isNA(p) && !isNA(intrinsicValue[i]) && p < intrinsicValue[i] * (1 - marginOfSafety)
  );
  return screen.map((v, i) => v && undervalued[i]);
}

function requireMetrics(metrics: Metrics, names: string[]): Record<string, Series> {
  const out: Record<string, Series> = {};
  for (const name of names) {
    const s = metrics[name];
    if (!s) throw new Error(`screen needs a "${name}" metric`);
    out[name === "debt_equity" ? "debtEquity" : name] = s;
  }
  return out;
}

// ─── #88 ──────────────────────────────────────────────────────────────────────
/** GARP-style growth screen: both earnings AND revenue must be compounding. */
export function s88GrowthInvesting(
  fundamentals: Metrics,
  epsGrowthMin = 15.0,
  revenueGrowthMin = 10.0
): boolean[] {
  const { eps_growth_yoy_pct: eps, revenue_growth_yoy_pct: rev } = requireMetrics(fundamentals, [
    "eps_growth_yoy_pct",
    "revenue_growth_yoy_pct",
  ]);
  return eps.map(
    (e, i) => !isNA(e) && e > epsGrowthMin && !isNA(rev[i]) && rev[i] > revenueGrowthMin
  );
}

// ─── #89 ──────────────────────────────────────────────────────────────────────
/**
 * PEG screen. The growth rate is entered in PERCENT (the metric is
 * `eps_growth_yoy_pct`), so a 20% grower at PE 20 screens as PEG 1.0 - the
 * reference divides the raw percent, not the decimal fraction, and that is
 * preserved here rather than silently corrected.
 */
export function s89Garp(fundamentals: Metrics, pegMax = 1.0): boolean[] {
  const { pe, eps_growth_yoy_pct: growth } = requireMetrics(fundamentals, [
    "pe",
    "eps_growth_yoy_pct",
  ]);
  const safeGrowth = replaceZero(growth);
  return pe.map((p, i) => {
    if (isNA(p) || isNA(safeGrowth[i])) return false;
    return p / safeGrowth[i] < pegMax;
  });
}

// ─── #90 ──────────────────────────────────────────────────────────────────────
/** Dividend-growth screen: yield, a multi-year growth streak, and a payout cap. */
export function s90DividendInvesting(
  fundamentals: Metrics,
  minYield = 2.5,
  minYearsGrowth = 5,
  maxPayoutRatio = 0.6
): boolean[] {
  const { dividend_yield_pct: y, consecutive_years_dividend_growth: yrs, payout_ratio: payout } =
    requireMetrics(fundamentals, [
      "dividend_yield_pct",
      "consecutive_years_dividend_growth",
      "payout_ratio",
    ]);
  return y.map(
    (v, i) =>
      !isNA(v) &&
      v > minYield &&
      !isNA(yrs[i]) &&
      yrs[i] >= minYearsGrowth &&
      !isNA(payout[i]) &&
      payout[i] < maxPayoutRatio
  );
}

// ─── #91 ──────────────────────────────────────────────────────────────────────
/**
 * Macro surprise dashboard. `actual` and `consensus` are aligned per release
 * (GDP, CPI, PMI, ...), and the surprise is expressed in units of its own
 * trailing 20-release standard deviation.
 *
 * This deliberately returns a flag plus a direction rather than a position:
 * global macro is a discretionary overlay, because the tradeable content is in
 * WHY the surprise happened, not its sign.
 */
export function s91GlobalMacroDashboard(
  macroData: { actual: Series; consensus: Series },
  surpriseThreshold = 0.5
): { flagged: boolean[]; direction: Series } {
  const { actual, consensus } = macroData;
  const surprise = actual.map((v, i) => (isNA(v) || isNA(consensus[i]) ? NaN : v - consensus[i]));
  const surpriseZ = surprise.map(
    (v, i) => (isNA(v) ? NaN : v / replaceZero(rollingStd(surprise, 20, 1))[i])
  );
  return {
    flagged: surpriseZ.map((v) => !isNA(v) && Math.abs(v) > surpriseThreshold),
    direction: sign(surpriseZ),
  };
}

// ─── #92 ──────────────────────────────────────────────────────────────────────
/**
 * Yield-curve (2s10s style) mean reversion. A wide spread is faded by betting
 * on flattening, a narrow or inverted one by betting on steepening - hence the
 * sign flip on the generic z-score signal. No stop: a curve inversion is a
 * regime, not a broken relationship.
 */
export function s92YieldCurveTrading(
  shortYield: Series,
  longYield: Series,
  lookback = 252,
  entryZ = 1.5
): Series {
  const spread = longYield.map((v, i) =>
    isNA(v) || isNA(shortYield[i]) ? NaN : v - shortYield[i]
  );
  const z = zscore(spread, lookback);
  return zscoreSignal(z, entryZ, 0.0, null).map((v) => -v);
}

// ─── #93 ──────────────────────────────────────────────────────────────────────
/**
 * Seasonal commodity long: 1 inside the historically favourable window, 0
 * outside. A window whose end month precedes its start month wraps the year
 * (e.g. Nov-Feb). Backtest per commodity before trusting any window.
 */
export function s93CommoditySeasonal(
  index: number[],
  favorableStartMonth = 9,
  favorableEndMonth = 11
): Series {
  const inWindow = (month: number): boolean =>
    favorableStartMonth <= favorableEndMonth
      ? month >= favorableStartMonth && month <= favorableEndMonth
      : month >= favorableStartMonth || month <= favorableEndMonth;
  return index.map((ts) => (inWindow(utcMonth(ts)) ? 1 : 0));
}

/** Calendar month, 1-12, in UTC - matching what the reference's index yields. */
export function utcMonth(ts: number): number {
  return new Date(ts).getUTCMonth() + 1;
}

/** Calendar day of month, 1-31, in UTC. */
export function utcDay(ts: number): number {
  return new Date(ts).getUTCDate();
}

/** Calendar year in UTC. */
export function utcYear(ts: number): number {
  return new Date(ts).getUTCFullYear();
}

// ─── #94 ──────────────────────────────────────────────────────────────────────
/** EPS surprise %, keyed by the release date as an epoch-ms string. */
export type SurpriseByDate = Record<string, number>;

/**
 * Post-earnings-announcement drift: long after a beat, short after a miss, held
 * for `driftHoldDays` bars from the release.
 *
 * Later releases overwrite earlier ones on any bar they overlap, matching the
 * reference's sequential `.loc[window] = direction` assignment.
 */
export function s94EarningsAnnouncementTrading(
  index: number[],
  earningsDates: number[],
  surprisePct: SurpriseByDate,
  driftHoldDays = 10,
  surpriseThreshold = 5.0
): Series {
  const signal: Series = new Array(index.length).fill(0);
  for (const d of earningsDates) {
    const surprise = surprisePct[String(d)];
    if (surprise === undefined) continue; // no surprise for this release
    if (Math.abs(surprise) < surpriseThreshold) continue;
    const direction = surprise > 0 ? 1 : -1;
    let held = 0;
    for (let i = 0; i < index.length && held < driftHoldDays; i++) {
      if (index[i] >= d) {
        signal[i] = direction;
        held += 1;
      }
    }
  }
  return signal;
}
