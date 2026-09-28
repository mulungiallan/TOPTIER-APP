/**
 * Central registry for all 100 strategies - the TS counterpart of
 * `strategies/__init__.py`.
 *
 * The reference exposes `REGISTRY`, `list_strategies()` and `get_strategy()` so
 * a caller can reach any strategy by its key (`"01_ma_crossover"`) or its number
 * (1, or `"1"`):
 *
 *     signal = REGISTRY["01_ma_crossover"](df, { fast: 10, slow: 50 });
 *
 * The keys are copied verbatim from the reference, so a strategy keeps the same
 * identity across the two implementations.
 *
 * Signatures are NOT uniform, exactly as the reference warns: #49-66 return
 * `OptionsStrategy` objects rather than signals, #11-13/21/22/28/76/77/96 want a
 * wide frame of many tickers, #67-75/87-94/99/100 need feeds this library does not
 * fetch, #80/81 are execution algos and #85/86 are sizing helpers. The registry is
 * therefore deliberately untyped per entry - check the module docstring before
 * calling anything through it.
 */

import * as arb from "./arbitrage";
import * as br from "./breakout-range";
import * as cp from "./chart-patterns";
import * as fm from "./fundamental-macro";
import * as mr from "./mean-reversion";
import * as ma from "./multi-asset";
import * as opt from "./options";
import * as qs from "./quant";
import * as sn from "./seasonal-niche";
import * as tm from "./trend-momentum";

/** Any strategy function. The `never` args keep every signature assignable. */
export type StrategyFn = (...args: never[]) => unknown;

