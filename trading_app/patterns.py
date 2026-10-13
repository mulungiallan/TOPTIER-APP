"""
patterns.py
Candlestick pattern detectors (pure OHLC math, exact) and chart-pattern
detectors (built on pivot-point detection, approximate/tolerance-based).
Covers strategies #39-48.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
import indicators as ind


def _body(df):
    return (df["close"] - df["open"]).abs()


def _upper_wick(df):
    return df["high"] - df[["open", "close"]].max(axis=1)


def _lower_wick(df):
    return df[["open", "close"]].min(axis=1) - df["low"]


def _range(df):
    return (df["high"] - df["low"]).replace(0, np.nan)


# --- Single/two-candle patterns (#43, #44, #45, #47) -----------------------
def engulfing(df: pd.DataFrame) -> pd.Series:
    """+1 bullish engulfing, -1 bearish engulfing, 0 none."""
    prev_open, prev_close = df["open"].shift(1), df["close"].shift(1)
    bullish = (df["close"] > df["open"]) & (prev_close < prev_open) & \
              (df["close"] >= prev_open) & (df["open"] <= prev_close) & (_body(df) > _body(df).shift(1))
    bearish = (df["close"] < df["open"]) & (prev_close > prev_open) & \
              (df["open"] >= prev_close) & (df["close"] <= prev_open) & (_body(df) > _body(df).shift(1))
    out = pd.Series(0, index=df.index)
    out[bullish] = 1
    out[bearish] = -1
    return out


def hammer_shooting_star(df: pd.DataFrame, wick_body_ratio: float = 2.0) -> pd.Series:
    """+1 hammer (bullish reversal), -1 shooting star (bearish reversal)."""
    body = _body(df).replace(0, 1e-9)
    lower = _lower_wick(df)
    upper = _upper_wick(df)
    hammer = (lower > wick_body_ratio * body) & (upper < body)
    star = (upper > wick_body_ratio * body) & (lower < body)
    out = pd.Series(0, index=df.index)
    out[hammer] = 1
    out[star] = -1
    return out


def doji(df: pd.DataFrame, body_ratio_threshold: float = 0.1) -> pd.Series:
    """True where the candle is a doji (indecision) -- direction comes from
    the NEXT candle's confirmation, handled by the strategy layer."""
    return (_body(df) / _range(df)) < body_ratio_threshold


def morning_evening_star(df: pd.DataFrame) -> pd.Series:
    """+1 morning star (bottom reversal), -1 evening star (top reversal).
    3-candle sequence: strong move, small indecision candle, strong reverse move."""
    b0, b1, b2 = _body(df).shift(2), _body(df).shift(1), _body(df)
    c0, c2 = df["close"].shift(2), df["close"]
    o0, o2 = df["open"].shift(2), df["open"]
    down_first = c0 < o0
    up_first = c0 > o0
    small_middle = b1 < (b0 * 0.5)
    strong_last_up = (c2 > o2) & (b2 > b0 * 0.5) & (c2 > (o0 + c0) / 2)
    strong_last_down = (c2 < o2) & (b2 > b0 * 0.5) & (c2 < (o0 + c0) / 2)
    morning = down_first & small_middle & strong_last_up
    evening = up_first & small_middle & strong_last_down
    out = pd.Series(0, index=df.index)
    out[morning] = 1
    out[evening] = -1
    return out


def inside_bar(df: pd.DataFrame) -> pd.Series:
    """True where the current bar's range is fully inside the prior bar's range."""
    return (df["high"] < df["high"].shift(1)) & (df["low"] > df["low"].shift(1))


def inside_bar_breakout(df: pd.DataFrame) -> pd.Series:
    ib = inside_bar(df)
    mother_high = df["high"].shift(1).where(ib)
    mother_low = df["low"].shift(1).where(ib)
    mother_high = mother_high.ffill()
    mother_low = mother_low.ffill()
    long_break = (df["close"] > mother_high) & ib.shift(1).fillna(False)
    short_break = (df["close"] < mother_low) & ib.shift(1).fillna(False)
    out = pd.Series(0, index=df.index)
    out[long_break] = 1
    out[short_break] = -1
    return out


def three_soldiers_crows(df: pd.DataFrame) -> pd.Series:
    """+1 three white soldiers, -1 three black crows."""
    up = df["close"] > df["open"]
    down = df["close"] < df["open"]
    higher_close = df["close"] > df["close"].shift(1)
    lower_close = df["close"] < df["close"].shift(1)
    soldiers = up & up.shift(1) & up.shift(2) & higher_close & higher_close.shift(1)
    crows = down & down.shift(1) & down.shift(2) & lower_close & lower_close.shift(1)
    out = pd.Series(0, index=df.index)
    out[soldiers.fillna(False)] = 1
    out[crows.fillna(False)] = -1
    return out


