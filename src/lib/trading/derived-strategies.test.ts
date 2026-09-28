/**
 * Python parity tests for the ported strategies (#67-100).
 *
 * Same contract as `strategies.test.ts`: every expectation comes from
 * `src/lib/trading/python-reference.json`, which is produced by running the
 * UNMODIFIED reference library (`tools/gen_reference_fixture.py`).
 *
 * Unlike #1-48, this half of the library cannot be driven off the bundled price
 * history - merger terms, order books, fundamentals, macro releases and earnings
 * calendars are all external feeds the reference expects to be plugged in. The
 * decision logic in each function is nevertheless pure maths, so the fixture
 * feeds BOTH implementations the same deterministic synthetic inputs and records
 * the inputs alongside the outputs. The TS side then replays those recorded
 * inputs, which means a porting slip still shows up as a failing assertion
 * rather than as a silently different signal.
 *
 * #49-66 (options) is the one gap: `options_pricing.py` imports scipy, which is
 * not installed, so there is no fixture to diff against. Those are covered
 * analytically in `options.test.ts` instead.
 */

import { describe, expect, it } from "vitest";
import reference from "./python-reference.json";
import { Series } from "./series";
import { Wide } from "./strategies/multi-asset";
import * as arb from "./strategies/arbitrage";
import * as qs from "./strategies/quant";
import * as fm from "./strategies/fundamental-macro";
import * as sn from "./strategies/seasonal-niche";

type Cell = number | boolean | null;
type Section = { inputs: Record<string, Cell | Cell[] | Record<string, Cell | Cell[]>>; outputs: Record<string, Cell[]> };

const derived = (reference as unknown as { derived: Record<string, Section> }).derived;

const inputs = (section: string): Record<string, unknown> => derived[section].inputs as Record<string, unknown>;
const output = (section: string, key: string): Cell[] => {
  const bucket = derived[section].outputs as Record<string, Cell[]>;
  if (!bucket[key]) throw new Error(`fixture has no recorded output "${section}.${key}"`);
  return bucket[key];
};

/** Recorded input series, with pandas' `None` restored as `NaN`. */
const inNum = (section: string, key: string): Series =>
  (inputs(section)[key] as Cell[]).map((v) => (v === null ? NaN : Number(v)));

/**
 * Compare against a recorded output.
 *
 * `exact` is for discrete results - signals, boolean masks, level indices -
 * where the port must agree bar for bar. Float results are compared to the
 * fixture's 6-decimal precision instead, with a RELATIVE tolerance: the fixture
 * also stores its synthetic inputs at 6 decimals, and the arbitrage/quant
 * functions are mostly ratios, so a 5e-7 input rounding error is amplified by
 * the division and a flat 1e-6 window would fail bars that are in fact correct.
 */
function check(section: string, key: string, actual: Array<number | boolean>, exact = true) {
  const want = output(section, key);
  const label = `${section}.${key}`;
  expect(actual.length, `${label}: length`).toBe(want.length);
  const bad: string[] = [];
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    const a = actual[i];
    if (w === null) {
      if (!Number.isNaN(Number(a))) bad.push(`[${i}] got ${a}, want NaN`);
      continue;
    }
    const an = Number(a);
    const wn = Number(w);
    const ok = exact ? an === wn : Math.abs(an - wn) <= 1e-6 * Math.max(1, Math.abs(wn));
    if (!ok) bad.push(`[${i}] got ${an}, want ${wn}`);
  }
  expect(bad.slice(0, 8), `${label}: ${bad.length} of ${want.length} bar(s) differ`).toEqual([]);
}

/** The real 2,500-bar SPY calendar, reused by every calendar strategy. */
const calendar: Series = inNum("calendar", "_ts");
const close: Series = (
  (reference as unknown as { columns: Record<string, Cell[]> }).columns._close as Cell[]
).map((v) => (v === null ? NaN : Number(v)));

