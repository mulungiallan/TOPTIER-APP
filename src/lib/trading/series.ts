/**
 * Pandas-compatible Series primitives.
 *
 * The Python reference library (`trading_app/indicators.py`, `patterns.py`) is
 * written against pandas/numpy, and several of its strategies are sensitive to
 * exact NaN placement and warm-up behaviour. These helpers reproduce the
 * specific pandas semantics that library depends on, using `number[]` with
 * `NaN` for missing values:
 *
 *   - `rolling(w, min_periods=w).mean()`      -> NaN until the window is full
 *   - `rolling(w).std(ddof=0)`                -> POPULATION std (n, not n-1)
 *   - `ewm(span=n, adjust=False).mean()`      -> y = a*x + (1-a)*y_prev, seeded
 *                                                 at the first valid observation
 *   - `.replace(0, NaN)` / `.where()`         -> NaN, never Infinity
 *   - `Series.max(axis=1)` across a frame     -> skipna (ignores NaN)
 *
 * Series are plain arrays rather than objects so they serialise cleanly across
 * the API boundary and into the Strategy Lab UI without a conversion layer.
 */

/** A series of numbers where `NaN` means "missing" (pandas `NaN`). */
export type Series = number[];

export const NAN = Number.NaN;

/** True for values pandas would treat as missing/NA. */
export function isNA(v: number | null | undefined): boolean {
  return v === null || v === undefined || Number.isNaN(v);
}

/**
 * Python's builtin `min(a, b)`, which is NOT `Math.min`.
 *
 * CPython implements the two-argument form as "return b if b < a else a", NOT
 * as `a < b ? a : b`. Every comparison against NaN is False, so this makes
 * `min(x, NaN) === x` but `min(NaN, y) === NaN` - first argument wins when the
 * SECOND is NaN, and NaN wins when it is the first. The Supertrend band
 * recursion depends on exactly this, and getting the operand order backwards
 * turned a valid band into NaN and flipped the trend direction. `Math.min`
 * returns NaN in both cases and would diverge too.
 */
export function pyMin(a: number, b: number): number {
  return b < a ? b : a;
}

/** Python's builtin `max(a, b)`. See {@link pyMin} for why this is not `Math.max`. */
export function pyMax(a: number, b: number): number {
  return b > a ? b : a;
}

/** Either a full series or a broadcast scalar. */
export type Operand = Series | number;

/** Elementwise binary op with pandas NaN propagation (NaN op anything = NaN). */
function zipOp(a: Operand, b: Operand, fn: (x: number, y: number) => number): Series {
  const av = Array.isArray(a) ? a : null;
  const bv = Array.isArray(b) ? b : null;
  const n = Math.max(av?.length ?? 0, bv?.length ?? 0);
  const out: Series = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = av ? av[i] : (a as number);
    const y = bv ? bv[i] : (b as number);
    out[i] = isNA(x) || isNA(y) ? NAN : fn(x, y);
  }
  return out;
}

export function add(a: Operand, b: Operand): Series {
  return zipOp(a, b, (x, y) => x + y);
}

export function sub(a: Operand, b: Operand): Series {
  return zipOp(a, b, (x, y) => x - y);
}

export function mul(a: Operand, b: Operand): Series {
  return zipOp(a, b, (x, y) => x * y);
}

export function div(a: Operand, b: Operand): Series {
  return zipOp(a, b, (x, y) => (y === 0 ? NAN : x / y));
}

/** Elementwise `abs`. */
export function abs(s: Operand): Series {
  return zipOp(s, 0, (x) => Math.abs(x));
}

/** Comparison masks. NaN compares False, matching pandas. */
export function gt(a: Operand, b: Operand): boolean[] {
  const av = Array.isArray(a) ? a : null;
  const bv = Array.isArray(b) ? b : null;
  const n = Math.max(av?.length ?? 0, bv?.length ?? 0);
  const out: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = av ? av[i] : (a as number);
    const y = bv ? bv[i] : (b as number);
    out[i] = !isNA(x) && !isNA(y) && x > y;
  }
  return out;
}

export function lt(a: Operand, b: Operand): boolean[] {
  const av = Array.isArray(a) ? a : null;
  const bv = Array.isArray(b) ? b : null;
  const n = Math.max(av?.length ?? 0, bv?.length ?? 0);
  const out: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = av ? av[i] : (a as number);
    const y = bv ? bv[i] : (b as number);
    out[i] = !isNA(x) && !isNA(y) && x < y;
  }
  return out;
}

