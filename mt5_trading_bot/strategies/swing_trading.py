"""
strategies/swing_trading.py
-----------------------------
Multi-day-style swing setup adapted to intraday bars: trades pullbacks
within a broader trend. Requires price above/below a slow EMA (trend
filter) AND a recent pullback to a faster EMA followed by a rejection
candle back in the trend direction.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, trend_ema_period: int = 50, pullback_ema_period: int = 21) -> str:
    if len(df) < trend_ema_period + 2:
        return "HOLD"

    close = df["close"]
    high = df["high"]
    low = df["low"]

    trend_ema = ind.ema(close, trend_ema_period)
    pullback_ema = ind.ema(close, pullback_ema_period)

    last_close = close.iloc[-1]
    prev_close = close.iloc[-2]
    trend_now = trend_ema.iloc[-1]
    pullback_now = pullback_ema.iloc[-1]

    in_uptrend = last_close > trend_now
    in_downtrend = last_close < trend_now

    # Pullback = recent low/high touched the faster EMA, then price closed
    # back beyond it in the trend direction (a simple "rejection" proxy).
    pulled_back_to_ema_from_above = low.iloc[-2] <= pullback_ema.iloc[-2] and last_close > pullback_now
    pulled_back_to_ema_from_below = high.iloc[-2] >= pullback_ema.iloc[-2] and last_close < pullback_now

    if in_uptrend and pulled_back_to_ema_from_above and last_close > prev_close:
        return "BUY"
    if in_downtrend and pulled_back_to_ema_from_below and last_close < prev_close:
        return "SELL"
    return "HOLD"