# --- Pivot-based chart patterns (#39, #40, #42) -----------------------------
def double_top_bottom(df: pd.DataFrame, window: int = 5, tolerance: float = 0.02) -> pd.Series:
    """
    +1 signal (long) on confirmed double-bottom neckline break,
    -1 signal (short) on confirmed double-top neckline break.
    Approximate detector using pivot highs/lows within a similarity tolerance.
    """
    piv_high, piv_low = ind.rolling_pivots(df["close"], window)
    highs = df["close"].where(piv_high)
    lows = df["close"].where(piv_low)

    out = pd.Series(0, index=df.index)
    high_points = highs.dropna()
    low_points = lows.dropna()

    for i in range(1, len(high_points)):
        p1, p2 = high_points.iloc[i - 1], high_points.iloc[i]
        if abs(p1 - p2) / p1 < tolerance:
            idx2 = high_points.index[i]
            trough_between = df["close"].loc[high_points.index[i - 1]:idx2].min()
            confirm_idx = df.index[(df.index > idx2) & (df["close"] < trough_between)]
            if len(confirm_idx):
                out.loc[confirm_idx[0]] = -1

    for i in range(1, len(low_points)):
        p1, p2 = low_points.iloc[i - 1], low_points.iloc[i]
        if abs(p1 - p2) / p1 < tolerance:
            idx2 = low_points.index[i]
            peak_between = df["close"].loc[low_points.index[i - 1]:idx2].max()
            confirm_idx = df.index[(df.index > idx2) & (df["close"] > peak_between)]
            if len(confirm_idx):
                out.loc[confirm_idx[0]] = 1
    return out


def head_and_shoulders(df: pd.DataFrame, window: int = 5, tolerance: float = 0.03) -> pd.Series:
    """
    Simplified detector: finds 3 consecutive pivot highs where the middle one
    (head) is higher than both shoulders, and shoulders are roughly similar
    height. Signals -1 (short) on neckline break; inverse (+1) mirrors it on
    pivot lows.
    """
    piv_high, piv_low = ind.rolling_pivots(df["close"], window)
    out = pd.Series(0, index=df.index)
    highs = df["close"].where(piv_high).dropna()
    lows = df["close"].where(piv_low).dropna()

    for i in range(2, len(highs)):
        ls, head, rs = highs.iloc[i - 2], highs.iloc[i - 1], highs.iloc[i]
        if head > ls and head > rs and abs(ls - rs) / ls < tolerance:
            neckline = df["close"].loc[highs.index[i - 2]:highs.index[i]].min()
            confirm_idx = df.index[(df.index > highs.index[i]) & (df["close"] < neckline)]
            if len(confirm_idx):
                out.loc[confirm_idx[0]] = -1

    for i in range(2, len(lows)):
        ls, head, rs = lows.iloc[i - 2], lows.iloc[i - 1], lows.iloc[i]
        if head < ls and head < rs and abs(ls - rs) / ls < tolerance:
            neckline = df["close"].loc[lows.index[i - 2]:lows.index[i]].max()
            confirm_idx = df.index[(df.index > lows.index[i]) & (df["close"] > neckline)]
            if len(confirm_idx):
                out.loc[confirm_idx[0]] = 1
    return out


def trendline_from_pivots(df: pd.DataFrame, use_highs: bool, window: int = 5, lookback: int = 100):
    """
    Fits a linear trendline (least squares) through the most recent pivot
    highs (resistance) or pivot lows (support) within `lookback` bars.
    Used by wedge/triangle/channel strategies (#14, #35, #42).
    Returns a Series projecting the trendline value at every bar (NaN where
    not enough pivots exist yet).
    """
    piv_high, piv_low = ind.rolling_pivots(df["close"], window)
    mask = piv_high if use_highs else piv_low
    points = df["close"].where(mask).dropna()
    line = pd.Series(np.nan, index=df.index)
    x_all = np.arange(len(df))
    for i in range(len(df)):
        recent = points[(points.index <= df.index[i])].tail(lookback)
        recent = recent[recent.index >= df.index[max(0, i - lookback)]]
        if len(recent) >= 2:
            xs = np.array([df.index.get_loc(t) for t in recent.index])
            ys = recent.values
            slope, intercept = np.polyfit(xs, ys, 1)
            line.iloc[i] = slope * x_all[i] + intercept
    return line


def triangle_wedge_breakout(df: pd.DataFrame, window: int = 5, lookback: int = 100) -> pd.Series:
    """+1 on breakout above the resistance trendline, -1 on breakdown below
    the support trendline. Covers #35 (triangles) and #42 (wedges) -- the
    same converging-trendline geometry underlies both."""
    resistance = trendline_from_pivots(df, use_highs=True, window=window, lookback=lookback)
    support = trendline_from_pivots(df, use_highs=False, window=window, lookback=lookback)
    long_e = df["close"] > resistance
    short_e = df["close"] < support
    out = pd.Series(np.nan, index=df.index)
    out[long_e] = 1
    out[short_e] = -1
    return out.ffill().fillna(0)


def cup_and_handle(df: pd.DataFrame, cup_window: int = 60, handle_window: int = 15, depth_tol: float = 0.5) -> pd.Series:
    """
    Simplified detector: looks for a rounded U-shaped decline-then-recovery
    (cup) over `cup_window` bars back to near the starting price, followed by
    a shallow pullback (handle) over `handle_window` bars, then a breakout
    above the cup's starting high.
    """
    out = pd.Series(0, index=df.index)
    close = df["close"]
    for i in range(cup_window + handle_window, len(df)):
        cup_slice = close.iloc[i - cup_window - handle_window: i - handle_window]
        handle_slice = close.iloc[i - handle_window: i]
        if len(cup_slice) < cup_window:
            continue
        cup_start, cup_end = cup_slice.iloc[0], cup_slice.iloc[-1]
        cup_min = cup_slice.min()
        cup_depth = cup_start - cup_min
        if cup_depth <= 0:
            continue
        recovered = abs(cup_end - cup_start) / cup_start < 0.05
        handle_depth = handle_slice.iloc[0] - handle_slice.min()
        shallow_handle = handle_depth < cup_depth * depth_tol
        breakout = close.iloc[i] > cup_start
        if recovered and shallow_handle and breakout:
            out.iloc[i] = 1
    return out
