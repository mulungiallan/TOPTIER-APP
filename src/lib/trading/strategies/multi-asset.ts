/**
 * Portfolio-level strategies #11, #12, #13, #21, #22, #28.
 *
 * These are the members of the #1-48 band that are NOT single-asset: they take
 * wide frames (one column per asset) and/or return a frame of per-asset signals
 * rather than one 0/+1/-1 series. They are kept out of the single-asset modules
 * so the "fn(df) -> Series" convention still holds for the other 42.
 *
 * Two reference defects are documented at the call sites below (#11's legacy
 * pandas offset and its divide-by-zero). Everything else here is a faithful
 * port pinned by `multi-asset.test.ts`.
 */

import {
  Series,
  ffill,
  fillna,
  isNA,
  rollingCov,
  rollingMax,
  rollingStd,
  shift,
} from "../series";
import { zscore } from "../indicators";
import { zscoreSignal } from "../engines";

/** A wide price frame: one Series per asset, all the same length and index. */
export type Wide = Record<string, Series>;

/** `pct_change(n)`: price / price.shift(n) - 1, with pandas' inf-on-zero. */
function pctChange(s: Series, n: number): Series {
  const prev = shift(s, n);
  return s.map((v, i) => (isNA(v) || isNA(prev[i]) ? NaN : prev[i] === 0 ? Infinity : v / prev[i] - 1));
}

// ─── #11 ──────────────────────────────────────────────────────────────────────
/**
 * Relative-strength rotation: at each rebalance date, hold equal weight in the
 * `topK` assets with the best `lookback`-period return.
 *
 * DEVIATION FROM THE REFERENCE (two documented defects in `trend_momentum.py`):
 *   1. The reference's `rebalance="M"` is a legacy pandas offset alias that
 *      pandas 2.2+ rejects ("use 'ME' instead"). We accept "M" and map it to
 *      calendar month-end.
 *   2. The reference raises ZeroDivisionError on any real dataset: the first
 *      month-end always lands inside the `lookback` warm-up, so every return is
 *      NaN, `nlargest` returns nothing, and `1.0 / len(top)` divides by zero.
 *      Here a rebalance with no eligible assets is skipped and the previous
 *      weights carry forward, which is the only sensible reading.
 */
export function s11RelativeStrengthRotation(
  prices: Wide,
  ts: number[],
  lookback = 63,
  topK = 3,
  rebalance: "M" | "ME" | "Q" | "QE" = "M"
): Wide {
  const assets = Object.keys(prices);
  const n = prices[assets[0]].length;
  const returns: Wide = {};
  for (const a of assets) returns[a] = pctChange(prices[a], lookback);

  // Calendar month-end (or quarter-end) stamps, matching resample("M"/"Q").
  // pandas labels each resample bucket with the LAST timestamp in it, so the
  // rebalance happens ON the final bar of the month - not on the first bar of
  // the next one.
  const rebal = new Set<number>();
  for (let i = 1; i < n; i++) {
    if (periodKey(ts[i - 1], rebalance) !== periodKey(ts[i], rebalance)) rebal.add(i - 1);
  }

  const weights: Wide = {};
  for (const a of assets) weights[a] = new Array(n).fill(0);

  // Each rebalance overwrites the whole tail, so the surviving weights form a
  // step function that changes at every rebalance date.
  for (const d of [...rebal].sort((x, y) => x - y)) {
    const ranked = assets
      .filter((a) => !isNA(returns[a][d]))
      .sort((x, y) => returns[y][d] - returns[x][d]); // stable: ties keep input order
    const top = ranked.slice(0, topK);
    if (top.length === 0) continue; // the guard the reference is missing
    for (const a of assets) for (let i = d; i < n; i++) weights[a][i] = 0;
    for (const a of top) for (let i = d; i < n; i++) weights[a][i] = 1 / top.length;
  }

  const out: Wide = {};
  for (const a of assets) out[a] = fillna(ffill(weights[a]), 0);
  return out;
}

/** `resample` bucket label: calendar month, or calendar quarter for "Q"/"QE". */
function periodKey(ts: number, rebalance: "M" | "ME" | "Q" | "QE"): string {
  const d = new Date(ts);
  if (rebalance === "Q" || rebalance === "QE") {
    return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  }
  return d.toISOString().slice(0, 7);
}

