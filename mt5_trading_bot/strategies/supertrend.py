"""
strategies/supertrend.py
--------------------------
100-strategies reference #9: ATR bands around the high/low midpoint that
follow price; when close breaks through a band the trend flips. Fires on the
flip bar only, so it votes once per established trend change instead of
re-singing the same direction every scan.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, period: int = 10, multiplier: float = 3.0) -> str:
    if len(df) < period + 3:
        return "HOLD"

    # Compute on a bounded recent tail: a flip older than this is not a fresh
    # entry signal, and it keeps backtest cost near-linear.
    window = df.iloc[-150:]
    direction = ind.supertrend(window, period, multiplier)
    now = direction.iloc[-1]
    prev = direction.iloc[-2]
    if pd.isna(now) or pd.isna(prev):
        return "HOLD"

    if now == 1 and prev == -1:
        return "BUY"
    if now == -1 and prev == 1:
        return "SELL"
    return "HOLD"