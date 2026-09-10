"""
strategies/pairs_trading.py
---------------------------
Pairs trading (ported from file 9): trades a two-asset spread. Needs TWO price
series (same index) — log-spread z-score vs its rolling window. Returns a dict
with the spread z-score and the direction for each leg:

    signal_a = 1  -> long A / short B
    signal_a = -1 -> short A / long B

Not part of the single-asset STRATEGY_REGISTRY: call it directly with the two
legs' aligned OHLCV DataFrames.
"""

import pandas as pd
import numpy as np


def signal(price_a: pd.Series, price_b: pd.Series, window: int = 30,
           entry_z: float = 2.0, exit_z: float = 0.5) -> dict:
    if len(price_a) < window + 2 or len(price_b) < window + 2:
        return {"direction_a": "HOLD", "direction_b": "HOLD", "zscore": None,
                "spread": None, "valid": False}

    spread = np.log(price_a) - np.log(price_b)
    mean = spread.rolling(window).mean()
    std = spread.rolling(window).std()
    z = (spread - mean) / std.replace(0, pd.NA)

    z_now = z.iloc[-1]
    z_prev = z.iloc[-2]
    direction_a = "HOLD"

    if pd.notna(z_now) and pd.notna(z_prev):
        if z_now > entry_z and z_prev <= entry_z:
            direction_a = "SELL"     # spread too wide -> short A / long B
        elif z_now < -entry_z and z_prev >= -entry_z:
            direction_a = "BUY"      # spread too tight -> long A / short B
        elif abs(z_now or 0) < exit_z:
            direction_a = "HOLD"

    direction_b = {"BUY": "SELL", "SELL": "BUY", "HOLD": "HOLD"}[direction_a]

    return {"direction_a": direction_a, "direction_b": direction_b,
            "zscore": float(z_now) if pd.notna(z_now) else None,
            "spread": float(spread.iloc[-1]) if len(spread) else None,
            "valid": True}