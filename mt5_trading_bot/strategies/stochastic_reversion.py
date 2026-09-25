"""
strategies/stochastic_reversion.py
-----------------------------------
Stochastic oscillator reversion (100-strategies reference #16-20): a %K/%D
cross under 30 signals an oversold bounce (BUY); a cross over 70 signals an
overbought pullback (SELL). A counter-trend vote that offsets the pure trend
strategies inside the consensus system.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, period: int = 14, k_smooth: int = 3, d_smooth: int = 3,
           oversold: float = 30.0, overbought: float = 70.0) -> str:
    if len(df) < period + k_smooth + d_smooth + 2:
        return "HOLD"

    k, d = ind.stochastic(df["close"], df["low"], df["high"], period, k_smooth, d_smooth)

    k_now = k.iloc[-1]
    k_prev = k.iloc[-2]
    d_now = d.iloc[-1]
    d_prev = d.iloc[-2]

    # Bullish cross (%K rises through %D) in oversold territory -> bounce up.
    if k_prev <= d_prev and k_now > d_now and k_now < oversold:
        return "BUY"
    # Bearish cross (%K falls through %D) in overbought territory -> pullback down.
    if k_prev >= d_prev and k_now < d_now and k_now > overbought:
        return "SELL"
    return "HOLD"