/**
 * Tests for the options strategies (#49-66) and the Black-Scholes model behind
 * the two time-dependent spreads.
 *
 * This is the one band with no `python-reference.json` parity fixture:
 * `options_pricing.py` imports `scipy.stats.norm`, and scipy is not installed in
 * this environment, so the reference cannot be executed to record a golden
 * output. Every expectation below is therefore derived ANALYTICALLY - textbook
 * option values, put-call parity, the Greeks' parity relations, and payoff
 * diagrams whose max profit, max loss and breakevens can be worked out by hand
 * from the leg definitions in `engines.OptionsStrategy`.
 *
 * The payoff numbers are exact rather than approximate on purpose. Each leg is
 * `side_sign * intrinsic * qty + premium_flow * qty`, so a structure's payoff is a
 * piecewise-linear function that can be evaluated by hand; a mismatch means
 * either the port or the hand calculation is wrong, and either way one has to be.
 */

import { describe, expect, it } from "vitest";
import { bsGreeks, bsPrice, calendarSpreadValue, impliedVolatility, normCdf, normPdf } from "../options-pricing";
import {
  OptionsStrategy,
  legPayoffAtExpiry,
  optionLeg,
  s49CoveredCall,
  s50ProtectivePut,
  s51Collar,
  s52LongCall,
  s53LongPut,
  s54BullCallSpread,
  s55BearPutSpread,
  s56BearCallSpread,
  s57BullPutSpread,
  s58IronCondor,
  s59IronButterfly,
  s60LongStraddle,
  s61LongStrangle,
  s62ShortStraddle,
  s62ShortStraddleStrangle,
  s62ShortStrangle,
  s63CalendarSpread,
  s64DiagonalSpread,
  s65CashSecuredPut,
  s66RatioSpread,
} from "./options";

/** A $1 spot grid, so the interpolated breakevens are checkable exactly. */
const GRID: number[] = [];
for (let s = 0; s <= 200; s++) GRID.push(s);

describe("standard normal", () => {
  it("cdf matches the published values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 12);
    expect(normCdf(1)).toBeCloseTo(0.8413447461, 9);
    expect(normCdf(-1)).toBeCloseTo(0.1586552539, 9);
    expect(normCdf(1.959963985)).toBeCloseTo(0.975, 7);
    expect(normCdf(-1.959963985)).toBeCloseTo(0.025, 7);
    expect(normCdf(3)).toBeCloseTo(0.9986501020, 9);
  });

  it("saturates instead of overflowing in the tails", () => {
    expect(normCdf(8)).toBeCloseTo(1, 12);
    expect(normCdf(-8)).toBeCloseTo(0, 12);
    expect(normCdf(-40)).toBe(0);
  });

  it("pdf matches the published value at the origin", () => {
    expect(normPdf(0)).toBeCloseTo(0.3989422804, 9);
    expect(normPdf(1)).toBeCloseTo(0.2419707245, 9);
  });
});

describe("black-scholes pricing", () => {
  const S = 100;
  const K = 100;
  const r = 0.05;
  const vol = 0.2;

  it("reproduces the textbook ATM value", () => {
    // S=K=100, r=5%, sigma=20%, T=1 -> call 10.4506, put 5.5735.
    expect(bsPrice(S, K, 1, r, vol, "call")).toBeCloseTo(10.4506, 3);
    expect(bsPrice(S, K, 1, r, vol, "put")).toBeCloseTo(5.5735, 3);
  });

  it("satisfies put-call parity, C - P = S - K e^(-rT)", () => {
    for (const k of [80, 100, 120]) {
      for (const t of [0.25, 1, 2]) {
        const call = bsPrice(S, k, t, r, vol, "call");
        const put = bsPrice(S, k, t, r, vol, "put");
        expect(call - put).toBeCloseTo(S - k * Math.exp(-r * t), 10);
      }
    }
  });

  it("parity holds with a dividend yield at e^(-qT)", () => {
    const q = 0.03;
    const call = bsPrice(S, K, 1.5, r, vol, "call", q);
    const put = bsPrice(S, K, 1.5, r, vol, "put", q);
    expect(call - put).toBeCloseTo(S * Math.exp(-q * 1.5) - K * Math.exp(-r * 1.5), 10);
  });

  it("collapses to intrinsic value at zero time", () => {
    expect(bsPrice(120, 100, 0, r, vol, "call")).toBe(20);
    expect(bsPrice(80, 100, 0, r, vol, "call")).toBe(0);
    expect(bsPrice(80, 100, 0, r, vol, "put")).toBe(20);
    expect(bsPrice(120, 100, 0, r, vol, "put")).toBe(0);
  });

  it("is monotonically increasing in spot and decreasing in strike", () => {
    let prev = -Infinity;
    for (const s of [60, 80, 100, 120, 140]) {
      const price = bsPrice(s, K, 1, r, vol, "call");
      expect(price).toBeGreaterThan(prev);
      prev = price;
    }
    prev = Infinity;
    for (const k of [60, 80, 100, 120, 140]) {
      const price = bsPrice(S, k, 1, r, vol, "call");
      expect(price).toBeLessThan(prev);
      prev = price;
    }
  });
});

