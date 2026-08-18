"""
strategies/momentum.py
-----------------------
Rate-of-change + RSI momentum strategy: buy assets that have been rising
with strengthening RSI, sell assets that have been falling with weakening
RSI. Avoids extreme overbought/oversold zones to dodge immediate reversals.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, roc_period: int = 10, rsi_period: int = 14,
           rsi_overbought: float = 70, rsi_oversold: float = 30) -> str:
    if len(df) < max(roc_period, rsi_period) + 2:
        return "HOLD"

    close = df["close"]
    roc = (close - close.shift(roc_period)) / close.shift(roc_period) * 100
    rsi_series = ind.rsi(close, rsi_period)

    roc_now = roc.iloc[-1]
    rsi_now = rsi_series.iloc[-1]
    rsi_prev = rsi_series.iloc[-2]

    rising_momentum = roc_now > 0 and rsi_now > rsi_prev
    falling_momentum = roc_now < 0 and rsi_now < rsi_prev

    if rising_momentum and rsi_now < rsi_overbought:
        return "BUY"
    if falling_momentum and rsi_now > rsi_oversold:
        return "SELL"
    return "HOLD"