// ─── #12 ──────────────────────────────────────────────────────────────────────
/** True where an asset is within `proximity` of its `lookback`-period high. */
export function s12NewHighMomentum(
  prices: Wide,
  lookback = 252,
  proximity = 0.05
): Record<string, boolean[]> {
  const out: Record<string, boolean[]> = {};
  for (const [name, s] of Object.entries(prices)) {
    const high = rollingMax(s, lookback);
    out[name] = s.map((v, i) => isNA(v) || isNA(high[i]) ? false : v >= high[i] * (1 - proximity));
  }
  return out;
}

// ─── #13 ──────────────────────────────────────────────────────────────────────
/** 1 = hold the asset, -1 = hold the benchmark, 0 = hold cash. */
export function s13DualMomentum(
  asset: Series,
  benchmark: Series,
  cashReturn = 0.0,
  lookback = 252
): Series {
  const assetRet = pctChange(asset, lookback);
  const benchRet = pctChange(benchmark, lookback);
  return assetRet.map((a, i) => {
    const b = benchRet[i];
    const better = !isNA(a) && !isNA(b) && a > b;
    if (better && a > cashReturn) return 1;
    if (!better && !isNA(b) && b > cashReturn) return -1;
    return 0;
  });
}

// ─── #21 ──────────────────────────────────────────────────────────────────────
/**
 * Rolling-OLS pairs trade. `signalA` = +1 means long A / short B, so B is
 * always the exact opposite leg.
 */
export function s21PairsTrading(
  priceA: Series,
  priceB: Series,
  lookback = 60,
  entry = 2.0,
  exit = 0.0,
  stop: number | null = 3.5
): { signalA: Series; signalB: Series; spreadZ: Series } {
  const [spread] = pairSpread(priceA, priceB, lookback);
  const z = zscore(spread, lookback);
  const signalA = zscoreSignal(z, entry, exit, stop);
  return { signalA, signalB: signalA.map((v) => -v), spreadZ: z };
}

/** OLS hedge ratio on a rolling window; spread = log(a) - beta * log(b). */
export function pairSpread(priceA: Series, priceB: Series, lookback = 60): [Series, Series] {
  const logA = priceA.map((v) => Math.log(v));
  const logB = priceB.map((v) => Math.log(v));
  const cov = rollingCov(logA, logB, lookback);
  const varB = rollingStd(logB, lookback, 1).map((v) => v * v);
  const beta = cov.map((c, i) => (isNA(c) || isNA(varB[i]) || varB[i] === 0 ? NaN : c / varB[i]));
  return [logA.map((v, i) => (isNA(v) || isNA(beta[i]) ? NaN : v - beta[i] * logB[i])), beta];
}

// ─── #22 ──────────────────────────────────────────────────────────────────────
/**
 * Rolling-PCA residual stat arb: on each bar, take the trailing `lookback` log
 * prices, strip each asset's window mean, and take the first principal component
 * as a market factor. Each asset's residual against that factor is z-scored
 * across the window and traded at +/-`entry`.
 *
 * Output is a point signal (not held), and `exit` is accepted only for
 * signature parity with the reference, which never uses it.
 */
