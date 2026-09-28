/**
 * Strategies #76-86 - Quant, Systematic & Execution.
 *
 * Faithful port of `strategies/quant_systematic.py`.
 *
 * The band splits three ways:
 *   - cross-sectional (#76, #77) and market structure (#78, #82, #83, #84), which
 *     return a signal or a quote series;
 *   - execution scheduling (#80, #81), which returns order slices, not signals;
 *   - sizing (#85, #86), which returns a single number.
 *
 * #79 is deliberately not implementable: latency arbitrage needs exchange
 * co-location, and the reference raises rather than pretending otherwise, so
 * this throws too.
 */

import {
  Series,
  divInf,
  fillna,
  isNA,
  percentile,
  replaceZero,
  rollingMean,
  rollingStd,
  rowSumSkipna,
  roundHalfToEven,
  sumSkipna,
} from "../series";
import { kellyFraction, martingaleSize } from "../engines";
import { Wide } from "./multi-asset";

// ─── #76 ──────────────────────────────────────────────────────────────────────
/**
 * Fundamentals keyed by ticker then metric, e.g.
 * `{ AAPL: { pe: [...], roe: [...], debt_equity: [...], ... } }`.
 *
 * The reference takes a DataFrame with MultiIndex `(ticker, metric)` columns and
 * returns a boolean frame marking the top `topPct` bucket per date. Scores are
 * oriented so that HIGHER IS ALWAYS BETTER, which is why value and low-vol
 * negate the raw metric before the cross-sectional ranking.
 */
export type Fundamentals = Record<string, Record<string, Series>>;

export type FactorName = "value" | "momentum" | "quality" | "low_vol";

/**
 * Per-ticker factor score; higher means more attractive.
 *
 * Scores are oriented so that HIGHER IS ALWAYS BETTER, which is why value and
 * low-vol negate the raw metric before the cross-sectional ranking.
 */
export function s76FactorScores(fundamentals: Fundamentals, factor: FactorName): Wide {
  const metric = (name: string): Wide => {
    const out: Wide = {};
    for (const [ticker, metrics] of Object.entries(fundamentals)) {
      const s = metrics[name];
      if (!s) throw new Error(`factor screen needs a "${name}" metric for ${ticker}`);
      out[ticker] = s;
    }
    return out;
  };
  switch (factor) {
    case "value":
      return negate(metric("pe")); // lower PE = better value
    case "momentum":
      return metric("momentum_12_1");
    case "low_vol":
      return negate(metric("trailing_vol"));
    case "quality": {
      // ROE less leverage, both on the raw scale, so a name is only attractive on
      // this factor if its return on equity genuinely outruns its debt load.
      const roe = metric("roe");
      const debtEquity = metric("debt_equity");
      const out: Wide = {};
      for (const [ticker, r] of Object.entries(roe)) {
        const d = debtEquity[ticker];
        out[ticker] = r.map((v, i) => (isNA(v) || isNA(d[i]) ? NaN : v - d[i]));
      }
      return out;
    }
  }
}

function negate(w: Wide): Wide {
  const out: Wide = {};
  for (const [k, s] of Object.entries(w)) out[k] = s.map((v) => (isNA(v) ? NaN : -v));
  return out;
}

/**
 * Marks the top `topPct` of the cross-section on `factor` at every date.
 *
 * The cutoff is the (1 - topPct) cross-sectional quantile, computed with numpy's
 * default linear interpolation, and NaN scores never qualify because a pandas
 * `ge` against NaN is False.
 */
export function s76FactorInvesting(
  fundamentals: Fundamentals,
  factor: FactorName = "value",
  topPct = 0.2
): Record<string, boolean[]> {
  const scores = s76FactorScores(fundamentals, factor);
  const tickers = Object.keys(scores);
  const n = tickers.length ? scores[tickers[0]].length : 0;
  const out: Record<string, boolean[]> = {};
  for (const t of tickers) out[t] = new Array(n).fill(false);
  const q = 100 * (1 - topPct);
  for (let i = 0; i < n; i++) {
    const row = tickers.map((t) => scores[t][i]);
    const cutoff = percentile(row, q);
    for (let j = 0; j < tickers.length; j++) {
      if (!isNA(scores[tickers[j]][i]) && !isNA(cutoff) && scores[tickers[j]][i] >= cutoff) {
        out[tickers[j]][i] = true;
      }
    }
  }
  return out;
}

