"""
strategies/adx_trend.py
------------------------
ADX trend-strength filter strategy (100-strategies reference #4): only trade
the direction of the stronger directional indicator (+DI vs -DI) once ADX
confirms the market is genuinely trending. Below the ADX threshold the market
is ranging, so the strategy stays flat rather than churning trend trades.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, period: int = 14, adx_threshold: float = 20.0) -> str:
    if len(df) < period * 3 + 2:
        return "HOLD"

    adx_series, plus_di, minus_di = ind.adx(df, period)

    adx_now = adx_series.iloc[-1]
    if pd.isna(adx_now) or adx_now < adx_threshold:
        return "HOLD"

    plus_now = plus_di.iloc[-1]
    minus_now = minus_di.iloc[-1]

    if plus_now > minus_now:
        return "BUY"
    if minus_now > plus_now:
        return "SELL"
    return "HOLD"