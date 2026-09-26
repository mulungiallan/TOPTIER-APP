"""
strategies/triangle_wedge_breakout.py
---------------------------------------
100-strategies reference #35/#42: regression lines on the trailing highs and
lows form a contracting triangle when support slopes up while resistance
slopes down. Breakout above the resistance line (BUY) or below the support
line (SELL) is the entry.
"""

import numpy as np
import pandas as pd


def signal(df: pd.DataFrame, regress_bars: int = 40, min_collapse: float = 1e-6) -> str:
    if len(df) < regress_bars + 2:
        return "HOLD"

    highs = df["high"].to_numpy()[-regress_bars:]
    lows = df["low"].to_numpy()[-regress_bars:]
    closes = df["close"].to_numpy()
    x = np.arange(regress_bars).astype(float)

    slope_r, intercept_r = np.polyfit(x, highs, 1)
    slope_s, intercept_s = np.polyfit(x, lows, 1)

    if slope_r < 0 < slope_s and (slope_s - slope_r) > min_collapse:
        res_now = slope_r * (regress_bars - 1) + intercept_r
        sup_now = slope_s * (regress_bars - 1) + intercept_s
        c = closes[-1]
        if c > res_now:
            return "BUY"
        if c < sup_now:
            return "SELL"
    return "HOLD"