"""
strategies/support_resistance_bounce.py
-----------------------------------------
100-strategies reference #34: bounce off the nearest prior swing pivot.
Swing pivots are detected causally (trailing windows), the level nearest the
current close wins, and a bounce between close and level is the entry.
"""

import numpy as np
import pandas as pd

import indicators as ind


def signal(df: pd.DataFrame, pivot_window: int = 5) -> str:
    if len(df) < 30:
        return "HOLD"

    piv_high, piv_low = ind.rolling_pivots(df["close"], pivot_window)
    closes = df["close"].to_numpy()
    c = closes[-1]
    c_prev = closes[-2]

    highs = closes[piv_high.to_numpy()] if piv_high.any() else None
    lows = closes[piv_low.to_numpy()] if piv_low.any() else None

    best_res = None
    best_res_dist = None
    best_sup = None
    best_sup_dist = None

    if highs is not None and len(highs):
        for h in highs:
            if h >= c:
                d = h - c
                if best_res_dist is None or d < best_res_dist:
                    best_res_dist = d
                    best_res = h

    if lows is not None and len(lows):
        for lv in lows:
            if lv <= c:
                d = c - lv
                if best_sup_dist is None or d < best_sup_dist:
                    best_sup_dist = d
                    best_sup = lv

    if best_sup is not None and best_sup_dist is not None:
        near = best_sup_dist <= 0.0015 * c
        if near and c_prev < best_sup and c > best_sup:
            return "BUY"

    if best_res is not None and best_res_dist is not None:
        near = best_res_dist <= 0.0015 * c
        if near and c_prev > best_res and c < best_res:
            return "SELL"

    return "HOLD"