describe("python parity: arbitrage & relative value (#67-75)", () => {
  it("s67 merger arbitrage (explicit completion probability)", () => {
    const got = arb.s67MergerArbitrage(
      inNum("arbitrage", "target"),
      inputs("arbitrage").deal as number,
      inNum("arbitrage", "completion_prob")
    );
    check("arbitrage", "s67_spread_pct", got.spreadPct, false);
    check("arbitrage", "s67_signal", got.signal);
  });

  it("s67 defaults the completion probability to 0.9", () => {
    const target = inNum("arbitrage", "target");
    const prob = inNum("arbitrage", "completion_prob");
    const withProb = arb.s67MergerArbitrage(target, 45, prob);
    // At p = 0.85 the expected value is still dominated by a positive spread, so
    // the default only has to agree on the sign, which is what it flips on.
    const defaulted = arb.s67MergerArbitrage(target, 45);
    expect(defaulted.spreadPct).toEqual(withProb.spreadPct);
    check("arbitrage", "s67_signal", defaulted.signal);
  });

  it("s68 convertible hedge ratio", () => {
    // The reference derives the hedge from `delta` alone; the bond and stock
    // prices are accepted for interface parity and never read.
    const delta = inNum("arbitrage", "delta");
    check(
      "arbitrage",
      "s68_hedge_shares",
      arb.s68ConvertibleBondArbitrage(delta, delta, inputs("arbitrage").conv_ratio as number, delta),
      false
    );
  });

  it("s69 index vs futures", () => {
    const got = arb.s69IndexArbitrage(
      inNum("arbitrage", "index_level"),
      inNum("arbitrage", "futures"),
      inputs("arbitrage").rate as number,
      inputs("arbitrage").div_yield as number,
      inNum("arbitrage", "t_years")
    );
    check("arbitrage", "s69_mispricing", got.mispricing, false);
    check("arbitrage", "s69_signal", got.signal);
  });

  it("s70 triangular FX", () => {
    const got = arb.s70TriangularArbitrage(
      inNum("arbitrage", "ab"),
      inNum("arbitrage", "bc"),
      inNum("arbitrage", "ac")
    );
    check("arbitrage", "s70_discrepancy_pct", got.discrepancyPct, false);
    check("arbitrage", "s70_tradable", got.tradable);
  });

  it("s71 cross-exchange, both venues", () => {
    const got = arb.s71CrossExchangeArbitrage(inNum("arbitrage", "venue_a"), inNum("arbitrage", "venue_b"));
    check("arbitrage", "s71_spread_pct", got.spreadPct, false);
    check("arbitrage", "s71_signal", got.signal);
  });

  it("s72 carry trade", () => {
    const got = arb.s72CarryTrade(
      inNum("arbitrage", "rate_high"),
      inNum("arbitrage", "rate_low"),
      inNum("arbitrage", "fx")
    );
    check("arbitrage", "s72_daily_carry", got.dailyCarry, false);
    check("arbitrage", "s72_stopped_out", got.stoppedOut);
  });

  it("s73 futures calendar spread", () => {
    const got = arb.s73FuturesCalendarArbitrage(
      inNum("arbitrage", "near"),
      inNum("arbitrage", "far"),
      inputs("arbitrage").rate as number,
      inNum("arbitrage", "t_near"),
      inNum("arbitrage", "t_far"),
      inNum("arbitrage", "fut_spot")
    );
    check("arbitrage", "s73_mispricing", got.mispricing, false);
    check("arbitrage", "s73_signal", got.signal);
  });

  it("s74 ETF premium/discount monitor", () => {
    const got = arb.s74EtfArbitrageMonitor(inNum("arbitrage", "etf"), inNum("arbitrage", "nav"));
    check("arbitrage", "s74_premium_discount_pct", got.premiumDiscountPct, false);
    check("arbitrage", "s74_alert", got.alert);
  });

  it("s75 volatility arbitrage", () => {
    const got = arb.s75VolatilityArbitrage(inNum("arbitrage", "iv"), inNum("arbitrage", "vol_forecast"));
    check("arbitrage", "s75_edge", got.edge, false);
    check("arbitrage", "s75_signal", got.signal);
  });
});

