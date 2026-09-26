"""
strategies/hammer_shooting_star.py
------------------------------------
100-strategies reference #44: hammer = long lower wick in a down move with a
close near the high; shooting star = long upper wick in an up move with a
close near the low. Wicks measured in body lengths, completely positional.
"""

import pandas as pd


def signal(df: pd.DataFrame, min_ratio: float = 2.0) -> str:
    if len(df) < 4:
        return "HOLD"

    closes = df["close"].to_numpy()
    opens = df["open"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()

    i = len(df) - 1
    c, o, h, l = closes[i], opens[i], highs[i], lows[i]
    body = abs(c - o)
    if body <= 0:
        return "HOLD"
    lower_wick = min(c, o) - l
    upper_wick = h - max(c, o)
    rng = h - l
    if rng <= 0:
        return "HOLD"

    down_move = closes[i - 1] < closes[i - 2]

    if down_move and lower_wick >= min_ratio * body and upper_wick <= 0.5 * body:
        pullback = c >= o
        if pullback:
            return "BUY"

    up_move = closes[i - 1] > closes[i - 2]

    if up_move and upper_wick >= min_ratio * body and lower_wick <= 0.5 * body:
        pullback = c <= o
        if pullback:
            return "SELL"

    return "HOLD"