"""
strategies/volatility_squeeze.py
----------------------------------
100-strategies reference #31: when Bollinger bands contract INSIDE the
Keltner channel, volatility is coiling; the bar that releases the squeeze
(with 3-bar momentum confirmation) is the breakout entry.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, bb_period: int = 20, bb_std: float = 2.0,
           kc_period: int = 20, kc_mult: float = 1.5) -> str:
    if len(df) < bb_period + kc_period + 3:
        return "HOLD"

    close = df["close"]
    upper, mid, lower = ind.bollinger_bands(close, bb_period, bb_std)
    atr_series = ind.atr(df, kc_period)
    kc_mid = ind.ema(close, kc_period)
    kc_upper = kc_mid + kc_mult * atr_series
    kc_lower = kc_mid - kc_mult * atr_series

    squeeze_now = (upper.iloc[-1] < kc_upper.iloc[-1]) and (lower.iloc[-1] > kc_lower.iloc[-1])
    squeeze_prev = (upper.iloc[-2] < kc_upper.iloc[-2]) and (lower.iloc[-2] > kc_lower.iloc[-2])

    if not squeeze_now and squeeze_prev:
        mom = close.iloc[-1] - close.iloc[-4]
        if mom > 0:
            return "BUY"
        if mom < 0:
            return "SELL"
    return "HOLD"