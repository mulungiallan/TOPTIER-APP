"""
strategies/rsi_reversion.py
-----------------------------
100-strategies reference #16: buy when RSI(14) crosses back above 30 from
oversold, sell when it crosses back below 70 from overbought.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, period: int = 14, low_th: float = 30.0,
           high_th: float = 70.0) -> str:
    if len(df) < period + 3:
        return "HOLD"

    r = ind.rsi(df["close"], period)
    r_now = r.iloc[-1]
    r_prev = r.iloc[-2]
    if pd.isna(r_now) or pd.isna(r_prev):
        return "HOLD"

    if r_prev < low_th and r_now >= low_th:
        return "BUY"
    if r_prev > high_th and r_now <= high_th:
        return "SELL"
    return "HOLD"