describe("black-scholes greeks", () => {
  const S = 100;
  const K = 100;
  const r = 0.05;
  const vol = 0.2;

  it("call and put share gamma and vega", () => {
    const c = bsGreeks(S, K, 1, r, vol, "call");
    const p = bsGreeks(S, K, 1, r, vol, "put");
    expect(c.gamma).toBeCloseTo(p.gamma, 12);
    expect(c.vega).toBeCloseTo(p.vega, 12);
    expect(c.gamma).toBeCloseTo(0.018762, 5);
    // Vega is per 1 PERCENTAGE POINT of vol, so $0.38 for a 1% move, not $37.52
    // for a move of 1.0 in the vol input.
    expect(c.vega).toBeCloseTo(0.375240, 5);
  });

  it("call and put deltas differ by exactly one", () => {
    const c = bsGreeks(S, K, 1, r, vol, "call");
    const p = bsGreeks(S, K, 1, r, vol, "put");
    expect(c.delta - p.delta).toBeCloseTo(1, 12);
    expect(c.delta).toBeCloseTo(0.636831, 5);
    expect(p.delta).toBeCloseTo(-0.363169, 5);
  });

  it("theta parity: theta_call - theta_put = -rK e^(-rT) per day", () => {
    const c = bsGreeks(S, K, 1, r, vol, "call");
    const p = bsGreeks(S, K, 1, r, vol, "put");
    expect(c.theta - p.theta).toBeCloseTo((-r * K * Math.exp(-r)) / 365, 10);
  });

  it("an ATM option has a negative theta (time decay)", () => {
    expect(bsGreeks(S, K, 1, r, vol, "call").theta).toBeLessThan(0);
    expect(bsGreeks(S, K, 1, r, vol, "put").theta).toBeLessThan(0);
  });

  it("degenerates to zero at expiry", () => {
    expect(bsGreeks(S, K, 0, r, vol, "call")).toEqual({
      delta: 0, gamma: 0, theta: 0, vega: 0,
    });
  });
});

describe("implied volatility", () => {
  it("inverts the model to the vol it was priced from", () => {
    for (const vol of [0.1, 0.25, 0.6]) {
      for (const optType of ["call", "put"] as const) {
        const price = bsPrice(100, 105, 0.75, 0.04, vol, optType);
        expect(impliedVolatility(price, 100, 105, 0.75, 0.04, optType)).toBeCloseTo(vol, 4);
      }
    }
  });

  it("stays inside the reference's clamp on nonsense quotes", () => {
    expect(impliedVolatility(1e6, 100, 100, 1, 0.05, "call")).toBeLessThanOrEqual(5.0);
    expect(impliedVolatility(-50, 100, 100, 1, 0.05, "call")).toBeGreaterThanOrEqual(0.001);
  });
});

describe("option leg payoff", () => {
  it("long call: intrinsic above the strike, premium at risk below it", () => {
    const leg = optionLeg("call", 100, 3);
    expect(legPayoffAtExpiry(leg, 120)).toBe(17);
    expect(legPayoffAtExpiry(leg, 100)).toBe(-3);
    expect(legPayoffAtExpiry(leg, 80)).toBe(-3);
  });

  it("short call is the mirror image", () => {
    const leg = optionLeg("call", 100, 3, 1, "short");
    expect(legPayoffAtExpiry(leg, 120)).toBe(-17);
    expect(legPayoffAtExpiry(leg, 80)).toBe(3);
  });

  it("scales with contract quantity", () => {
    const leg = optionLeg("put", 90, 2, 3);
    expect(legPayoffAtExpiry(leg, 80)).toBe(3 * (10 - 2));
  });
});