export function ge(a: Operand, b: Operand): boolean[] {
  const av = Array.isArray(a) ? a : null;
  const bv = Array.isArray(b) ? b : null;
  const n = Math.max(av?.length ?? 0, bv?.length ?? 0);
  const out: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = av ? av[i] : (a as number);
    const y = bv ? bv[i] : (b as number);
    out[i] = !isNA(x) && !isNA(y) && x >= y;
  }
  return out;
}

export function le(a: Operand, b: Operand): boolean[] {
  const av = Array.isArray(a) ? a : null;
  const bv = Array.isArray(b) ? b : null;
  const n = Math.max(av?.length ?? 0, bv?.length ?? 0);
  const out: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = av ? av[i] : (a as number);
    const y = bv ? bv[i] : (b as number);
    out[i] = !isNA(x) && !isNA(y) && x <= y;
  }
  return out;
}

/** `Series.shift(n)`: positive moves values forward, negative looks ahead. */
export function shift(s: Series, n = 1): Series {
  const out: Series = new Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const j = i - n;
    out[i] = j >= 0 && j < s.length ? s[j] : NAN;
  }
  return out;
}

/**
 * Division that reproduces numpy's IEEE behaviour, `x / y`.
 *
 * `div` above deliberately maps a zero denominator to NaN, which is what
 * pandas' `replace(0, NaN)` idiom wants. Several strategies instead divide by a
 * series that is only accidentally zero (a stale price, a zero variance), and
 * numpy gives them +/-Infinity there and NaN only for 0/0 - a materially
 * different signal, since `Infinity > threshold` is True where NaN is False.
 */
export function divInf(a: Operand, b: Operand): Series {
  const av = Array.isArray(a) ? a : null;
  const bv = Array.isArray(b) ? b : null;
  const n = Math.max(av?.length ?? 0, bv?.length ?? 0);
  const out: Series = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = av ? av[i] : (a as number);
    const y = bv ? bv[i] : (b as number);
    if (isNA(x) || isNA(y)) {
      out[i] = NAN;
    } else if (y === 0) {
      out[i] = x === 0 ? NAN : x > 0 ? Infinity : -Infinity;
    } else {
      out[i] = x / y;
    }
  }
  return out;
}

/**
 * pandas `Series.round()` (and `numpy.round`) use banker's rounding - a tie
 * goes to the EVEN neighbour, so 2.5 -> 2 and 3.5 -> 4. `Math.round` rounds
 * half away from zero and disagrees on every exact tie, so the parity
 * comparisons here have to do it explicitly.
 */
export function roundHalfToEven(x: number): number {
  if (!Number.isFinite(x)) return x;
  const fl = Math.floor(x);
  const diff = x - fl;
  if (diff > 0.5) return fl + 1;
  if (diff < 0.5) return fl;
  return fl % 2 === 0 ? fl : fl + 1;
}

/** `Series.cumsum()` - accumulates over the valid values but keeps NaN in place. */
export function cumsum(s: Series): Series {
  const out: Series = new Array(s.length);
  let acc = NAN;
  for (let i = 0; i < s.length; i++) {
    if (!isNA(s[i])) acc = isNA(acc) ? s[i] : acc + s[i];
    out[i] = acc;
  }
  return out;
}

/** Elementwise `replace(0, NaN)`. */
export function replaceZero(s: Series): Series {
  return s.map((v) => (v === 0 ? NAN : v));
}

/** `Series.fillna(value)` - only fills real NaN, leaves valid values alone. */
export function fillna(s: Series, value: number): Series {
  return s.map((v) => (isNA(v) ? value : v));
}

/** `Series.ffill()` - forward-fill NaN from the last valid value. */
export function ffill(s: Series): Series {
  const out: Series = new Array(s.length);
  let last = NAN;
  for (let i = 0; i < s.length; i++) {
    if (isNA(s[i])) out[i] = last;
    else {
      out[i] = s[i];
      last = s[i];
    }
  }
  return out;
}

/** `Series.rolling(w, min_periods=m).mean()` */
export function rollingMean(s: Series, window: number, minPeriods = window): Series {
  const out: Series = new Array(s.length).fill(NAN);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (!isNA(v)) {
      sum += v;
      count += 1;
    }
    if (i >= window) {
      const drop = s[i - window];
      if (!isNA(drop)) {
        sum -= drop;
        count -= 1;
      }
    }
    if (count >= minPeriods) out[i] = sum / count;
  }
  return out;
}

