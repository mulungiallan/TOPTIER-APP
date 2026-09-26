"""
strategies/inside_bar_breakout.py
-----------------------------------
100-strategies reference #47: an inside bar (high <= prev high, low >= prev
low, smaller range) is consolidation; the close beyond the inside bar's range
is the breakout entry.
"""

import pandas as pd


def signal(df: pd.DataFrame) -> str:
    if len(df) < 3:
        return "HOLD"

    closes = df["close"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()

    i = len(df) - 1
    prev_rng = highs[i - 1] - lows[i - 1]
    if prev_rng <= 0:
        return "HOLD"
    inside = highs[i] <= highs[i - 1] and lows[i] >= lows[i - 1]
    shape = (highs[i] - lows[i]) <= prev_rng
    if not inside or not shape:
        return "HOLD"

    c = closes[i]
    if c > highs[i]:
        return "BUY"
    if c < lows[i]:
        return "SELL"
    return "HOLD"