// ─── #77 ──────────────────────────────────────────────────────────────────────
/**
 * Inverse-volatility risk parity: every asset gets a weight inversely
 * proportional to its own volatility, then the row is normalised to sum to one.
 *
 * The reference uses `returns.rolling(n).std()`, which is ddof=1, and ends with
 * `.fillna(0)` - so a name that has not warmed up yet holds a 0 weight rather
 * than poisoning the whole row.
 */
export function s77RiskParity(returns: Wide, volLookback = 60): Wide {
  const assets = Object.keys(returns);
  const invVol: Wide = {};
  for (const a of assets) {
    const vol = replaceZero(rollingStd(returns[a], volLookback, 1));
    invVol[a] = divInf(1, vol);
  }
  const totals = rowSumSkipna(...assets.map((a) => invVol[a]));
  const out: Wide = {};
  for (const a of assets) {
    out[a] = fillna(
      invVol[a].map((v, i) => (isNA(v) || totals[i] === 0 ? NaN : v / totals[i])),
      0
    );
  }
  return out;
}

// ─── #78 ──────────────────────────────────────────────────────────────────────
/**
 * Inventory-risk-managed market-making quotes. The further inventory drifts from
 * flat, the further BOTH quotes are pushed the same way, which discourages
 * trades that would double the position.
 *
 * Treat this as a paper-trading model: real market making needs level-2 book
 * access and sub-millisecond latency.
 */
export function s78MarketMaking(
  midPrice: Series,
  baseSpreadPct = 0.1,
  inventory = 0.0,
  maxInventory = 100.0,
  skewFactor = 0.02
): { bid: Series; ask: Series } {
  const halfSpread = midPrice.map((m) => (isNA(m) ? NaN : (m * baseSpreadPct) / 200));
  const skew = midPrice.map((m) =>
    isNA(m) ? NaN : m * skewFactor * (inventory / maxInventory)
  );
  return {
    bid: midPrice.map((m, i) => (isNA(m) || isNA(halfSpread[i]) || isNA(skew[i]) ? NaN : m - halfSpread[i] - skew[i])),
    ask: midPrice.map((m, i) => (isNA(m) || isNA(halfSpread[i]) || isNA(skew[i]) ? NaN : m + halfSpread[i] - skew[i])),
  };
}

// ─── #79 ──────────────────────────────────────────────────────────────────────
/**
 * Not implementable at the application layer. Kept so the strategy registry is
 * complete and so callers get the reference's explanation instead of a silently
 * missing strategy.
 */
export function s79HftLatencyArbitrageNote(): never {
  throw new Error(
    "High-Frequency Trading / latency arbitrage requires exchange co-location " +
      "and specialized hardware infrastructure outside the scope of an " +
      "application-layer strategy library."
  );
}

// ─── #80-81 ───────────────────────────────────────────────────────────────────
/**
 * Slice an order along the historical volume curve. The curve is normalised to
 * 1.0 and the per-bucket sizes are rounded to whole units with pandas'
 * banker's rounding, so a 10,000-share order over a curve that splits 50/50
 * comes out as 5,000 + 5,000 rather than 5,001 + 4,999.
 */
export function s80VwapExecution(orderSize: number, historicalVolumeCurve: Series): Series {
  const total = sumSkipna(historicalVolumeCurve);
  return historicalVolumeCurve.map((v) =>
    isNA(v) || total === 0 ? NaN : roundHalfToEven((v / total) * orderSize)
  );
}

/** Equal slices - no volume profile, so no timing edge. */
export function s81TwapExecution(orderSize: number, numSlices: number): Series {
  const slice = orderSize / numSlices;
  return new Array(numSlices).fill(slice);
}

// ─── #82 ──────────────────────────────────────────────────────────────────────
/**
 * Anything that can turn features into per-bar class probabilities - i.e.
 * exposing `predict_proba` as `[P(down), P(up)]` per row, which is what
 * scikit-learn does.
 */
export interface ProbModel {
  predictProba(features: number[][]): [number, number][];
}

/**
 * Convert a trained model into a signal behind a confidence gate. Training,
 * feature engineering and walk-forward validation are a separate pipeline; this
 * function only reads the probabilities out.
 */
