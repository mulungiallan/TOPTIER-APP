"""
strategies/ichimoku.py
-------------------------
100-strategies reference #8: a Tenkan/Kijun cross is only traded when it
happens on the correct side of the cloud -- above = bullish, below =
bearish. Fires only on the cross bar.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, tenkan_p: int = 9, kijun_p: int = 26,
           senkou_b_p: int = 52, displacement: int = 26) -> str:
    if len(df) < senkou_b_p + 3:
        return "HOLD"

    close = df["close"]
    tenkan, kijun, senkou_a, senkou_b = ind.ichimoku(
        df, tenkan_p, kijun_p, senkou_b_p, displacement
    )

    t_now, t_prev = tenkan.iloc[-1], tenkan.iloc[-2]
    k_now, k_prev = kijun.iloc[-1], kijun.iloc[-2]
    if not all(pd.notna(v) for v in (t_now, t_prev, k_now, k_prev)):
        return "HOLD"

    cloud_top = max(senkou_a.iloc[-1], senkou_b.iloc[-1])
    cloud_bottom = min(senkou_a.iloc[-1], senkou_b.iloc[-1])
    last_close = close.iloc[-1]
    if pd.isna(cloud_top):
        return "HOLD"

    if t_prev <= k_prev and t_now > k_now and last_close > cloud_top:
        return "BUY"
    if t_prev >= k_prev and t_now < k_now and last_close < cloud_bottom:
        return "SELL"
    return "HOLD"