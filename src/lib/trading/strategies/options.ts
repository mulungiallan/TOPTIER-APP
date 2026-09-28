/**
 * Strategies #49-66 - Options.
 *
 * Faithful port of `strategies/options_strategies.py` plus the multi-leg payoff
 * engine it delegates to (`engines.OptionsStrategy` in `engines.py`).
 *
 * Unlike #1-48, none of these return a 1/0/-1 signal series. They return an
 * `OptionsStrategy` - a bag of legs plus optional long stock - that the caller
 * can price, chart as a payoff diagram, and read max profit / max loss /
 * breakevens off. Only the two time-dependent spreads (#63, #64) are different
 * again: they need a pricing model rather than an at-expiry payoff, so they
 * return Black-Scholes VALUES straight from `../options-pricing`.
 *
 * The payoff is a per-share number times the share counts in the legs: `qty`
 * defaults to 1 contract, and the underlying is expressed in SHARES (the
 * reference default is 100 shares for the stock-based strategies, i.e. one
 * standard contract), so callers mixing the two must scale deliberately.
 */

import { OptionType, bsPrice, calendarSpreadValue } from "../options-pricing";

export type OptionSide = "long" | "short";

/** One option position in a structure. `qty` is in contracts. */
export interface OptionLeg {
  optType: OptionType;
  strike: number;
  premium: number;
  qty: number;
  side: OptionSide;
}

/** Build a leg, defaulting to a single long contract as the reference does. */
export function optionLeg(
  optType: OptionType,
  strike: number,
  premium: number,
  qty = 1,
  side: OptionSide = "long"
): OptionLeg {
  return { optType, strike, premium, qty, side };
}

/** Payoff of a single leg at expiration, including the premium flow. */
export function legPayoffAtExpiry(leg: OptionLeg, spot: number): number {
  const intrinsic =
    leg.optType === "call" ? Math.max(spot - leg.strike, 0) : Math.max(leg.strike - spot, 0);
  const sign = leg.side === "long" ? 1 : -1;
  const premiumFlow = leg.side === "long" ? -leg.premium : leg.premium;
  return sign * intrinsic * leg.qty + premiumFlow * leg.qty;
}