describe("options strategy engine", () => {
  it("sums the legs and the stock position", () => {
    // 100 shares bought at 100, plus one long 100 call for 3.
    // At 120: 100 * 20 + (20 - 3) = 2017.
    const s = new OptionsStrategy([optionLeg("call", 100, 3)], 100, 100);
    expect(s.payoff([90, 100, 120])).toEqual([-1003, -3, 2017]);
  });

  it("treats a zero share count as no stock leg", () => {
    const s = new OptionsStrategy([optionLeg("call", 100, 3)], 0, 100);
    expect(s.payoff([120])).toEqual([17]);
  });

  it("interpolates a breakeven between grid points", () => {
    const s = s52LongCall(100, 3);
    expect(s.payoff([102.5, 103.5])).toEqual([-0.5, 0.5]);
    expect(s.breakevens([102.5, 103.5])).toEqual([103]);
  });

  it("reports an on-grid breakeven twice, as the reference does", () => {
    // The bull call spread's payoff is exactly 0 at 91, so `np.diff(np.sign())`
    // sees two sign changes (- -> 0 and 0 -> +) and the reference's `y1 != y0`
    // guard drops neither, because neither segment is flat at zero. Reproduced
    // rather than tidied up: callers that de-duplicate get the reference's list.
    const s = s54BullCallSpread(90, 2, 100, 1);
    expect(s.payoff([91])[0]).toBe(0);
    expect(s.breakevens([90, 91, 92])).toEqual([91, 91]);
  });
});

describe("#49-51: stock plus option", () => {
  it("s49 covered call - premium is income, upside is capped at the strike", () => {
    const s = s49CoveredCall(100, 110, 2, 100);
    // Below the strike it is long stock plus the premium received.
    expect(s.payoff([100])).toEqual([2]);
    expect(s.payoff([110])).toEqual([1002]);
    // Above the strike the short call caps the upside: 99 per share, not 100.
    expect(s.payoff([120])).toEqual([1992]);
    expect(s.maxLoss(GRID)).toBe(-9998);
    expect(s.maxProfit(GRID)).toBe(9912);
    expect(s.breakevens(GRID)).toEqual([99.98]);
  });

  it("s50 protective put - the put is a floor, paid for with the premium", () => {
    const s = s50ProtectivePut(100, 95, 2, 100);
    expect(s.payoff([100])).toEqual([-2]);
    expect(s.payoff([120])).toEqual([1998]);
    // Below the put strike the loss still grows at 99 per share, because the put
    // only pays down 1 of the 100-share stock move.
    expect(s.payoff([0])).toEqual([-9907]);
    expect(s.maxLoss(GRID)).toBe(-9907);
    expect(s.breakevens(GRID)).toEqual([100.02]);
  });

  it("s51 collar - a cheap floor and ceiling", () => {
    const s = s51Collar(100, 95, 2, 105, 1.5, 100);
    expect(s.payoff([100])).toEqual([-0.5]);
    expect(s.payoff([95])).toEqual([-500.5]);
    expect(s.payoff([105])).toEqual([499.5]);
    expect(s.maxLoss(GRID)).toBe(-9905.5);
    expect(s.breakevens(GRID)).toEqual([100.005]);
  });

  it("respects a non-default share count", () => {
    const s = s49CoveredCall(100, 110, 2, 10);
    expect(s.payoff([110])).toEqual([102]);
  });
});

describe("#52-53: single legs", () => {
  it("s52 long call", () => {
    const s = s52LongCall(100, 3);
    expect(s.payoff([80])).toEqual([-3]);
    expect(s.payoff([120])).toEqual([17]);
    expect(s.maxLoss(GRID)).toBe(-3);
    expect(s.breakevens(GRID)).toEqual([103, 103]);
  });

  it("s53 long put", () => {
    const s = s53LongPut(100, 3);
    expect(s.payoff([80])).toEqual([17]);
    expect(s.maxLoss(GRID)).toBe(-3);
    expect(s.breakevens(GRID)).toEqual([97, 97]);
  });
});

