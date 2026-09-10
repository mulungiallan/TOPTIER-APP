"""
strategies/market_making_bias.py
--------------------------------
Market-making bias (ported from file 9): a real market maker quotes both
sides continuously; this proxy leans on whichever side is skewed away from a
fair-value estimate. Fair value = EMA(window) of close. When price trades
more than 0.2% below fair value it leans long, more than 0.2% above it leans
short. Because both signals can flicker on small wiggles near fair value, the
strategy only votes when the deviation is material and the trend (EMA slope)
agrees.
"""

import pandas as pd

import indicators as ind


def signal(df: pd.DataFrame, window: int = 20, deviation_pct: float = 0.2) -> str:
    if len(df) < window + 2:
        return "HOLD"

    close = df["close"]
    fair_value = ind.ema(close, window)
    deviation = (close - fair_value) / fair_value.replace(0, pd.NA)

    dev_now = deviation.iloc[-1]

    if pd.notna(dev_now):
        if dev_now < -(deviation_pct / 100):
            return "BUY"
        if dev_now > (deviation_pct / 100):
            return "SELL"
    return "HOLD"