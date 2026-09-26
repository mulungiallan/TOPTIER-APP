"""
strategies/morning_evening_star.py
------------------------------------
100-strategies reference #46: three-bar reversal.
Morning (BUY): big red body, then a tiny real body, then a green body that
closes above the midpoint of the first candle. Evening (SELL) is the mirror.
"""

import pandas as pd


def signal(df: pd.DataFrame) -> str:
    if len(df) < 4:
        return "HOLD"

    closes = df["close"].to_numpy()
    opens = df["open"].to_numpy()

    i = len(df) - 1
    c1, o1 = closes[i - 2], opens[i - 2]
    c2, o2 = closes[i - 1], opens[i - 1]
    c3, o3 = closes[i], opens[i]

    body1 = c1 - o1       # >0 green, <0 red
    body2 = abs(c2 - o2)
    body3 = c3 - o3

    bearish1 = body1 < 0
    if bearish1:
        size1 = -body1
        if size1 > 0 and body2 <= 0.35 * size1 and body3 > 0 and body3 >= 0.5 * size1:
            if c2 < o1 and c3 > c2:
                return "BUY"
        return "HOLD"

    bullish1 = body1 > 0
    if bullish1:
        size1 = body1
        if body2 <= 0.35 * size1 and body3 < 0 and -body3 >= 0.5 * size1:
            if c2 > o1 and c3 < c2:
                return "SELL"
    return "HOLD"