describe("#54-57: vertical spreads", () => {
  it("s54 bull call spread - risk is capped at the debit", () => {
    const s = s54BullCallSpread(90, 2, 100, 1);
    expect(s.payoff([85])).toEqual([-1]);
    expect(s.payoff([95])).toEqual([4]);
    expect(s.payoff([105])).toEqual([9]);
    expect(s.payoff([200])).toEqual([9]);
    expect(s.maxProfit(GRID)).toBe(9);
    expect(s.maxLoss(GRID)).toBe(-1);
    expect(s.breakevens(GRID)).toEqual([91, 91]);
  });

  it("s55 bear put spread", () => {
    const s = s55BearPutSpread(110, 3, 100, 2);
    expect(s.payoff([0])).toEqual([9]);
    expect(s.payoff([105])).toEqual([4]);
    expect(s.maxProfit(GRID)).toBe(9);
    expect(s.maxLoss(GRID)).toBe(-1);
    expect(s.breakevens(GRID)).toEqual([109, 109]);
  });

  it("s56 bear call spread - credit spread, capped upside loss", () => {
    const s = s56BearCallSpread(90, 2, 100, 1);
    // Below 90 it is the net credit, 2 received less the 1 paid for the long leg.
    expect(s.payoff([0])).toEqual([1]);
    expect(s.payoff([95])).toEqual([-4]);
    expect(s.maxProfit(GRID)).toBe(1);
    // Above the short strike the loss grows at 1 per share: the long leg caps
    // half of the short leg's exposure.
    expect(s.payoff([200])).toEqual([-9]);
    expect(s.breakevens(GRID)).toEqual([91, 91]);
  });

  it("s57 bull put spread", () => {
    const s = s57BullPutSpread(110, 3, 100, 2);
    expect(s.payoff([0])).toEqual([-9]);
    expect(s.payoff([105])).toEqual([-4]);
    expect(s.payoff([110])).toEqual([1]);
    // Above 110 the long put expires worthless, so the short stays open at +3 - 2.
    expect(s.payoff([200])).toEqual([1]);
    expect(s.maxProfit(GRID)).toBe(1);
    expect(s.maxLoss(GRID)).toBe(-9);
    expect(s.breakevens(GRID)).toEqual([109, 109]);
  });
});

describe("#58-59: wings", () => {
  it("s58 iron condor - a defined-risk range premium", () => {
    const s = s58IronCondor(90, 1, 95, 2, 105, 2, 110, 1);
    expect(s.payoff([0])).toEqual([-3]);
    expect(s.payoff([95])).toEqual([2]);
    expect(s.payoff([105])).toEqual([2]);
    expect(s.payoff([200])).toEqual([-3]);
    expect(s.maxProfit(GRID)).toBe(2);
    expect(s.maxLoss(GRID)).toBe(-3);
    // 93 in the lower wing, 107 in the upper one.
    expect(s.breakevens(GRID)).toEqual([93, 93, 107, 107]);
  });

  it("s59 iron butterfly - a tent centred on the short strike", () => {
    const s = s59IronButterfly(100, 2, 2, 90, 1, 110, 1);
    expect(s.payoff([100])).toEqual([2]);
    expect(s.payoff([0])).toEqual([-8]);
    // Below the lower wing the two puts offset, so the loss is flat at -8; between
    // the wings the slope is +/-1 out of the short strike, so the crossings sit two
    // points either side of 100, where the two short premiums cancel.
    expect(s.breakevens(GRID)).toEqual([98, 98, 102, 102]);
    expect(s.maxLoss(GRID)).toBe(-8);
    expect(s.maxProfit(GRID)).toBe(2);
  });
});

describe("#60-62: volatility structures", () => {
  it("s60 long straddle - profits on a big move either way", () => {
    const s = s60LongStraddle(100, 3, 3);
    expect(s.payoff([100])).toEqual([-6]);
    expect(s.payoff([0])).toEqual([94]);
    expect(s.payoff([200])).toEqual([94]);
    expect(s.maxLoss(GRID)).toBe(-6);
    expect(s.breakevens(GRID)).toEqual([94, 94, 106, 106]);
  });

  it("s61 long strangle - cheaper than a straddle, further out the money", () => {
    const s = s61LongStrangle(110, 3, 90, 3);
    expect(s.payoff([100])).toEqual([-6]);
    expect(s.maxLoss(GRID)).toBe(-6);
    expect(s.breakevens(GRID)).toEqual([84, 84, 116, 116]);
  });

  it("s62 short straddle - the mirror image, and unlimited below", () => {
    const s = s62ShortStraddle(100, 3, 3);
    expect(s.payoff([100])).toEqual([6]);
    expect(s.payoff([0])).toEqual([-94]);
    expect(s.maxProfit(GRID)).toBe(6);
    expect(s.breakevens(GRID)).toEqual([94, 94, 106, 106]);
  });

  it("s62 short strangle", () => {
    const s = s62ShortStrangle(110, 3, 90, 3);
    expect(s.payoff([100])).toEqual([6]);
    expect(s.maxProfit(GRID)).toBe(6);
    expect(s.breakevens(GRID)).toEqual([84, 84, 116, 116]);
  });

  it("s62 overloaded builder: three prices is a straddle, four is a strangle", () => {
    expect(s62ShortStraddleStrangle(100, 3, 3).payoff([100])).toEqual([6]);
    expect(s62ShortStraddleStrangle(110, 3, 90, 3).payoff([100])).toEqual([6]);
  });
});

