"""
strategies/buy_the_dip.py
---------------------------
100-strategies reference #15: in an established uptrend (close above the
200 SMA), buy when RSI(14) dips under 40 and starts recovering. Counter-trend
entry confirmed by a long-horizon trend filter.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, trend_ma: int = 200, rsi_period: int = 14,
           rsi_dip: float = 40.0) -> str:
    if len(df) < trend_ma + 3:
        return "HOLD"

    close = df["close"]
    trend = ind.sma(close, trend_ma)
    r = ind.rsi(close, rsi_period)

    r_now = r.iloc[-1]
    r_prev = r.iloc[-2]
    if pd.isna(r_now) or pd.isna(r_prev) or pd.isna(trend.iloc[-1]):
        return "HOLD"

    if close.iloc[-1] > trend.iloc[-1] and r_now < rsi_dip and r_now > r_prev:
        return "BUY"
    return "HOLD"