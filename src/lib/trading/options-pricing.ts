/**
 * Black-Scholes pricing + Greeks.
 *
 * Port of `trading_app/options_pricing.py`. Needed for the two time-dependent
 * spreads - #63 calendar and #64 diagonal - whose value depends on TIME
 * REMAINING rather than terminal spot alone, and for #75 volatility arbitrage,
 * which inverts the model to recover an implied vol from a market premium.
 *
 * The reference calls `scipy.stats.norm`, which is not available in the app, so
 * the standard normal CDF/PDF are implemented here directly. `normCdf` uses
 * Hart's rational approximation, which agrees with scipy to ~1e-15 - far tighter
 * than the 1e-6 the parity fixtures are stored at.
 *
 * Unit conventions, all inherited from the reference:
 *   - `rate` and `dividend` are continuous annual rates (decimals, not percent).
 *   - `vol` is an annualised standard deviation (0.20 = 20%).
 *   - `theta` is returned PER CALENDAR DAY and `vega` PER 1 PERCENTAGE POINT of
 *     volatility, because `impliedVolatility` relies on that scaling to build its
 *     Newton step. (So an ATM 1y 20% call reports vega 0.3752 - $0.38 for a 1%
 *     move in vol, not $37.52 for a move of 1.0 in vol.)
 */

export type OptionType = "call" | "put";

/**
 * Standard normal CDF, `scipy.stats.norm.cdf`.
 *
 * Hart's rational approximation: a low-order rational for the central region
 * and a continued fraction for the tails, joined at |x| = 7.0710678.
 */
export function normCdf(x: number): number {
  const a = Math.abs(x);
  let c: number;
  if (a > 37) {
    c = 0;
  } else {
    const e = Math.exp((-a * a) / 2);
    if (a < 7.07106781186547) {
      let b = 3.52624965998911e-2 * a + 0.700383064443688;
      b = b * a + 6.37396220353165;
      b = b * a + 33.912866078383;
      b = b * a + 112.079291497871;
      b = b * a + 221.213596169931;
      b = b * a + 220.206867912376;
      let d = 8.83883476483184e-2 * a + 1.75566716318264;
      d = d * a + 16.064177579207;
      d = d * a + 86.7807322029461;
      d = d * a + 296.564248779674;
      d = d * a + 637.333633378831;
      d = d * a + 793.826512519948;
      d = d * a + 440.413735824752;
      c = (e * b) / d;
    } else {
      let b = a + 0.65;
      b = a + 4 / b;
      b = a + 3 / b;
      b = a + 2 / b;
      b = a + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

/** Standard normal PDF, `scipy.stats.norm.pdf`. */
export function normPdf(x: number): number {
  return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
}

/** Black-Scholes premium for a European option. Zero time left -> intrinsic. */
export function bsPrice(
  spot: number,
  strike: number,
  tYears: number,
  rate: number,
  vol: number,
  optType: OptionType = "call",
  dividend = 0.0
): number {
  if (tYears <= 0) {
    return optType === "call" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  }
  const sqrtT = Math.sqrt(tYears);
  const d1 = (Math.log(spot / strike) + (rate - dividend + 0.5 * vol * vol) * tYears) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  if (optType === "call") {
    return (
      spot * Math.exp(-dividend * tYears) * normCdf(d1) - strike * Math.exp(-rate * tYears) * normCdf(d2)
    );
  }
  return (
    strike * Math.exp(-rate * tYears) * normCdf(-d2) - spot * Math.exp(-dividend * tYears) * normCdf(-d1)
  );
}

export interface Greeks {
  delta: number;
  gamma: number;
  /** Per calendar day (already divided by 365), i.e. negative = time decay. */
  theta: number;
  /** Per 1 PERCENTAGE POINT of volatility (already divided by 100). */
  vega: number;
}

/**
 * Black-Scholes Greeks. At zero time left everything degenerates to zero, which
 * is the reference's behaviour (an expired option has no delta to hedge with).
 */
export function bsGreeks(
  spot: number,
  strike: number,
  tYears: number,
  rate: number,
  vol: number,
  optType: OptionType = "call",
  dividend = 0.0
): Greeks {
  if (tYears <= 0) return { delta: 0, gamma: 0, theta: 0, vega: 0 };
  const sqrtT = Math.sqrt(tYears);
  const d1 = (Math.log(spot / strike) + (rate - dividend + 0.5 * vol * vol) * tYears) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const pdfD1 = normPdf(d1);
  const discQ = Math.exp(-dividend * tYears);
  const discR = Math.exp(-rate * tYears);
  // Shared term of theta: the gamma-decay contribution -0.5 * sigma * S * e^-qT * pdf(d1) / sqrt(T)
  const decay = (-spot * pdfD1 * vol * discQ) / (2 * sqrtT);
  const delta = optType === "call" ? discQ * normCdf(d1) : -discQ * normCdf(-d1);
  const theta =
    optType === "call"
      ? decay - rate * strike * discR * normCdf(d2) + dividend * spot * discQ * normCdf(d1)
      : decay + rate * strike * discR * normCdf(-d2) - dividend * spot * discQ * normCdf(-d1);
  const gamma = (discQ * pdfD1) / (spot * vol * sqrtT);
  const vega = spot * discQ * pdfD1 * sqrtT;
  return { delta, gamma, theta: theta / 365.0, vega: vega / 100.0 };
}

/**
 * Newton-Raphson solve for the implied vol behind an observed premium, clamped
 * to [0.001, 5.0] each step so a bad quote cannot throw the solver off.
 *
 * Returns the last `vol` it tried rather than throwing when it does not
 * converge, matching the reference.
 */
export function impliedVolatility(
  marketPrice: number,
  spot: number,
  strike: number,
  tYears: number,
  rate: number,
  optType: OptionType = "call",
  dividend = 0.0,
  tol = 1e-6,
  maxIter = 100
): number {
  let vol = 0.3;
  for (let i = 0; i < maxIter; i++) {
    const price = bsPrice(spot, strike, tYears, rate, vol, optType, dividend);
    const vega = bsGreeks(spot, strike, tYears, rate, vol, optType, dividend).vega * 100;
    if (vega < 1e-8) break;
    const diff = marketPrice - price;
    if (Math.abs(diff) < tol) return vol;
    vol += diff / vega;
    vol = Math.max(0.001, Math.min(vol, 5.0));
  }
  return vol;
}

/**
 * Value of a calendar spread AT THE SHORT LEG'S EXPIRATION: the short option
 * has expired and is worth its intrinsic value, while the long leg still has
 * `tLong - tShort` years to run and is priced with Black-Scholes.
 *
 * This is the core valuation for #63 and the same shape #64 uses, which also
 * moves the long leg to a different strike.
 */
export function calendarSpreadValue(
  spot: number,
  strike: number,
  tShortYears: number,
  tLongYears: number,
  rate: number,
  vol: number,
  optType: OptionType = "call"
): number {
  const shortValueAtExpiry =
    optType === "call" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  const remainingT = tLongYears - tShortYears;
  const longValue = bsPrice(spot, strike, remainingT, rate, vol, optType);
  return longValue - shortValueAtExpiry;
}
