"""
Strategies #87-94 -- Fundamental & Macro.
All of these need a fundamentals/macro-data feed (financial statements,
economic releases, earnings calendars) that this library does not fetch
itself -- each function documents the expected input shape so you can wire
in a real data provider (e.g. a financial-data API) as the source.
"""
import numpy as np
import pandas as pd


def s87_value_investing(fundamentals: pd.DataFrame, pe_max=15, pb_max=1.5,
                         debt_equity_max=1.0, margin_of_safety=0.2, price: pd.Series = None,
                         intrinsic_value: pd.Series = None):
    """fundamentals columns: pe, pb, debt_equity (one row per ticker per date)."""
    screen = (fundamentals["pe"] < pe_max) & (fundamentals["pb"] < pb_max) & \
             (fundamentals["debt_equity"] < debt_equity_max)
    if price is not None and intrinsic_value is not None:
        undervalued = price < intrinsic_value * (1 - margin_of_safety)
        return screen & undervalued
    return screen


def s88_growth_investing(fundamentals: pd.DataFrame, eps_growth_min=15.0, revenue_growth_min=10.0):
    """fundamentals columns: eps_growth_yoy_pct, revenue_growth_yoy_pct."""
    return (fundamentals["eps_growth_yoy_pct"] > eps_growth_min) & \
           (fundamentals["revenue_growth_yoy_pct"] > revenue_growth_min)


def s89_garp(fundamentals: pd.DataFrame, peg_max=1.0):
    """fundamentals columns: pe, eps_growth_yoy_pct (used as the growth rate in PEG)."""
    peg = fundamentals["pe"] / fundamentals["eps_growth_yoy_pct"].replace(0, np.nan)
    return peg < peg_max


def s90_dividend_investing(fundamentals: pd.DataFrame, min_yield=2.5, min_years_growth=5,
                            max_payout_ratio=0.6):
    """fundamentals columns: dividend_yield_pct, consecutive_years_dividend_growth, payout_ratio."""
    return (fundamentals["dividend_yield_pct"] > min_yield) & \
           (fundamentals["consecutive_years_dividend_growth"] >= min_years_growth) & \
           (fundamentals["payout_ratio"] < max_payout_ratio)


def s91_global_macro_dashboard(macro_data: pd.DataFrame, surprise_threshold=0.5):
    """
    macro_data columns: actual, consensus (per release, e.g. GDP/CPI/PMI
    releases). Global macro is heavily discretionary in practice -- this
    returns a surprise-magnitude SIGNAL FLAG for a human/discretionary
    overlay rather than an auto-executed position, since the real strategy is
    interpreting *why* the surprise happened.
    """
    surprise = macro_data["actual"] - macro_data["consensus"]
    surprise_z = surprise / surprise.rolling(20).std().replace(0, np.nan)
    flagged = surprise_z.abs() > surprise_threshold
    direction = np.sign(surprise_z)
    return flagged, direction


def s92_yield_curve_trading(short_yield: pd.Series, long_yield: pd.Series, lookback=252, entry_z=1.5):
    import sys, os
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import indicators as ind
    import engines as eng
    spread = long_yield - short_yield
    z = ind.zscore(spread, lookback)
    # z > entry_z: spread unusually wide -> bet on flattening (short the spread)
    # z < -entry_z: spread unusually narrow/inverted -> bet on steepening (long the spread)
    return eng.zscore_signal(z, entry=entry_z, exit=0.0, stop=None) * -1


def s93_commodity_seasonal(price: pd.Series, favorable_start_month=9, favorable_end_month=11):
    """Simple calendar-window strategy: long during the historically
    favorable window, flat otherwise. Backtest per-commodity before trusting
    the window (see README's seasonality validation note)."""
    months = price.index.month
    in_window = (months >= favorable_start_month) & (months <= favorable_end_month) \
        if favorable_start_month <= favorable_end_month else \
        (months >= favorable_start_month) | (months <= favorable_end_month)
    return pd.Series(np.where(in_window, 1, 0), index=price.index)


def s94_earnings_announcement_trading(price: pd.Series, earnings_dates: list,
                                       surprise_pct: pd.Series, drift_hold_days=10,
                                       surprise_threshold=5.0):
    """
    earnings_dates: list of Timestamps when earnings were released.
    surprise_pct: EPS surprise % indexed by earnings date.
    Trades the post-earnings-announcement drift: long after a strong beat,
    short after a strong miss, held for `drift_hold_days`.
    """
    signal = pd.Series(0, index=price.index)
    for d in earnings_dates:
        if d not in surprise_pct.index:
            continue
        surprise = surprise_pct.loc[d]
        if abs(surprise) < surprise_threshold:
            continue
        direction = 1 if surprise > 0 else -1
        window = price.index[(price.index >= d)][:drift_hold_days]
        signal.loc[window] = direction
    return signal