/**
 * `Series.rolling(w, min_periods=m).std(ddof=d)`
 *
 * The reference library uses `ddof=0` (population) for z-score and Bollinger
 * bands, so that is the default here. `ddof=1` is provided for completeness.
 */
export function rollingStd(s: Series, window: number, ddof = 0, minPeriods = window): Series {
  const out: Series = new Array(s.length).fill(NAN);
  const buf: number[] = [];
  for (let i = 0; i < s.length; i++) {
    buf.push(s[i]);
    if (buf.length > window) buf.shift();
    const valid = buf.filter((v) => !isNA(v));
    if (valid.length >= Math.max(minPeriods, ddof + 1) && valid.length === buf.length) {
      const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
      const ss = valid.reduce((a, b) => a + (b - mean) ** 2, 0);
      out[i] = Math.sqrt(ss / (valid.length - ddof));
    }
  }
  return out;
}

/**
 * Rolling sample covariance (ddof = 1), matching `Series.rolling(n).cov()`.
 *
 * Computed as a proper two-pass sum of products rather than the algebraically
 * equivalent `E[ab] - E[a]E[b]`: on log prices (~4.7) that shortcut cancels
 * most of the significant digits and drifts well outside the parity tolerance.
 */
export function rollingCov(a: Series, b: Series, window: number, minPeriods = window): Series {
  const n = a.length;
  const out: Series = new Array(n).fill(NAN);
  for (let i = window - 1; i < n; i++) {
    let sumA = 0;
    let sumB = 0;
    let ok = true;
    for (let k = i - window + 1; k <= i; k++) {
      if (isNA(a[k]) || isNA(b[k])) {
        ok = false;
        break;
      }
      sumA += a[k];
      sumB += b[k];
    }
    if (!ok || i - window + 1 < 0) continue;
    if (window < Math.max(minPeriods, 2)) continue;
    const meanA = sumA / window;
    const meanB = sumB / window;
    let ss = 0;
    for (let k = i - window + 1; k <= i; k++) ss += (a[k] - meanA) * (b[k] - meanB);
    out[i] = ss / (window - 1);
  }
  return out;
}

/** `Series.rolling(w, min_periods=m).max()` */
export function rollingMax(s: Series, window: number, minPeriods = window): Series {
  const out: Series = new Array(s.length).fill(NAN);
  for (let i = 0; i < s.length; i++) {
    const lo = Math.max(0, i - window + 1);
    let best = NAN;
    let count = 0;
    for (let j = lo; j <= i; j++) {
      const v = s[j];
      if (isNA(v)) continue;
      count += 1;
      if (isNA(best) || v > best) best = v;
    }
    if (count >= minPeriods) out[i] = best;
  }
  return out;
}

/** `Series.rolling(w, min_periods=m).min()` */
export function rollingMin(s: Series, window: number, minPeriods = window): Series {
  const out: Series = new Array(s.length).fill(NAN);
  for (let i = 0; i < s.length; i++) {
    const lo = Math.max(0, i - window + 1);
    let best = NAN;
    let count = 0;
    for (let j = lo; j <= i; j++) {
      const v = s[j];
      if (isNA(v)) continue;
      count += 1;
      if (isNA(best) || v < best) best = v;
    }
    if (count >= minPeriods) out[i] = best;
  }
  return out;
}

/**
 * `Series.rolling(w, center=True).max()` - window is centred, so the first and
 * last `w` positions are NaN. Used by the pivot detector.
 */
export function rollingMaxCentered(s: Series, window: number): Series {
  const half = Math.floor(window / 2);
  const out: Series = new Array(s.length).fill(NAN);
  for (let i = 0; i < s.length; i++) {
    const lo = i - half;
    const hi = i + half;
    if (lo < 0 || hi >= s.length) continue;
    let best = NAN;
    for (let j = lo; j <= hi; j++) {
      const v = s[j];
      if (!isNA(v) && (isNA(best) || v > best)) best = v;
    }
    out[i] = best;
  }
  return out;
}

