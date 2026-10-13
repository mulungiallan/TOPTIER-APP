"""Strategies #39-48 -- Chart & Candlestick Patterns.
The actual detection math lives in patterns.py; these wrappers add the
entry/exit convention (fixed target or trailing stop is applied by the
backtester's risk-management layer, not here) and expose the same fn(df,
**params) -> signal interface as every other strategy."""
import pandas as pd
import sys, os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import patterns as pat
import indicators as ind


def s39_head_and_shoulders(df, window=5, tolerance=0.03):
    return pat.head_and_shoulders(df, window, tolerance)


def s40_double_top_bottom(df, window=5, tolerance=0.02):
    return pat.double_top_bottom(df, window, tolerance)


def s41_cup_and_handle(df, cup_window=60, handle_window=15, depth_tol=0.5):
    return pat.cup_and_handle(df, cup_window, handle_window, depth_tol)


def s42_wedge_breakout(df, window=5, lookback=100):
    return pat.triangle_wedge_breakout(df, window, lookback)


def s43_engulfing_reversal(df, trend_ma=50):
    raw = pat.engulfing(df)
    trend_down = df["close"] < ind.sma(df["close"], trend_ma)
    trend_up = df["close"] > ind.sma(df["close"], trend_ma)
    signal = pd.Series(0, index=df.index)
    signal[(raw == 1) & trend_down] = 1   # bullish engulfing at a downtrend/support
    signal[(raw == -1) & trend_up] = -1   # bearish engulfing at an uptrend/resistance
    return signal


def s44_hammer_shooting_star(df, wick_body_ratio=2.0):
    return pat.hammer_shooting_star(df, wick_body_ratio)


def s45_doji_confirmation(df, body_ratio_threshold=0.1):
    is_doji = pat.doji(df, body_ratio_threshold)
    next_bullish = (df["close"].shift(-1) > df["open"].shift(-1))
    next_bearish = (df["close"].shift(-1) < df["open"].shift(-1))
    signal = pd.Series(0, index=df.index)
    # signal fires on the CONFIRMATION bar (i.e. shift back to align with actionable bar)
    confirmed_long = is_doji.shift(1).fillna(False) & (df["close"] > df["open"])
    confirmed_short = is_doji.shift(1).fillna(False) & (df["close"] < df["open"])
    signal[confirmed_long] = 1
    signal[confirmed_short] = -1
    return signal


def s46_morning_evening_star(df):
    return pat.morning_evening_star(df)


def s47_inside_bar_breakout(df):
    return pat.inside_bar_breakout(df)


def s48_three_soldiers_crows(df, volume=None, trend_filter=True, trend_ma=50):
    raw = pat.three_soldiers_crows(df)
    if trend_filter:
        trend_up = df["close"] > ind.sma(df["close"], trend_ma)
        trend_down = df["close"] < ind.sma(df["close"], trend_ma)
        signal = pd.Series(0, index=df.index)
        signal[(raw == 1) & trend_up] = 1
        signal[(raw == -1) & trend_down] = -1
        return signal
    return raw
