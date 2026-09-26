"""
strategies/connors_rsi2.py
----------------------------
100-strategies reference #17 (Connors RSI-2 entry): with price above the 200
SMA, buy the dip when the 2-period RSI crosses back above 10. Mirrors short
below the 200 SMA. Requires a LOT of history by design (200+ bars).
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, rsi_period: int = 2, buy_th: float = 10.0,
           sell_th: float = 90.0, trend_ma: int = 200) -> str:
    if len(df) < trend_ma + 3:
        return "HOLD"

    close = df["close"]
    r = ind.rsi(close, rsi_period)
    trend = ind.sma(close, trend_ma)

    r_now = r.iloc[-1]
    r_prev = r.iloc[-2]
    trend_now = trend.iloc[-1]
    if pd.isna(r_now) or pd.isna(r_prev) or pd.isna(trend_now):
        return "HOLD"

    if close.iloc[-1] > trend_now and r_prev < buy_th and r_now >= buy_th:
        return "BUY"
    if close.iloc[-1] < trend_now and r_prev > sell_th and r_now <= sell_th:
        return "SELL"
    return "HOLD"