/** `Series.rolling(w, center=True).min()` */
export function rollingMinCentered(s: Series, window: number): Series {
  const half = Math.floor(window / 2);
  const out: Series = new Array(s.length).fill(NAN);
  for (let i = 0; i < s.length; i++) {
    const lo = i - half;
    const hi = i + half;
    if (lo < 0 || hi >= s.length) continue;
    let best = NAN;
    for (let j = lo; j <= hi; j++) {
      const v = s[j];
      if (!isNA(v) && (isNA(best) || v < best)) best = v;
    }
    out[i] = best;
  }
  return out;
}

/**
 * `Series.ewm(span|alpha, adjust=False, min_periods=m).mean()`
 *
 * `adjust=False` means a plain recursive average seeded at the first valid
 * observation (not a running mean of all history), which is what every
 * indicator in the reference library uses. Values before `minPeriods`
 * observations have been seen are NaN, matching pandas.
 */
export function ewm(
  s: Series,
  opts: { span?: number; alpha?: number; minPeriods?: number } = {}
): Series {
  const alpha = opts.alpha ?? (opts.span !== undefined ? 2 / (opts.span + 1) : 1);
  const minPeriods = opts.minPeriods ?? 0;
  const out: Series = new Array(s.length).fill(NAN);
  let acc = NAN;
  let seen = 0;
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (!isNA(v)) {
      acc = isNA(acc) ? v : alpha * v + (1 - alpha) * acc;
      seen += 1;
    }
    if (seen >= minPeriods && seen > 0) out[i] = acc;
  }
  return out;
}

export function andMask(...masks: boolean[][]): boolean[] {
  const n = masks[0]?.length ?? 0;
  const out: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = masks.every((m) => m[i] === true);
  return out;
}

export function orMask(...masks: boolean[][]): boolean[] {
  const n = masks[0]?.length ?? 0;
  const out: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = masks.some((m) => m[i] === true);
  return out;
}

export function notMask(m: boolean[]): boolean[] {
  return m.map((v) => v !== true);
}

/** Series where a mask is true, NaN elsewhere - the `df[col].where(mask)` idiom. */
export function whereMask(s: Series, mask: boolean[]): Series {
  return s.map((v, i) => (mask[i] ? v : NAN));
}

/** Last non-NaN value in a series, or NaN. */
export function lastValid(s: Series): number {
  for (let i = s.length - 1; i >= 0; i--) if (!isNA(s[i])) return s[i];
  return NAN;
}

/**
 * A frame of aligned named series - the TS stand-in for a pandas DataFrame
 * produced by an indicator (e.g. MACD returning macd/signal/hist).
 */
export interface Frame {
  [column: string]: Series;
}

/**
 * `pd.concat([...], axis=1).max(axis=1)` - row-wise max that SKIPS NaN, which
 * is how `true_range` folds its three candidate columns together.
 */
export function rowMaxSkipna(...cols: Series[]): Series {
  const n = cols[0]?.length ?? 0;
  const out: Series = new Array(n);
  for (let i = 0; i < n; i++) {
    let best = NAN;
    for (const c of cols) {
      const v = c[i];
      if (isNA(v)) continue;
      if (isNA(best) || v > best) best = v;
    }
    out[i] = best;
  }
  return out;
}

/**
 * `pd.concat([...], axis=1).sum(axis=1)` - row-wise sum that SKIPS NaN and
 * returns 0 (not NaN) for an all-NaN row, exactly as pandas does. Used to
 * normalise cross-sectional weights in #77.
 */
export function rowSumSkipna(...cols: Series[]): Series {
  const n = cols[0]?.length ?? 0;
  const out: Series = new Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (const c of cols) {
      const v = c[i];
      if (!isNA(v)) acc += v;
    }
    out[i] = acc;
  }
  return out;
}

/**
 * `Series.sum()` - the grand total across the whole series, skipping NaN and
 * returning 0 for an empty or all-NaN input. This is a DIFFERENT reduction from
 * `rowSumSkipna`, which sums across columns at each position; mixing the two up
 * silently normalises a volume curve by its first bucket instead of its total.
 */
export function sumSkipna(s: Series): number {
  let acc = 0;
  for (const v of s) if (!isNA(v)) acc += v;
  return acc;
}

/**
 * `numpy.percentile(values, q)` with the default `method="linear"`.
 *
 * NaN propagates (numpy sorts NaN last and returns NaN for a window that
 * contains one), which is what the cross-sectional and rolling percentile
 * strategies in #76 and #100 rely on.
 */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) return NAN;
  const sorted = values.slice().sort((a, b) => a - b);
  for (const v of sorted) if (isNA(v)) return NAN;
  const pos = ((sorted.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}
