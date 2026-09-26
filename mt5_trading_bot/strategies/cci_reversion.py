"""
strategies/cci_reversion.py
-----------------------------
100-strategies reference #25: buy when CCI(20) crosses back above -100 from
oversold, sell when it crosses back below +100 from overbought.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, period: int = 20, low_th: float = -100.0,
           high_th: float = 100.0) -> str:
    if len(df) < period + 3:
        return "HOLD"

    c = ind.cci(df, period)
    c_now = c.iloc[-1]
    c_prev = c.iloc[-2]
    if pd.isna(c_now) or pd.isna(c_prev):
        return "HOLD"

    if c_prev < low_th and c_now >= low_th:
        return "BUY"
    if c_prev > high_th and c_now <= high_th:
        return "SELL"
    return "HOLD"