/** `numpy.sign` - and note that `sign(NaN)` is NaN, exactly as numpy has it. */
function sign(x: number): number {
  if (Number.isNaN(x)) return NaN;
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/**
 * A generic multi-leg options structure. Every named strategy in #49-66 is one
 * of these with a different leg list (plus, for the covered/stock ones, a long
 * stock position).
 *
 * `payoff(spotRange)` and everything derived from it are functions of the spot
 * grid the caller passes, so max profit / max loss are only ever as good as that
 * grid - the reference has the same property, and its `breakevens` are linearly
 * interpolated between grid points rather than solved analytically.
 */
export class OptionsStrategy {
  readonly legs: OptionLeg[];
  readonly shares: number;
  readonly shareCost: number | null;

  constructor(legs: OptionLeg[], shares = 0, shareCost: number | null = null) {
    this.legs = legs;
    this.shares = shares;
    this.shareCost = shareCost;
  }

  /** Total P&L at expiration for each spot in the grid. */
  payoff(spotRange: number[]): number[] {
    const total = spotRange.map(() => 0);
    for (const leg of this.legs) {
      for (let i = 0; i < spotRange.length; i++) total[i] += legPayoffAtExpiry(leg, spotRange[i]);
    }
    // The reference guards with `if self.shares and self.share_cost is not None`,
    // so a zero share count means no stock leg at all.
    if (this.shares !== 0 && this.shareCost !== null) {
      for (let i = 0; i < spotRange.length; i++) total[i] += this.shares * (spotRange[i] - this.shareCost);
    }
    return total;
  }

  maxProfit(spotRange: number[]): number {
    return Math.max(...this.payoff(spotRange));
  }

  maxLoss(spotRange: number[]): number {
    return Math.min(...this.payoff(spotRange));
  }

  /**
   * Spots where the payoff crosses zero, linearly interpolated between the two
   * bracketing grid points.
   *
   * A grid point that sits exactly on zero contributes TWO sign changes (- -> 0
   * and 0 -> +), and the `y1 !== y0` guard only drops segments where the payoff
   * is flat at zero, so such a point reports the same breakeven twice. That is
   * the reference's behaviour, reproduced rather than tidied up.
   */
  breakevens(spotRange: number[]): number[] {
    const payoff = this.payoff(spotRange);
    const out: number[] = [];
    for (let i = 0; i + 1 < spotRange.length; i++) {
      if (sign(payoff[i + 1]) - sign(payoff[i]) === 0) continue;
      const x0 = spotRange[i];
      const x1 = spotRange[i + 1];
      const y0 = payoff[i];
      const y1 = payoff[i + 1];
      if (y1 === y0) continue;
      out.push(x0 - (y0 * (x1 - x0)) / (y1 - y0));
    }
    return out;
  }
}

// ─── #49-51: stock + option ───────────────────────────────────────────────────
/** Long stock, short a call: the premium is income, upside is capped. */
export function s49CoveredCall(
  stockCost: number,
  callStrike: number,
  callPremium: number,
  shares = 100
): OptionsStrategy {
  return new OptionsStrategy(
    [optionLeg("call", callStrike, callPremium, 1, "short")],
    shares,
    stockCost
  );
}

/** Long stock, long a put: a floor under the stock at the cost of the premium. */
export function s50ProtectivePut(
  stockCost: number,
  putStrike: number,
  putPremium: number,
  shares = 100
): OptionsStrategy {
  return new OptionsStrategy([optionLeg("put", putStrike, putPremium, 1, "long")], shares, stockCost);
}

/** Protective put financed by selling a call: a zero-cost collar. */
export function s51Collar(
  stockCost: number,
  putStrike: number,
  putPremium: number,
  callStrike: number,
  callPremium: number,
  shares = 100
): OptionsStrategy {
  return new OptionsStrategy(
    [
      optionLeg("put", putStrike, putPremium, 1, "long"),
      optionLeg("call", callStrike, callPremium, 1, "short"),
    ],
    shares,
    stockCost
  );
}

// ─── #52-53: single legs ──────────────────────────────────────────────────────
export function s52LongCall(strike: number, premium: number): OptionsStrategy {
  return new OptionsStrategy([optionLeg("call", strike, premium, 1, "long")]);
}

export function s53LongPut(strike: number, premium: number): OptionsStrategy {
  return new OptionsStrategy([optionLeg("put", strike, premium, 1, "long")]);
}

// ─── #54-57: vertical spreads ─────────────────────────────────────────────────
export function s54BullCallSpread(
  lowStrike: number,
  lowPrem: number,
  highStrike: number,
  highPrem: number
): OptionsStrategy {
  return new OptionsStrategy([
    optionLeg("call", lowStrike, lowPrem, 1, "long"),
    optionLeg("call", highStrike, highPrem, 1, "short"),
  ]);
}

export function s55BearPutSpread(
  highStrike: number,
  highPrem: number,
  lowStrike: number,
  lowPrem: number
): OptionsStrategy {
  return new OptionsStrategy([
    optionLeg("put", highStrike, highPrem, 1, "long"),
    optionLeg("put", lowStrike, lowPrem, 1, "short"),
  ]);
}

export function s56BearCallSpread(
  lowStrike: number,
  lowPrem: number,
  highStrike: number,
  highPrem: number
): OptionsStrategy {
  return new OptionsStrategy([
    optionLeg("call", lowStrike, lowPrem, 1, "short"),
    optionLeg("call", highStrike, highPrem, 1, "long"),
  ]);
}

export function s57BullPutSpread(
  highStrike: number,
  highPrem: number,
  lowStrike: number,
  lowPrem: number
): OptionsStrategy {
  return new OptionsStrategy([
    optionLeg("put", highStrike, highPrem, 1, "short"),
    optionLeg("put", lowStrike, lowPrem, 1, "long"),
  ]);
}

// ─── #58-59: wings ────────────────────────────────────────────────────────────
export function s58IronCondor(
  putLongStrike: number,
  putLongPrem: number,
  putShortStrike: number,
  putShortPrem: number,
  callShortStrike: number,
  callShortPrem: number,
  callLongStrike: number,
  callLongPrem: number
): OptionsStrategy {
  return new OptionsStrategy([
    optionLeg("put", putLongStrike, putLongPrem, 1, "long"),
    optionLeg("put", putShortStrike, putShortPrem, 1, "short"),
    optionLeg("call", callShortStrike, callShortPrem, 1, "short"),
    optionLeg("call", callLongStrike, callLongPrem, 1, "long"),
  ]);
}

export function s59IronButterfly(
  centerStrike: number,
  putPrem: number,
  callPrem: number,
  wingPutStrike: number,
  wingPutPrem: number,
  wingCallStrike: number,
  wingCallPrem: number
): OptionsStrategy {
  return new OptionsStrategy([
    optionLeg("put", centerStrike, putPrem, 1, "short"),
    optionLeg("call", centerStrike, callPrem, 1, "short"),
    optionLeg("put", wingPutStrike, wingPutPrem, 1, "long"),
    optionLeg("call", wingCallStrike, wingCallPrem, 1, "long"),
  ]);
}

// ─── #60-62: volatility structures ────────────────────────────────────────────
export function s60LongStraddle(
  strike: number,
  callPrem: number,
  putPrem: number
): OptionsStrategy {
  return new OptionsStrategy([
    optionLeg("call", strike, callPrem, 1, "long"),
    optionLeg("put", strike, putPrem, 1, "long"),
  ]);
}

export function s61LongStrangle(
  callStrike: number,
  callPrem: number,
  putStrike: number,
  putPrem: number
): OptionsStrategy {
  return new OptionsStrategy([
    optionLeg("call", callStrike, callPrem, 1, "long"),
    optionLeg("put", putStrike, putPrem, 1, "long"),
  ]);
}

export function s62ShortStraddle(
  strike: number,
  callPrem: number,
  putPrem: number
): OptionsStrategy {
  return new OptionsStrategy([
    optionLeg("call", strike, callPrem, 1, "short"),
    optionLeg("put", strike, putPrem, 1, "short"),
  ]);
}

export function s62ShortStrangle(
  callStrike: number,
  callPrem: number,
  putStrike: number,
  putPrem: number
): OptionsStrategy {
  return new OptionsStrategy([
    optionLeg("call", callStrike, callPrem, 1, "short"),
    optionLeg("put", putStrike, putPrem, 1, "short"),
  ]);
}

/**
 * The reference's overloaded #62: with three prices it is a straddle (call and
 * put on the SAME strike), with four it is a strangle (different strikes).
 * Prefer the two explicit builders above where the intent is known - the legs
 * make the difference visible, whereas here both produce an `OptionsStrategy`.
 */
export function s62ShortStraddleStrangle(
  strikeOrCallStrike: number,
  callPrem: number,
  putStrikeOrPutPrem: number,
  putPrem?: number
): OptionsStrategy {
  return putPrem === undefined
    ? s62ShortStraddle(strikeOrCallStrike, callPrem, putStrikeOrPutPrem)
    : s62ShortStrangle(strikeOrCallStrike, callPrem, putStrikeOrPutPrem, putPrem);
}

// ─── #63-64: time-dependent spreads ───────────────────────────────────────────
/**
 * Theoretical value of a calendar spread at the SHORT leg's expiration: the
 * short leg has expired to intrinsic, the long leg still has time left.
 */
export function s63CalendarSpread(
  spot: number,
  strike: number,
  tShortYears: number,
  tLongYears: number,
  rate: number,
  vol: number,
  optType: OptionType = "call"
): number {
  return calendarSpreadValue(spot, strike, tShortYears, tLongYears, rate, vol, optType);
}

/** A calendar spread with the long leg struck differently (a "diagonal"). */
export function s64DiagonalSpread(
  spot: number,
  shortStrike: number,
  longStrike: number,
  tShortYears: number,
  tLongYears: number,
  rate: number,
  vol: number,
  optType: OptionType = "call"
): number {
  const shortIntrinsic =
    optType === "call" ? Math.max(spot - shortStrike, 0) : Math.max(shortStrike - spot, 0);
  const remainingT = tLongYears - tShortYears;
  const longValue = bsPrice(spot, longStrike, remainingT, rate, vol, optType);
  return longValue - shortIntrinsic;
}

// ─── #65-66 ───────────────────────────────────────────────────────────────────
/** Short put, collateralised with cash: the strike is the effective buy price. */
export function s65CashSecuredPut(strike: number, premium: number): OptionsStrategy {
  return new OptionsStrategy([optionLeg("put", strike, premium, 1, "short")]);
}

/** One long call against `shortQty` short calls: more premium, more upside. */
export function s66RatioSpread(
  longStrike: number,
  longPrem: number,
  shortStrike: number,
  shortPrem: number,
  shortQty = 2
): OptionsStrategy {
  return new OptionsStrategy([
    optionLeg("call", longStrike, longPrem, 1, "long"),
    optionLeg("call", shortStrike, shortPrem, shortQty, "short"),
  ]);
}
