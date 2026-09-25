"""
strategies/atr_channel_breakout.py
-----------------------------------
ATR/Keltner-channel breakout: a channel is drawn EMA +/- N*ATR around price.
A close outside the channel (sustained for two bars) is a momentum breakout in
that direction. ATR is the market's own volatility, so the channel widens in
wild conditions and tightens in quiet ones -- the breakout is always measured
in terms of the noise the market is currently making.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, ema_period: int = 20, atr_period: int = 14,
           atr_multiplier: float = 2.0, confirmation_bars: int = 2) -> str:
    if len(df) < ema_period + atr_period + confirmation_bars + 2:
        return "HOLD"

    close = df["close"]
    mid = ind.ema(close, ema_period)
    atr_series = ind.atr(df, atr_period)

    upper = mid + atr_multiplier * atr_series
    lower = mid - atr_multiplier * atr_series

    last_idx = len(df) - 1
    conf = min(confirmation_bars, max(last_idx - 1, 1))
    start = last_idx - conf + 1

    if (close.iloc[last_idx] > upper.iloc[last_idx]
            and close.iloc[start - 1] > upper.iloc[start - 1]):
        return "BUY"
    if (close.iloc[last_idx] < lower.iloc[last_idx]
            and close.iloc[start - 1] < lower.iloc[start - 1]):
        return "SELL"
    return "HOLD"