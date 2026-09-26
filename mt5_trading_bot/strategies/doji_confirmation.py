"""
strategies/doji_confirmation.py
---------------------------------
100-strategies reference #45: a doji (tiny body, big range) marks indecision;
the bar that confirms the breakout of the doji's range is the trade.
"""

import pandas as pd


def signal(df: pd.DataFrame, doji_body_frac: float = 0.1) -> str:
    if len(df) < 4:
        return "HOLD"

    closes = df["close"].to_numpy()
    opens = df["open"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()

    i = len(df) - 1
    d_c, d_o, d_h, d_l = closes[i - 1], opens[i - 1], highs[i - 1], lows[i - 1]
    d_range = d_h - d_l
    if d_range <= 0 or abs(d_c - d_o) > doji_body_frac * d_range:
        return "HOLD"

    c = closes[i]
    if c > d_h:
        return "BUY"
    if c < d_l:
        return "SELL"
    return "HOLD"