export function s22StatArbBasket(
  prices: Wide,
  lookback = 60,
  entry = 2.0,
  exit = 0.0
): Wide {
  void exit;
  const assets = Object.keys(prices);
  const n = prices[assets[0]].length;
  const logP: Series[] = assets.map((a) => prices[a].map((v) => Math.log(v)));

  const out: Wide = {};
  for (const a of assets) out[a] = new Array(n).fill(0);

  const w = lookback;
  for (let i = w; i < n; i++) {
    // C[j][t] = asset j's centred log price, t = window offset 0..w-1
    // (t = 0 is bar i-w, so the CURRENT bar is excluded, as in the reference).
    const C: Series[] = [];
    for (let j = 0; j < assets.length; j++) {
      let sum = 0;
      for (let t = 0; t < w; t++) sum += logP[j][i - w + t];
      const mean = sum / w;
      const col = new Array(w);
      for (let t = 0; t < w; t++) col[t] = logP[j][i - w + t] - mean;
      C.push(col);
    }

    // Sample covariance (ddof = 1), matching np.cov.
    const k = assets.length;
    const cov: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let j = 0; j < k; j++) {
      for (let l = j; l < k; l++) {
        let s = 0;
        for (let t = 0; t < w; t++) s += C[j][t] * C[l][t];
        cov[j][l] = s / (w - 1);
        cov[l][j] = cov[j][l];
      }
    }

    // Largest principal component. eigh orders ascending, so pc1 is the last.
    // The eigenvector's SIGN is arbitrary and provably irrelevant here: flipping
    // it flips the factor returns, and the OLS loading below is invariant to
    // that flip, so the residuals - the only thing that reaches the signal - are
    // unchanged.
    const { vectors } = symmetricEigen(cov);
    const pc1 = vectors[k - 1];

    const f: Series = new Array(w);
    for (let t = 0; t < w; t++) {
      let s = 0;
      for (let j = 0; j < k; j++) s += C[j][t] * pc1[j];
      f[t] = s;
    }

    // OLS slope per asset = S(f, c) / S(f, f)  (numpy polyfit degree-1 slope).
    let sff = 0;
    for (let t = 0; t < w; t++) sff += f[t] * f[t];
    const loadings = C.map((col) => {
      if (sff === 0) return 0;
      let s = 0;
      for (let t = 0; t < w; t++) s += f[t] * col[t];
      return s / sff;
    });

    for (let j = 0; j < k; j++) {
      const resid = new Array(w);
      for (let t = 0; t < w; t++) resid[t] = C[j][t] - f[t] * loadings[j];
      let mean = 0;
      for (let t = 0; t < w; t++) mean += resid[t];
      mean /= w;
      let ss = 0;
      for (let t = 0; t < w; t++) ss += (resid[t] - mean) ** 2;
      // numpy .std() defaults to ddof = 0 (population), unlike pandas.
      const std = Math.sqrt(ss / w);
      const z = (resid[w - 1] - mean) / (std + 1e-9);
      if (z < -entry) out[assets[j]][i] = 1;
      else if (z > entry) out[assets[j]][i] = -1;
    }
  }
  return out;
}

/**
 * Cyclic Jacobi eigendecomposition for a small symmetric matrix.
 * Returns eigenvalues ascending with matching eigenvectors as columns, matching
 * `numpy.linalg.eigh`'s ordering.
 */
function symmetricEigen(input: number[][]): { values: number[]; vectors: number[][] } {
  const n = input.length;
  const a = input.map((r) => r.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );

  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-26) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t =
          (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const kp = a[k][p];
          const kq = a[k][q];
          a[k][p] = c * kp - s * kq;
          a[k][q] = s * kp + c * kq;
        }
        for (let k = 0; k < n; k++) {
          const pk = a[p][k];
          const qk = a[q][k];
          a[p][k] = c * pk - s * qk;
          a[q][k] = s * pk + c * qk;
        }
        for (let k = 0; k < n; k++) {
          const kp = v[k][p];
          const kq = v[k][q];
          v[k][p] = c * kp - s * kq;
          v[k][q] = s * kp + c * kq;
        }
      }
    }
  }

  const pairs = Array.from({ length: n }, (_, i) => ({
    value: a[i][i],
    vector: v.map((row) => row[i]),
  }));
  pairs.sort((x, y) => x.value - y.value);
  return { values: pairs.map((p) => p.value), vectors: pairs.map((p) => p.vector) };
}

// ─── #28 ──────────────────────────────────────────────────────────────────────
/** True where an asset underperformed the benchmark by more than `thresholdPct`. */
export function s28SectorMeanReversion(
  sectorPrices: Wide,
  benchmark: Series,
  lookback = 20,
  thresholdPct = -5.0
): Record<string, boolean[]> {
  const benchRet = pctChange(benchmark, lookback).map((v) => v * 100);
  const out: Record<string, boolean[]> = {};
  for (const [name, s] of Object.entries(sectorPrices)) {
    const sectorRet = pctChange(s, lookback).map((v) => v * 100);
    out[name] = sectorRet.map((r, i) => !isNA(r) && !isNA(benchRet[i]) && r - benchRet[i] < thresholdPct);
  }
  return out;
}
