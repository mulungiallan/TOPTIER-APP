"""
strategies/stat_arbitrage.py
----------------------------
Statistical arbitrage (single-asset proxy, ported from file 9): trades the
z-score of price vs its own rolling mean. When price stretches far above the
mean (z > entry_z) it fades short; when it stretches far below (z < -entry_z)
it fades long. Pure mean-reversion in disguise — it is counter-trend, so it
needs the higher-timeframe trend voters (trend_following/momentum) to keep it
from fighting a strong move.
"""

import pandas as pd


def signal(df: pd.DataFrame, window: int = 20, entry_z: float = 2.0,
           exit_z: float = 0.5) -> str:
    if len(df) < window + 2:
        return "HOLD"

    close = df["close"]
    mean = close.rolling(window).mean()
    std = close.rolling(window).std()
    z = (close - mean) / std.replace(0, pd.NA)

    # Only fire on a fresh entry, and stay flat between entry and exit so a
    # stretched z-score doesn't re-signal every bar.
    z_now = z.iloc[-1]
    z_prev = z.iloc[-2]
    if pd.notna(z_now) and pd.notna(z_prev):
        if z_now < -entry_z and z_prev >= -entry_z:
            return "BUY"
        if z_now > entry_z and z_prev <= entry_z:
            return "SELL"
        if pd.notna(z_now) and abs(z_now) < exit_z:
            return "HOLD"
    return "HOLD"