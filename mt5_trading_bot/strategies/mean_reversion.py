"""
strategies/mean_reversion.py
-----------------------------
Bollinger Band mean-reversion: when price stretches beyond a band and RSI
confirms an extreme reading, bet on a snap-back toward the mean. This is
a counter-trend strategy by design, so it is the natural hedge against
trend_following/momentum inside the voting system.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, bb_period: int = 20, bb_std: float = 2.0,
           rsi_period: int = 14, rsi_extreme_low: float = 30, rsi_extreme_high: float = 70) -> str:
    if len(df) < bb_period + 2:
        return "HOLD"

    close = df["close"]
    upper, mid, lower = ind.bollinger_bands(close, bb_period, bb_std)
    rsi_series = ind.rsi(close, rsi_period)

    last_close = close.iloc[-1]
    rsi_now = rsi_series.iloc[-1]

    touched_lower_band = last_close <= lower.iloc[-1]
    touched_upper_band = last_close >= upper.iloc[-1]

    if touched_lower_band and rsi_now < rsi_extreme_low:
        return "BUY"   # oversold + below band -> expect bounce up
    if touched_upper_band and rsi_now > rsi_extreme_high:
        return "SELL"  # overbought + above band -> expect pullback down
    return "HOLD"
