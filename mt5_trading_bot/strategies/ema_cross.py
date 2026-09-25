"""
strategies/ema_cross.py
------------------------
Moving-average crossover trend strategy (100-strategies reference #1): when
the fast EMA rises above the slow EMA price is trending up, and vice versa.
A small dead zone prevents flip-flopping while the EMAs are tangled.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, fast_period: int = 10, slow_period: int = 30,
           dead_zone_pct: float = 0.05) -> str:
    if len(df) < slow_period + 2:
        return "HOLD"

    close = df["close"]
    fast = ind.ema(close, fast_period)
    slow = ind.ema(close, slow_period)

    last_fast = fast.iloc[-1]
    last_slow = slow.iloc[-1]
    spread_pct = (last_fast - last_slow) / close.iloc[-1] * 100

    if spread_pct > dead_zone_pct:
        return "BUY"
    if spread_pct < -dead_zone_pct:
        return "SELL"
    return "HOLD"