describe("python parity: quant, systematic & execution (#76-86)", () => {
  /** Rebuild the reference's `(ticker, metric)` MultiIndex frame as a Wide. */
  function fundamentals(): qs.Fundamentals {
    const q = inputs("quant");
    const tickers = q.tickers as string[];
    const metrics = ["pe", "pb", "roe", "debt_equity", "momentum_12_1", "trailing_vol"];
    const out: qs.Fundamentals = {};
    for (const t of tickers) {
      out[t] = {};
      for (const m of metrics) out[t][m] = inNum("quant", `f_${t}_${m}`);
    }
    return out;
  }

  it("s76 factor screen, all four factors", () => {
    const f = fundamentals();
    const topPct = inputs("quant").factor_top_pct as number;
    for (const factor of ["value", "momentum", "quality", "low_vol"] as const) {
      const sel = qs.s76FactorInvesting(f, factor, topPct);
      for (const t of Object.keys(sel)) check("quant", `s76_${factor}_${t}`, sel[t]);
    }
  });

  it("s77 inverse-volatility risk parity", () => {
    const returns: Wide = { X: inNum("quant", "ret_X"), Y: inNum("quant", "ret_Y"), Z: inNum("quant", "ret_Z") };
    const w = qs.s77RiskParity(returns, 60);
    for (const a of Object.keys(w)) check("quant", `s77_${a}`, w[a], false);
  });

  it("s78 market-making quotes at flat and long inventory", () => {
    const mid = inNum("quant", "mm_mid");
    const flat = qs.s78MarketMaking(mid, 0.1, 0);
    check("quant", "s78_bid", flat.bid, false);
    check("quant", "s78_ask", flat.ask, false);
    const long = qs.s78MarketMaking(mid, 0.1, 50);
    check("quant", "s78_bid_long", long.bid, false);
    check("quant", "s78_ask_long", long.ask, false);
  });

  it("s79 latency arbitrage refuses to pretend", () => {
    expect(() => qs.s79HftLatencyArbitrageNote()).toThrow(/co-location/);
  });

  it("s80 VWAP slices are banker's-rounded", () => {
    check("quant", "s80_slices", qs.s80VwapExecution(10_000, inNum("quant", "vol_curve")), false);
  });

  it("s81 TWAP slices", () => {
    check("quant", "s81_slices", qs.s81TwapExecution(10_000, 4), false);
  });

  it("s82 model output is gated by confidence", () => {
    // Stands in for a fitted classifier: P(up) is the first feature, so the
    // fixture pins the [P(down), P(up)] column order as well as the gate.
    const model: qs.ProbModel = {
      predictProba: (rows) => rows.map((r) => [1 - r[0], r[0]]),
    };
    const got = qs.s82MlSignalTrading({ f0: inNum("quant", "ml_features") }, model, 0.6);
    check("quant", "s82_signal", got);
  });

  it("s83 smoothed sentiment gate", () => {
    check("quant", "s83_signal", qs.s83SentimentTrading(inNum("quant", "sentiment"), 0.3, 5));
  });

  it("s84 grid trading including both hard stops", () => {
    check("quant", "s84_signal", qs.s84GridTrading(inNum("quant", "grid_price"), 90, 110, 10, 1.0, true), false);
  });

  it("s85 martingale sizing", () => {
    const q = inputs("quant");
    const p = q.martingale_params as { baseSize: number; multiplier: number; maxDoublings: number };
    expect(qs.s85MartingaleSizing(q.martingale_results as number[], p.baseSize, p.multiplier, p.maxDoublings))
      .toBeCloseTo(output("quant", "s85_size")[0] as number, 6);
    // Nine straight losses hit the doubling cap, not 2^9.
    expect(qs.s85MartingaleSizing(q.martingale_streak as number[], p.baseSize, p.multiplier, p.maxDoublings))
      .toBeCloseTo(output("quant", "s85_size_streak")[0] as number, 6);
  });

  it("s86 Kelly sizing", () => {
    const k = inputs("quant").kelly_params as {
      winProb: number; winLossRatio: number; kellyScale: number; accountEquity: number;
    };
    expect(qs.s86KellySizing(k.winProb, k.winLossRatio, k.kellyScale, k.accountEquity))
      .toBeCloseTo(output("quant", "s86_size")[0] as number, 6);
  });
});