describe("#63-64: time-dependent spreads", () => {
  const S = 100;
  const r = 0.05;
  const vol = 0.2;

  it("s63 calendar equals the long leg's Black-Scholes value at the short expiry", () => {
    // ATM, so the short leg expires worthless and the whole spread is the long
    // leg with (tLong - tShort) years left.
    expect(s63CalendarSpread(S, 100, 0.5, 1.0, r, vol, "call")).toBeCloseTo(
      bsPrice(S, 100, 0.5, r, vol, "call"),
      12
    );
  });

  it("s63 is only the discounted strike deep in the money", () => {
    // 50 points ITM: the short leg is worth its 50 of intrinsic, and the long leg is
    // worth S - K e^(-rT) plus its own residual time value, so all that is left of
    // the spread is K(1 - e^(-rT)) = 2.469 plus a sliver of time value.
    const value = s63CalendarSpread(150, 100, 0.5, 1.0, r, vol, "call");
    const timeValue = bsPrice(150, 100, 0.5, r, vol, "call") - (150 - 100 * Math.exp(-r * 0.5));
    expect(timeValue).toBeGreaterThan(0);
    expect(timeValue).toBeLessThan(0.05);
    expect(value).toBeCloseTo(100 * (1 - Math.exp(-r * 0.5)) + timeValue, 10);
    expect(value).toBeLessThan(s63CalendarSpread(100, 100, 0.5, 1.0, r, vol, "call"));
  });

  it("s63 works for puts too", () => {
    expect(s63CalendarSpread(S, 100, 0.25, 0.75, r, vol, "put")).toBeCloseTo(
      bsPrice(S, 100, 0.5, r, vol, "put"),
      12
    );
  });

  it("calendarSpreadValue is what s63 delegates to", () => {
    expect(calendarSpreadValue(S, 100, 0.5, 1.0, r, vol, "call")).toBe(
      s63CalendarSpread(S, 100, 0.5, 1.0, r, vol, "call")
    );
  });

  it("s64 diagonal prices the long leg at its own strike, less the short's intrinsic", () => {
    expect(s64DiagonalSpread(S, 100, 90, 0.5, 1.0, r, vol, "call")).toBeCloseTo(
      bsPrice(S, 90, 0.5, r, vol, "call"),
      12
    );
    // Short leg in the money: its intrinsic has to come straight back out.
    expect(s64DiagonalSpread(120, 100, 90, 0.5, 1.0, r, vol, "call")).toBeCloseTo(
      bsPrice(120, 90, 0.5, r, vol, "call") - 20,
      12
    );
    expect(s64DiagonalSpread(S, 100, 110, 0.5, 1.0, r, vol, "put")).toBeCloseTo(
      bsPrice(S, 110, 0.5, r, vol, "put"),
      12
    );
  });
});

describe("#65-66", () => {
  it("s65 cash-secured put - the strike is the effective purchase price", () => {
    const s = s65CashSecuredPut(100, 3);
    expect(s.payoff([100])).toEqual([3]);
    expect(s.payoff([0])).toEqual([-97]);
    expect(s.maxProfit(GRID)).toBe(3);
    expect(s.breakevens(GRID)).toEqual([97, 97]);
  });

  it("s66 ratio spread - the extra short leg inverts the slope above its strike", () => {
    const s = s66RatioSpread(100, 3, 105, 2, 2);
    expect(s.payoff([100])).toEqual([1]);
    expect(s.payoff([105])).toEqual([6]);
    expect(s.maxProfit(GRID)).toBe(6);
    // Past 105 the position is net short 1, so the loss grows at 1 per share.
    expect(s.payoff([200])).toEqual([-89]);
    expect(s.breakevens(GRID)).toEqual([111, 111]);
  });

  it("s66 with a 1-for-1 ratio is a plain vertical spread", () => {
    const s = s66RatioSpread(100, 3, 105, 2, 1);
    expect(s.payoff([200])).toEqual([4]);
    expect(s.maxProfit(GRID)).toBe(4);
    expect(s.breakevens(GRID)).toEqual([101, 101]);
  });
});