/** Lookup by key, e.g. `REGISTRY["49_covered_call"]`. */
export const REGISTRY: Record<string, StrategyFn> = {
  // A. Trend & Momentum (1-15)
  "01_ma_crossover": tm.s01MaCrossover,
  "02_golden_death_cross": tm.s02GoldenDeathCross,
  "03_macd_crossover": tm.s03MacdCrossover,
  "04_adx_trend_gate": tm.s04AdxTrendGate,
  "05_donchian_breakout": tm.s05DonchianBreakout,
  "06_turtle_system": tm.s06TurtleSystem,
  "07_parabolic_sar": tm.s07ParabolicSar,
  "08_ichimoku": tm.s08Ichimoku,
  "09_supertrend": tm.s09Supertrend,
  "10_momentum_roc": tm.s10MomentumRoc,
  "11_relative_strength_rotation": tm.s11RelativeStrengthRotation,
  "12_new_high_momentum": tm.s12NewHighMomentum,
  "13_dual_momentum": tm.s13DualMomentum,
  "14_trendline_channel": tm.s14TrendlineChannel,
  "15_buy_the_dip": tm.s15BuyTheDip,

  // B. Mean Reversion / Counter-Trend (16-28). #21, #22 and #28 live in
  // multi-asset.ts here (the reference has them in mean_reversion.py); #11-13 are
  // reachable from there too, but the reference maps them to trend_momentum, so
  // the registry follows the reference.
  "16_rsi_reversion": mr.s16RsiReversion,
  "17_connors_rsi2": mr.s17ConnorsRsi2,
  "18_bollinger_reversion": mr.s18BollingerReversion,
  "19_stochastic_reversion": mr.s19StochasticReversion,
  "20_zscore_reversion": mr.s20ZscoreReversion,
  "21_pairs_trading": ma.s21PairsTrading,
  "22_stat_arb_basket": ma.s22StatArbBasket,
  "23_vwap_reversion": mr.s23VwapReversion,
  "24_overnight_reversal": mr.s24OvernightReversal,
  "25_cci_reversion": mr.s25CciReversion,
  "26_williams_r_reversion": mr.s26WilliamsRReversion,
  "27_fade_the_gap": mr.s27FadeTheGap,
  "28_sector_mean_reversion": ma.s28SectorMeanReversion,

  // C. Breakout & Range (29-38)
  "29_range_breakout": br.s29RangeBreakout,
  "30_opening_range_breakout": br.s30OpeningRangeBreakout,
  "31_volatility_squeeze_breakout": br.s31VolatilitySqueezeBreakout,
  "32_retest_entry": br.s32RetestEntry,
  "33_failed_breakout_reversal": br.s33FailedBreakoutReversal,
  "34_support_resistance_bounce": br.s34SupportResistanceBounce,
  "35_triangle_breakout": br.s35TriangleBreakout,
  "36_flag_pennant_continuation": br.s36FlagPennantContinuation,
  "37_round_number_levels": br.s37RoundNumberLevels,
  "38_volume_breakout_confirmation": br.s38VolumeBreakoutConfirmation,

  // D. Chart & Candlestick Patterns (39-48)
  "39_head_and_shoulders": cp.s39HeadAndShoulders,
  "40_double_top_bottom": cp.s40DoubleTopBottom,
  "41_cup_and_handle": cp.s41CupAndHandle,
  "42_wedge_breakout": cp.s42WedgeBreakout,
  "43_engulfing_reversal": cp.s43EngulfingReversal,
  "44_hammer_shooting_star": cp.s44HammerShootingStar,
  "45_doji_confirmation": cp.s45DojiConfirmation,
  "46_morning_evening_star": cp.s46MorningEveningStar,
  "47_inside_bar_breakout": cp.s47InsideBarBreakout,
  "48_three_soldiers_crows": cp.s48ThreeSoldiersCrows,

  // E. Options (49-66) - return OptionsStrategy objects, not signals
  "49_covered_call": opt.s49CoveredCall,
  "50_protective_put": opt.s50ProtectivePut,
  "51_collar": opt.s51Collar,
  "52_long_call": opt.s52LongCall,
  "53_long_put": opt.s53LongPut,
  "54_bull_call_spread": opt.s54BullCallSpread,
  "55_bear_put_spread": opt.s55BearPutSpread,
  "56_bear_call_spread": opt.s56BearCallSpread,
  "57_bull_put_spread": opt.s57BullPutSpread,
  "58_iron_condor": opt.s58IronCondor,
  "59_iron_butterfly": opt.s59IronButterfly,
  "60_long_straddle": opt.s60LongStraddle,
  "61_long_strangle": opt.s61LongStrangle,
  // The reference's overloaded #62 - three prices is a straddle, four a strangle.
  "62_short_straddle_strangle": opt.s62ShortStraddleStrangle,
  "63_calendar_spread": opt.s63CalendarSpread,
  "64_diagonal_spread": opt.s64DiagonalSpread,
  "65_cash_secured_put": opt.s65CashSecuredPut,
  "66_ratio_spread": opt.s66RatioSpread,

  // F. Arbitrage & Relative Value (67-75) - need external feeds
  "67_merger_arbitrage": arb.s67MergerArbitrage,
  "68_convertible_bond_arbitrage": arb.s68ConvertibleBondArbitrage,
  "69_index_arbitrage": arb.s69IndexArbitrage,
  "70_triangular_arbitrage": arb.s70TriangularArbitrage,
  "71_cross_exchange_arbitrage": arb.s71CrossExchangeArbitrage,
  "72_carry_trade": arb.s72CarryTrade,
  "73_futures_calendar_arbitrage": arb.s73FuturesCalendarArbitrage,
  "74_etf_arbitrage_monitor": arb.s74EtfArbitrageMonitor,
  "75_volatility_arbitrage": arb.s75VolatilityArbitrage,

  // G. Quant, Systematic & Execution (76-86)
  "76_factor_investing": qs.s76FactorInvesting,
  "77_risk_parity": qs.s77RiskParity,
  "78_market_making": qs.s78MarketMaking,
  // #79 is not implementable at the application layer; this is the reference's
  // note explaining why, kept so the registry has no hole at 79.
  "79_hft_latency_arbitrage": qs.s79HftLatencyArbitrageNote,
  "80_vwap_execution": qs.s80VwapExecution,
  "81_twap_execution": qs.s81TwapExecution,
  "82_ml_signal_trading": qs.s82MlSignalTrading,
  "83_sentiment_trading": qs.s83SentimentTrading,
  "84_grid_trading": qs.s84GridTrading,
  "85_martingale_sizing": qs.s85MartingaleSizing,
  "86_kelly_sizing": qs.s86KellySizing,

  // H. Fundamental & Macro (87-94) - need fundamentals/macro feeds
  "87_value_investing": fm.s87ValueInvesting,
  "88_growth_investing": fm.s88GrowthInvesting,
  "89_garp": fm.s89Garp,
  "90_dividend_investing": fm.s90DividendInvesting,
  "91_global_macro_dashboard": fm.s91GlobalMacroDashboard,
  "92_yield_curve_trading": fm.s92YieldCurveTrading,
  "93_commodity_seasonal": fm.s93CommoditySeasonal,
  "94_earnings_announcement_trading": fm.s94EarningsAnnouncementTrading,

  // I. Behavioral, Seasonal & Niche (95-100)
  "95_sell_in_may": sn.s95SellInMay,
  "96_january_effect": sn.s96JanuaryEffect,
  "97_santa_claus_rally": sn.s97SantaClausRally,
  "98_turn_of_month": sn.s98TurnOfMonth,
  "99_insider_institutional_cloning": sn.s99InsiderInstitutionalCloning,
  "100_contrarian_sentiment": sn.s100ContrarianSentiment,
};

/** Strategy number from a key, e.g. `"49_covered_call"` -> 49. */
function keyNumber(key: string): number {
  return parseInt(key, 10);
}

/** Every registered key, ordered by strategy number rather than alphabetically. */
export function listStrategies(): string[] {
  return Object.keys(REGISTRY).sort((a, b) => keyNumber(a) - keyNumber(b));
}

/**
 * Look a strategy up by full key (`"01_ma_crossover"`) or by number (1, `"1"`,
 * `"001"`). Throws rather than returning undefined, so a typo in a config file
 * fails loudly instead of silently producing no signals.
 */
export function getStrategy(keyOrNumber: string | number): StrategyFn {
  if (
    typeof keyOrNumber === "string" &&
    Object.prototype.hasOwnProperty.call(REGISTRY, keyOrNumber)
  ) {
    return REGISTRY[keyOrNumber];
  }
  // `1` and `"1"` both have to find `01_...`, and `100` must not become `1000`.
  const padded = String(keyOrNumber).padStart(2, "0");
  const key = listStrategies().find((k) => k.startsWith(`${padded}_`));
  if (key === undefined) {
    throw new Error(`No strategy found for '${keyOrNumber}'`);
  }
  return REGISTRY[key];
}
