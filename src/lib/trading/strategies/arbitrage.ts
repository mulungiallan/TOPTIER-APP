/**
 * Strategies #67-75 - Arbitrage & Relative Value.
 *
 * Faithful port of `strategies/arbitrage.py`.
 *
 * Every strategy in this band needs an external data feed the library does not
 * produce itself - deal terms, two exchange order books, option surfaces. Each
 * function here therefore documents the shape of the series it wants, and the
 * decision logic is fully implemented: the app supplies the prices and gets
 * back the mispricing and a signal. None of it is a price-history-only
 * strategy, so parity is pinned on synthetic inputs recorded in
 * `python-reference.json` rather than on the OHLCV fixture - see
 * `../derived-strategies.test.ts`.
 *
 * Signal convention is the usual 1 / 0 / -1, but note these are POINT signals:
 * a relative-value position that has been entered stays entered until the
 * mispricing flips sign, which is the caller's job (the reference is the same).
 */

import {
  Series,
  abs,
  add,
  cumsum,
  divInf,
  isNA,
  mul,
  shift,
  sub,
} from "../series";

/** `Series.pct_change()`: x / x.shift(1) - 1, numpy-style inf on a zero base. */
function pctChange(s: Series): Series {
  const prev = shift(s, 1);
  return s.map((v, i) => (isNA(v) || isNA(prev[i]) ? NaN : prev[i] === 0 ? Infinity : v / prev[i] - 1));
}

// ─── #67 ──────────────────────────────────────────────────────────────────────
/**
 * Merger arbitrage. `dealPrice` is the announced consideration (or the value of
 * a stock-for-stock offer); `completionProb` is an optional per-bar deal
 * probability, defaulting to the reference's naive 0.9.
 *
 * The signal is the RISK-ADJUSTED spread being positive, i.e. long the target
 * whenever the probability-weighted gain beats the probability-weighted loss.
 * That reduces to `spread * (2p - 1) > 0`, so with the default p = 0.9 any
 * positive spread is actionable.
 */
export function s67MergerArbitrage(
  targetPrice: Series,
  dealPrice: number,
  completionProb?: Series
): { spreadPct: Series; signal: Series } {
  const spreadPct = mul(divInf(sub(dealPrice, targetPrice), targetPrice), 100);
  const prob = completionProb ?? new Array(targetPrice.length).fill(0.9);
  // spread * p - spread * (1 - p), kept in that factored form for parity.
  const expectedValuePct = sub(mul(spreadPct, prob), mul(spreadPct, sub(1, prob)));
  return { spreadPct, signal: expectedValuePct.map((v) => (v > 0 ? 1 : 0)) };
}

// ─── #68 ──────────────────────────────────────────────────────────────────────
/**
 * Convertible-bond arbitrage. `delta` is the convertible's equity delta from an
 * external convertible pricing model - plain Black-Scholes is not enough for
 * convertibles, so it is an input here.
 *
 * Returns the number of shares to short per bond held to delta-hedge it.
 */
export function s68ConvertibleBondArbitrage(
  bondPrice: Series,
  stockPrice: Series,
  conversionRatio: number,
  delta: Series
): Series {
  void bondPrice;
  void stockPrice;
  return mul(delta, conversionRatio);
}

// ─── #69 ──────────────────────────────────────────────────────────────────────
/**
 * Index vs futures. Fair value is the index compounded forward at the
 * cost-of-carry rate net of dividends, so `mispricing > 0` means futures are
 * rich: sell the future against the basket.
 */
export function s69IndexArbitrage(
  indexLevel: Series,
  futuresPrice: Series,
  rate: number,
  dividendYield: number,
  tYears: Series
): { mispricing: Series; signal: Series } {
  const carry = tYears.map((t) => (isNA(t) ? NaN : Math.exp((rate - dividendYield) * t)));
  const fairValue = mul(indexLevel, carry);
  const mispricing = sub(futuresPrice, fairValue);
  return { mispricing, signal: ternary(mispricing, -1, 1) };
}

/**
 * -1 where the first argument is positive, +1 where it is negative, 0 where it
 * is zero - and 0 for NaN too, because a pandas comparison against NaN is False
 * and the reference's signal starts at 0 and is only ever assigned on a true
 * comparison.
 */
function ternary(s: Series, positive: number, negative: number): Series {
  return s.map((v) => (v > 0 ? positive : v < 0 ? negative : 0));
}

// ─── #70 ──────────────────────────────────────────────────────────────────────
/**
 * Triangular FX arbitrage: `rateAB * rateBC` must equal `rateAC`. Flags the bars
 * where the discrepancy clears the assumed round-trip cost.
 *
 * The comparison scales the percentage discrepancy by 100 again, so the
 * threshold `costBps` is in basis points of the raw ratio while the returned
 * series is in percent. That is the reference's unit choice and it is preserved.
 */