export function s82MlSignalTrading(
  features: Record<string, Series>,
  model: ProbModel,
  confidenceThreshold = 0.6
): Series {
  const names = Object.keys(features);
  const n = names.length ? features[names[0]].length : 0;
  const rows: number[][] = new Array(n);
  for (let i = 0; i < n; i++) rows[i] = names.map((name) => features[name][i]);
  const pUp = model.predictProba(rows).map((p) => p[1]);
  return pUp.map((v) => (v > confidenceThreshold ? 1 : v < 1 - confidenceThreshold ? -1 : 0));
}

// ─── #83 ──────────────────────────────────────────────────────────────────────
/**
 * Trade pre-computed sentiment in [-1, 1] from an external NLP pipeline. The
 * reference smooths first, so the signal is flat until the smoothing window has
 * filled.
 */
export function s83SentimentTrading(
  sentimentScores: Series,
  threshold = 0.3,
  smoothingWindow = 5
): Series {
  const smoothed = rollingMean(sentimentScores, smoothingWindow);
  return smoothed.map((v) => (v > threshold ? 1 : v < -threshold ? -1 : 0));
}

// ─── #84 ──────────────────────────────────────────────────────────────────────
/**
 * Grid trading. Price is expected to bounce between `lowerBound` and
 * `upperBound`, so every grid level it crosses takes a slice against the move.
 *
 * `hardStop` is a REQUIRED safety guard rather than a default preference: grid
 * trading has unbounded risk in a strong trend, and without the stop the position
 * just keeps averaging into it. Note that on a stop-out bar the reference does
 * NOT update its level tracking, so the next bar re-anchors against the last
 * non-stopped level.
 */
export function s84GridTrading(
  price: Series,
  lowerBound: number,
  upperBound: number,
  gridLevels = 10,
  orderSize = 1.0,
  hardStop = true
): Series {
  const levels = linspace(lowerBound, upperBound, gridLevels + 1);
  const signal: Series = new Array(price.length).fill(0.0);
  let position = 0.0;
  let lastLevelIdx: number | null = null;
  for (let i = 0; i < price.length; i++) {
    const p = price[i];
    if (hardStop && !isNA(p) && (p < lowerBound || p > upperBound)) {
      signal[i] = -position; // liquidate everything
      position = 0.0;
      continue;
    }
    const idx = searchsorted(levels, p);
    if (lastLevelIdx !== null && idx !== lastLevelIdx) {
      const direction = idx < lastLevelIdx ? 1 : -1; // price fell -> buy; rose -> sell
      signal[i] = direction * orderSize;
      position += direction * orderSize;
    }
    lastLevelIdx = idx;
  }
  return signal;
}

/** `numpy.linspace(start, stop, num)`. */
export function linspace(start: number, stop: number, num: number): Series {
  if (num <= 0) return [];
  if (num === 1) return [start];
  const step = (stop - start) / (num - 1);
  return new Array(num).fill(0).map((_, i) => start + step * i);
}

/**
 * `numpy.searchsorted(levels, x)` with the default `side="left"`: the count of
 * levels strictly below x, i.e. the first index whose level is >= x. NaN sorts
 * last in numpy, so it returns `levels.length` here too.
 */
export function searchsorted(levels: Series, x: number): number {
  let lo = 0;
  let hi = levels.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (levels[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ─── #85-86 ───────────────────────────────────────────────────────────────────
/**
 * Double the size after each consecutive loss, capped at `maxDoublings`.
 *
 * The reference's own warning stands: this grows the position exponentially on a
 * losing streak, so the caller MUST pair it with an absolute capital-at-risk
 * cap. Past trade P&L, negative for a loss.
 */
export function s85MartingaleSizing(
  tradeResults: number[],
  baseSize = 1.0,
  multiplier = 2.0,
  maxDoublings = 4
): number {
  let consecutiveLosses = 0;
  for (let i = tradeResults.length - 1; i >= 0; i--) {
    if (tradeResults[i] < 0) consecutiveLosses += 1;
    else break;
  }
  return martingaleSize(baseSize, consecutiveLosses, multiplier, maxDoublings);
}

/** Fraction of equity to risk, from the edge and the pay-off ratio. */
export function s86KellySizing(
  winProb: number,
  winLossRatio: number,
  kellyScale = 0.5,
  accountEquity = 100_000
): number {
  return kellyFraction(winProb, winLossRatio, kellyScale) * accountEquity;
}
