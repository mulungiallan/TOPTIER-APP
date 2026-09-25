"""
strategies/macd_cross.py
-------------------------
MACD crossover strategy (100-strategies reference #3): MACD = EMA(12)-EMA(26),
signal = EMA(MACD, 9). Trade with the sign and slope of the histogram. The
optional zero-line filter only takes longs while MACD > 0 and shorts while
MACD < 0, cutting the false signals that fire in flattish markets.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, fast_period: int = 12, slow_period: int = 26,
           signal_period: int = 9, zero_filter: bool = False) -> str:
    if len(df) < slow_period + signal_period + 2:
        return "HOLD"

    close = df["close"]
    macd = ind.ema(close, fast_period) - ind.ema(close, slow_period)
    signal_line = ind.ema(macd, signal_period)
    hist = macd - signal_line

    hist_now = hist.iloc[-1]
    hist_prev = hist.iloc[-2]

    if zero_filter:
        if hist_now > 0 and hist_prev > 0:
            return "BUY"
        if hist_now < 0 and hist_prev < 0:
            return "SELL"
    else:
        if hist_now > 0 and hist_now > hist_prev:
            return "BUY"
        if hist_now < 0 and hist_now < hist_prev:
            return "SELL"
    return "HOLD"