export function s70TriangularArbitrage(
  rateAB: Series,
  rateBC: Series,
  rateAC: Series,
  costBps = 2.0
): { discrepancyPct: Series; tradable: boolean[] } {
  const impliedAC = mul(rateAB, rateBC);
  const discrepancyPct = mul(divInf(sub(impliedAC, rateAC), rateAC), 100);
  return { discrepancyPct, tradable: mul(abs(discrepancyPct), 100).map((v) => v > costBps) };
}

// ─── #71 ──────────────────────────────────────────────────────────────────────
/**
 * Cross-exchange arbitrage. `+1` = buy the cheap venue and sell the rich one,
 * and only where the spread beats fees plus the transfer cost.
 */
export function s71CrossExchangeArbitrage(
  priceVenueA: Series,
  priceVenueB: Series,
  feePct = 0.2,
  transferCostPct = 0.1
): { spreadPct: Series; signal: Series } {
  const spreadPct = mul(divInf(sub(priceVenueB, priceVenueA), priceVenueA), 100);
  const totalCostPct = feePct * 2 + transferCostPct;
  return {
    spreadPct,
    signal: spreadPct.map((v) => (v > totalCostPct ? 1 : v < -totalCostPct ? -1 : 0)),
  };
}

// ─── #72 ──────────────────────────────────────────────────────────────────────
/**
 * Carry trade. `fxPrice` is the high-yield currency against the funding
 * currency, so a long carry position earns the rate differential and loses on
 * an adverse FX move.
 *
 * The stop is measured on the SIMPLY-ADDED cumulative FX return and carry, not
 * compounded, and because the first FX return is NaN the first bar is never a
 * stop-out.
 */
export function s72CarryTrade(
  rateHigh: Series,
  rateLow: Series,
  fxPrice: Series,
  stopLossPct = 5.0
): { dailyCarry: Series; stoppedOut: boolean[] } {
  const dailyCarry = mul(sub(rateHigh, rateLow), 1 / 365.0);
  const fxRetPct = mul(pctChange(fxPrice), 100);
  const cumCarry = cumsum(dailyCarry);
  const cumFx = cumsum(fxRetPct);
  return { dailyCarry, stoppedOut: add(cumFx, cumCarry).map((v) => v < -stopLossPct) };
}

// ─── #73 ──────────────────────────────────────────────────────────────────────
/**
 * Futures calendar-spread arbitrage. The fair spread of two expiries is
 * `spot * (e^{r t_far} - e^{r t_near})`; a wider actual spread means sell far /
 * buy near.
 */
export function s73FuturesCalendarArbitrage(
  nearPrice: Series,
  farPrice: Series,
  rate: number,
  tNear: Series,
  tFar: Series,
  spot: Series
): { mispricing: Series; signal: Series } {
  const fairSpread = mul(
    spot,
    sub(
      tFar.map((t) => (isNA(t) ? NaN : Math.exp(rate * t))),
      tNear.map((t) => (isNA(t) ? NaN : Math.exp(rate * t)))
    )
  );
  const mispricing = sub(sub(farPrice, nearPrice), fairSpread);
  return { mispricing, signal: ternary(mispricing, -1, 1) };
}

// ─── #74 ──────────────────────────────────────────────────────────────────────
/**
 * ETF premium/discount monitor. Retail cannot create or redeem ETF shares
 * (that needs Authorised Participant status), so this is an alert, not an
 * executable strategy.
 */
export function s74EtfArbitrageMonitor(
  etfPrice: Series,
  nav: Series,
  thresholdPct = 0.5
): { premiumDiscountPct: Series; alert: boolean[] } {
  const premiumDiscountPct = mul(divInf(sub(etfPrice, nav), nav), 100);
  return { premiumDiscountPct, alert: abs(premiumDiscountPct).map((v) => v > thresholdPct) };
}

// ─── #75 ──────────────────────────────────────────────────────────────────────
/**
 * Volatility arbitrage against a vol forecast. `marketIv` can be produced by
 * `impliedVolatility` in `../options-pricing`; the forecast is supplied
 * externally (GARCH, EWMA, ...), because forecasting realised vol is a separate
 * subsystem.
 *
 * Selling vol when IV runs ahead of the forecast and buying it when it lags -
 * both legs delta-hedged, which this function does not model.
 */
export function s75VolatilityArbitrage(
  marketIv: Series,
  forecastRealizedVol: Series,
  threshold = 0.02
): { edge: Series; signal: Series } {
  const edge = sub(marketIv, forecastRealizedVol);
  return { edge, signal: edge.map((v) => (v > threshold ? -1 : v < -threshold ? 1 : 0)) };
}
