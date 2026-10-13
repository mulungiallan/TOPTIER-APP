"""
strategies package
Central registry so the app can look up any of the 100 strategies by number
or name, e.g.:

    from strategies import REGISTRY
    signal = REGISTRY["01_ma_crossover"](df, fast=10, slow=50)

Strategies are grouped by the same categories as the reference doc. Note that
#49-66 (options) and #76 (factor investing needs fundamentals) and #67-75,
87-99 (arb/fundamental/seasonal needing external data) have different call
signatures than the plain price-signal strategies -- check each module's
docstring before wiring it into a generic loop.
"""
from . import trend_momentum as tm
from . import mean_reversion as mr
from . import breakout_range as br
from . import chart_patterns as cp
from . import options_strategies as opt
from . import arbitrage as arb
from . import quant_systematic as qs
from . import fundamental_macro as fm
from . import seasonal_niche as sn

REGISTRY = {
    # A. Trend & Momentum (1-15)
    "01_ma_crossover": tm.s01_ma_crossover,
    "02_golden_death_cross": tm.s02_golden_death_cross,
    "03_macd_crossover": tm.s03_macd_crossover,
    "04_adx_trend_gate": tm.s04_adx_trend_gate,
    "05_donchian_breakout": tm.s05_donchian_breakout,
    "06_turtle_system": tm.s06_turtle_system,
    "07_parabolic_sar": tm.s07_parabolic_sar,
    "08_ichimoku": tm.s08_ichimoku,
    "09_supertrend": tm.s09_supertrend,
    "10_momentum_roc": tm.s10_momentum_roc,
    "11_relative_strength_rotation": tm.s11_relative_strength_rotation,
    "12_new_high_momentum": tm.s12_new_high_momentum,
    "13_dual_momentum": tm.s13_dual_momentum,
    "14_trendline_channel": tm.s14_trendline_channel,
    "15_buy_the_dip": tm.s15_buy_the_dip,

    # B. Mean Reversion / Counter-Trend (16-28)
    "16_rsi_reversion": mr.s16_rsi_reversion,
    "17_connors_rsi2": mr.s17_connors_rsi2,
    "18_bollinger_reversion": mr.s18_bollinger_reversion,
    "19_stochastic_reversion": mr.s19_stochastic_reversion,
    "20_zscore_reversion": mr.s20_zscore_reversion,
    "21_pairs_trading": mr.s21_pairs_trading,
    "22_stat_arb_basket": mr.s22_stat_arb_basket,
    "23_vwap_reversion": mr.s23_vwap_reversion,
    "24_overnight_reversal": mr.s24_overnight_reversal,
    "25_cci_reversion": mr.s25_cci_reversion,
    "26_williams_r_reversion": mr.s26_williams_r_reversion,
    "27_fade_the_gap": mr.s27_fade_the_gap,
    "28_sector_mean_reversion": mr.s28_sector_mean_reversion,

    # C. Breakout & Range (29-38)
    "29_range_breakout": br.s29_range_breakout,
    "30_opening_range_breakout": br.s30_opening_range_breakout,
    "31_volatility_squeeze_breakout": br.s31_volatility_squeeze_breakout,
    "32_retest_entry": br.s32_retest_entry,
    "33_failed_breakout_reversal": br.s33_failed_breakout_reversal,
    "34_support_resistance_bounce": br.s34_support_resistance_bounce,
    "35_triangle_breakout": br.s35_triangle_breakout,
    "36_flag_pennant_continuation": br.s36_flag_pennant_continuation,
    "37_round_number_levels": br.s37_round_number_levels,
    "38_volume_breakout_confirmation": br.s38_volume_breakout_confirmation,

    # D. Chart & Candlestick Patterns (39-48)
    "39_head_and_shoulders": cp.s39_head_and_shoulders,
    "40_double_top_bottom": cp.s40_double_top_bottom,
    "41_cup_and_handle": cp.s41_cup_and_handle,
    "42_wedge_breakout": cp.s42_wedge_breakout,
    "43_engulfing_reversal": cp.s43_engulfing_reversal,
    "44_hammer_shooting_star": cp.s44_hammer_shooting_star,
    "45_doji_confirmation": cp.s45_doji_confirmation,
    "46_morning_evening_star": cp.s46_morning_evening_star,
    "47_inside_bar_breakout": cp.s47_inside_bar_breakout,
    "48_three_soldiers_crows": cp.s48_three_soldiers_crows,

    # E. Options Strategies (49-66) -- return OptionsStrategy objects, not signals
    "49_covered_call": opt.s49_covered_call,
    "50_protective_put": opt.s50_protective_put,
    "51_collar": opt.s51_collar,
    "52_long_call": opt.s52_long_call,
    "53_long_put": opt.s53_long_put,
    "54_bull_call_spread": opt.s54_bull_call_spread,
    "55_bear_put_spread": opt.s55_bear_put_spread,
    "56_bear_call_spread": opt.s56_bear_call_spread,
    "57_bull_put_spread": opt.s57_bull_put_spread,
    "58_iron_condor": opt.s58_iron_condor,
    "59_iron_butterfly": opt.s59_iron_butterfly,
    "60_long_straddle": opt.s60_long_straddle,
    "61_long_strangle": opt.s61_long_strangle,
    "62_short_straddle_strangle": opt.s62_short_straddle_strangle,
    "63_calendar_spread": opt.s63_calendar_spread,
    "64_diagonal_spread": opt.s64_diagonal_spread,
    "65_cash_secured_put": opt.s65_cash_secured_put,
    "66_ratio_spread": opt.s66_ratio_spread,

    # F. Arbitrage & Relative Value (67-75) -- need external data feeds, see arbitrage.py
    "67_merger_arbitrage": arb.s67_merger_arbitrage,
    "68_convertible_bond_arbitrage": arb.s68_convertible_bond_arbitrage,
    "69_index_arbitrage": arb.s69_index_arbitrage,
    "70_triangular_arbitrage": arb.s70_triangular_arbitrage,
    "71_cross_exchange_arbitrage": arb.s71_cross_exchange_arbitrage,
    "72_carry_trade": arb.s72_carry_trade,
    "73_futures_calendar_arbitrage": arb.s73_futures_calendar_arbitrage,
    "74_etf_arbitrage_monitor": arb.s74_etf_arbitrage_monitor,
    "75_volatility_arbitrage": arb.s75_volatility_arbitrage,

    # G. Quant, Systematic & Execution (76-86)
    "76_factor_investing": qs.s76_factor_investing,
    "77_risk_parity": qs.s77_risk_parity,
    "78_market_making": qs.s78_market_making,
    "79_hft_latency_arbitrage": qs.s79_hft_latency_arbitrage_note,
    "80_vwap_execution": qs.s80_vwap_execution,
    "81_twap_execution": qs.s81_twap_execution,
    "82_ml_signal_trading": qs.s82_ml_signal_trading,
    "83_sentiment_trading": qs.s83_sentiment_trading,
    "84_grid_trading": qs.s84_grid_trading,
    "85_martingale_sizing": qs.s85_martingale_sizing,
    "86_kelly_sizing": qs.s86_kelly_sizing,

    # H. Fundamental & Macro (87-94) -- need fundamentals/macro data feeds
    "87_value_investing": fm.s87_value_investing,
    "88_growth_investing": fm.s88_growth_investing,
    "89_garp": fm.s89_garp,
    "90_dividend_investing": fm.s90_dividend_investing,
    "91_global_macro_dashboard": fm.s91_global_macro_dashboard,
    "92_yield_curve_trading": fm.s92_yield_curve_trading,
    "93_commodity_seasonal": fm.s93_commodity_seasonal,
    "94_earnings_announcement_trading": fm.s94_earnings_announcement_trading,

    # I. Behavioral, Seasonal & Niche (95-100)
    "95_sell_in_may": sn.s95_sell_in_may,
    "96_january_effect": sn.s96_january_effect,
    "97_santa_claus_rally": sn.s97_santa_claus_rally,
    "98_turn_of_month": sn.s98_turn_of_month,
    "99_insider_institutional_cloning": sn.s99_insider_institutional_cloning,
    "100_contrarian_sentiment": sn.s100_contrarian_sentiment,
}


def list_strategies():
    """Returns a sorted list of all registered strategy keys."""
    return sorted(REGISTRY.keys(), key=lambda k: int(k.split("_")[0]))


def get_strategy(key_or_number):
    """Look up a strategy by its full key ('01_ma_crossover') or just its
    number (1 or '1')."""
    if key_or_number in REGISTRY:
        return REGISTRY[key_or_number]
    num = str(key_or_number).zfill(2)
    for key in REGISTRY:
        if key.startswith(num + "_") or key.startswith(str(key_or_number) + "_"):
            return REGISTRY[key]
    raise KeyError(f"No strategy found for '{key_or_number}'")