describe("python parity: fundamental & macro (#87-94)", () => {
  /** The reference's flat one-row-per-ticker fundamentals frame. */
  function screen(): fm.Metrics {
    const f = inputs("fundamental");
    const get = (k: string): Series => (f[k] as Cell[]).map((v) => (v === null ? NaN : Number(v)));
    return {
      pe: get("pe"),
      pb: get("pb"),
      debt_equity: get("debt_equity"),
      eps_growth_yoy_pct: get("eps_growth"),
      revenue_growth_yoy_pct: get("rev_growth"),
      dividend_yield_pct: get("div_yield"),
      consecutive_years_dividend_growth: get("div_years"),
      payout_ratio: get("payout"),
    };
  }

  it("s87 deep value, with and without the margin of safety", () => {
    check("fundamental", "s87_screen", fm.s87ValueInvesting(screen()));
    check(
      "fundamental",
      "s87_undervalued",
      fm.s87ValueInvesting(screen(), 15, 1.5, 1.0, 0.2, inNum("fundamental", "price"), inNum("fundamental", "intrinsic"))
    );
  });

  it("s88 growth screen needs both earnings and revenue", () => {
    check("fundamental", "s88_screen", fm.s88GrowthInvesting(screen()));
  });

  it("s89 PEG screen", () => {
    check("fundamental", "s89_screen", fm.s89Garp(screen()));
  });

  it("s90 dividend-growth screen", () => {
    check("fundamental", "s90_screen", fm.s90DividendInvesting(screen()));
  });

  it("s91 macro surprise flags and direction", () => {
    const got = fm.s91GlobalMacroDashboard(
      { actual: inNum("fundamental", "actual"), consensus: inNum("fundamental", "consensus") },
      0.5
    );
    check("fundamental", "s91_flagged", got.flagged);
    check("fundamental", "s91_direction", got.direction);
  });

  it("s92 yield-curve mean reversion, inverted for flattening", () => {
    check(
      "fundamental",
      "s92_signal",
      fm.s92YieldCurveTrading(inNum("fundamental", "short_yield"), inNum("fundamental", "long_yield"), 252, 1.5)
    );
  });

  it("s93 commodity seasonal window", () => {
    check("calendar", "s93_commodity_seasonal", fm.s93CommoditySeasonal(calendar, 9, 11));
  });

  it("s94 post-earnings drift, later releases overwrite earlier", () => {
    const f = inputs("fundamental");
    const got = fm.s94EarningsAnnouncementTrading(
      inNum("fundamental", "earn_ts"),
      f.earn_dates as number[],
      f.earn_surprise as Record<string, number>,
      10,
      5.0
    );
    check("fundamental", "s94_signal", got);
  });
});

describe("python parity: behavioral, seasonal & niche (#95-100)", () => {
  it("s95 sell in May", () => {
    check("calendar", "s95_sell_in_may", sn.s95SellInMay(calendar));
  });

  it("s96 January effect weights, per asset", () => {
    // The reference reads only the frame's index and column names.
    const smallCaps: Wide = { IWM: close, SLY: close };
    const w = sn.s96JanuaryEffect(calendar, smallCaps);
    for (const asset of Object.keys(w)) check("calendar", `s96_${asset}`, w[asset]);
  });

  it("s97 Santa Claus rally", () => {
    check("calendar", "s97_santa_claus_rally", sn.s97SantaClausRally(calendar));
  });

  it("s98 turn of the month", () => {
    check("calendar", "s98_turn_of_month", sn.s98TurnOfMonth(calendar));
  });

  it("s99 insider cloning keeps only qualifying buys", () => {
    const f = inputs("insider");
    const txs = (f.transactions as Array<Record<string, number | string>>).map((t) => ({
      date: Number(t.date),
      ticker: String(t.ticker),
      transactionType: String(t.transactionType) as "buy" | "sell",
      valueUsd: Number(t.valueUsd),
    }));
    const got = sn.s99InsiderInstitutionalCloning(txs, f.min_usd as number, f.lookback_days as number);
    expect(got.map((g) => g.ticker)).toEqual(f.expected_tickers as string[]);
    expect(got.map((g) => g.date)).toEqual(f.expected_dates as number[]);
    expect(got.map((g) => g.signalEnd)).toEqual(f.expected_signal_end as number[]);
  });

  it("s100 contrarian sentiment buys extreme fear", () => {
    check("calendar", "s100_contrarian_sentiment", sn.s100ContrarianSentiment(inNum("calendar", "_rv20"), 252, 10, 90));
  });
});
