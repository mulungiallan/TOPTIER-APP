"""
strategies/trend_following.py
------------------------------
Classic trend-following: fast/slow moving average crossover, confirmed by
a Donchian channel breakout. Goes long in established uptrends, short in
established downtrends, flat/sideways otherwise.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, fast_period: int = 20, slow_period: int = 50, breakout_period: int = 20) -> str:
    """Return 'BUY', 'SELL', or 'HOLD' for the most recently closed bar."""
    if len(df) < slow_period + 2:
        return "HOLD"

    fast_ma = ind.sma(df["close"], fast_period)
    slow_ma = ind.sma(df["close"], slow_period)
    donchian_high, donchian_low = ind.donchian_channel(df, breakout_period)

    last_close = df["close"].iloc[-1]
    fast_now, fast_prev = fast_ma.iloc[-1], fast_ma.iloc[-2]
    slow_now, slow_prev = slow_ma.iloc[-1], slow_ma.iloc[-2]

    bullish_cross = fast_prev <= slow_prev and fast_now > slow_now
    bearish_cross = fast_prev >= slow_prev and fast_now < slow_now

    breakout_up = last_close >= donchian_high.iloc[-2]   # breaking prior channel high
    breakout_down = last_close <= donchian_low.iloc[-2]   # breaking prior channel low

    uptrend = fast_now > slow_now
    downtrend = fast_now < slow_now

    if (bullish_cross or breakout_up) and uptrend:
        return "BUY"
    if (bearish_cross or breakout_down) and downtrend:
        return "SELL"
    return "HOLD"
