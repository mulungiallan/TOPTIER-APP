"""
strategies/williams_r_reversion.py
------------------------------------
100-strategies reference #26: Williams %R lives in 0..-100; a cross back
above -80 from more-oversold is a bounce (BUY), a cross back below -20 from
more-overbought is a pullback (SELL).
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, period: int = 14, low_th: float = -80.0,
           high_th: float = -20.0) -> str:
    if len(df) < period + 3:
        return "HOLD"

    w = ind.williams_r(df, period)
    w_now = w.iloc[-1]
    w_prev = w.iloc[-2]
    if pd.isna(w_now) or pd.isna(w_prev):
        return "HOLD"

    if w_prev < low_th and w_now >= low_th:
        return "BUY"
    if w_prev > high_th and w_now <= high_th:
        return "SELL"
    return "HOLD"