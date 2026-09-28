/**
 * Tests for the all-100 registry - the TS counterpart of `strategies/__init__.py`.
 *
 * The point of this file is completeness, not behaviour: every strategy's own
 * maths is pinned by the parity suites (`strategies.test.ts` for #1-48,
 * `derived-strategies.test.ts` for #67-100, `options.test.ts` for #49-66). What
 * can silently rot here is the registry itself - a renumbered key, a strategy
 * wired to the wrong module, a number that quietly goes missing - so the
 * expectations are the reference's own key list, copied verbatim from
 * `strategies/__init__.py`.
 */

import { describe, expect, it } from "vitest";
import { REGISTRY, getStrategy, listStrategies } from "./index";

/** The reference's REGISTRY keys, in its own order. */
const REFERENCE_KEYS = [
  "01_ma_crossover", "02_golden_death_cross", "03_macd_crossover", "04_adx_trend_gate",
  "05_donchian_breakout", "06_turtle_system", "07_parabolic_sar", "08_ichimoku",
  "09_supertrend", "10_momentum_roc", "11_relative_strength_rotation", "12_new_high_momentum",
  "13_dual_momentum", "14_trendline_channel", "15_buy_the_dip",
  "16_rsi_reversion", "17_connors_rsi2", "18_bollinger_reversion", "19_stochastic_reversion",
  "20_zscore_reversion", "21_pairs_trading", "22_stat_arb_basket", "23_vwap_reversion",
  "24_overnight_reversal", "25_cci_reversion", "26_williams_r_reversion", "27_fade_the_gap",
  "28_sector_mean_reversion",
  "29_range_breakout", "30_opening_range_breakout", "31_volatility_squeeze_breakout",
  "32_retest_entry", "33_failed_breakout_reversal", "34_support_resistance_bounce",
  "35_triangle_breakout", "36_flag_pennant_continuation", "37_round_number_levels",
  "38_volume_breakout_confirmation",
  "39_head_and_shoulders", "40_double_top_bottom", "41_cup_and_handle", "42_wedge_breakout",
  "43_engulfing_reversal", "44_hammer_shooting_star", "45_doji_confirmation",
  "46_morning_evening_star", "47_inside_bar_breakout", "48_three_soldiers_crows",
  "49_covered_call", "50_protective_put", "51_collar", "52_long_call", "53_long_put",
  "54_bull_call_spread", "55_bear_put_spread", "56_bear_call_spread", "57_bull_put_spread",
  "58_iron_condor", "59_iron_butterfly", "60_long_straddle", "61_long_strangle",
  "62_short_straddle_strangle", "63_calendar_spread", "64_diagonal_spread",
  "65_cash_secured_put", "66_ratio_spread",
  "67_merger_arbitrage", "68_convertible_bond_arbitrage", "69_index_arbitrage",
  "70_triangular_arbitrage", "71_cross_exchange_arbitrage", "72_carry_trade",
  "73_futures_calendar_arbitrage", "74_etf_arbitrage_monitor", "75_volatility_arbitrage",
  "76_factor_investing", "77_risk_parity", "78_market_making", "79_hft_latency_arbitrage",
  "80_vwap_execution", "81_twap_execution", "82_ml_signal_trading", "83_sentiment_trading",
  "84_grid_trading", "85_martingale_sizing", "86_kelly_sizing",
  "87_value_investing", "88_growth_investing", "89_garp", "90_dividend_investing",
  "91_global_macro_dashboard", "92_yield_curve_trading", "93_commodity_seasonal",
  "94_earnings_announcement_trading",
  "95_sell_in_may", "96_january_effect", "97_santa_claus_rally", "98_turn_of_month",
  "99_insider_institutional_cloning", "100_contrarian_sentiment",
];

describe("strategy registry", () => {
  it("registers exactly the reference's 100 keys", () => {
    expect(Object.keys(REGISTRY).sort()).toEqual([...REFERENCE_KEYS].sort());
    expect(Object.keys(REGISTRY)).toHaveLength(100);
  });

  it("covers 1-100 with no gaps and no duplicate numbers", () => {
    const numbers = Object.keys(REGISTRY).map((k) => parseInt(k, 10));
    expect(numbers).toHaveLength(100);
    for (let n = 1; n <= 100; n++) expect(numbers).toContain(n);
    // Sorted output, so a duplicate would show up as a repeated number.
    expect(new Set(numbers).size).toBe(100);
  });

  it("lists strategies in numeric order, not alphabetical", () => {
    const listed = listStrategies();
    expect(listed).toEqual(REFERENCE_KEYS);
    // "100_..." must sort after "10_...", which a plain string sort would break.
    expect(listed.indexOf("100_contrarian_sentiment")).toBe(99);
    expect(listed.indexOf("10_momentum_roc")).toBe(9);
  });

  it("maps every key to a function", () => {
    for (const [key, fn] of Object.entries(REGISTRY)) {
      expect(typeof fn, key).toBe("function");
    }
  });

  it("looks up by full key", () => {
    expect(getStrategy("01_ma_crossover")).toBe(REGISTRY["01_ma_crossover"]);
    expect(getStrategy("100_contrarian_sentiment")).toBe(REGISTRY["100_contrarian_sentiment"]);
  });

  it("looks up by number, as a number or a string", () => {
    expect(getStrategy(1)).toBe(REGISTRY["01_ma_crossover"]);
    expect(getStrategy("1")).toBe(REGISTRY["01_ma_crossover"]);
    expect(getStrategy(9)).toBe(REGISTRY["09_supertrend"]);
    expect(getStrategy(49)).toBe(REGISTRY["49_covered_call"]);
    expect(getStrategy(100)).toBe(REGISTRY["100_contrarian_sentiment"]);
    expect(getStrategy("79")).toBe(REGISTRY["79_hft_latency_arbitrage"]);
  });

  it("round-trips every key through the number lookup", () => {
    for (const key of listStrategies()) {
      const n = parseInt(key, 10);
      expect(getStrategy(n), key).toBe(REGISTRY[key]);
      expect(getStrategy(key), key).toBe(REGISTRY[key]);
    }
  });

  it("throws on an unknown strategy rather than returning undefined", () => {
    expect(() => getStrategy(101)).toThrow(/No strategy found/);
    expect(() => getStrategy("nope")).toThrow(/No strategy found/);
    // Inherited Object properties must not be mistaken for strategies.
    expect(() => getStrategy("toString")).toThrow(/No strategy found/);
    expect(() => getStrategy("constructor")).toThrow(/No strategy found/);
  });

  it("keeps #79 as the reference's 'not implementable' note", () => {
    // #79 is not a strategy, it is a function that explains why. The reference
    // registers it anyway so the numbering has no hole.
    expect(() => getStrategy(79)()).toThrow();
  });
});
