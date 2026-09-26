"""
strategies/head_and_shoulders.py
----------------------------------
100-strategies reference #39: head-and-shoulders topping (and inverse)
pattern. Requires three swing pivots where the middle is the extreme and a
close breaking the neckline that runs from the middle pivot to the last one.
Every pivot is causal (trailing), so the pattern only confirms after the
second shoulder has printed.
"""

import numpy as np
import pandas as pd

import indicators as ind


def signal(df: pd.DataFrame, pivot_window: int = 5, tolerance: float = 0.003) -> str:
    if len(df) < 40:
        return "HOLD"

    closes = df["close"].to_numpy()
    piv_high, piv_low = ind.rolling_pivots(df["close"], pivot_window)
    n = len(closes)

    hp = np.where(piv_high.to_numpy())[0]
    if len(hp) >= 3:
        i1, i2, i3 = hp[-3], hp[-2], hp[-1]
        h1, h2, h3 = closes[i1], closes[i2], closes[i3]
        if h2 > h1 and h2 > h3 and abs(h1 - h3) <= tolerance * max(h1, h3, 1e-9):
            neck = float(np.min(closes[i2:i3 + 1]))
            if closes[-1] < neck:
                return "SELL"

    lp = np.where(piv_low.to_numpy())[0]
    if len(lp) >= 3:
        i1, i2, i3 = lp[-3], lp[-2], lp[-1]
        l1, l2, l3 = closes[i1], closes[i2], closes[i3]
        if l2 < l1 and l2 < l3 and abs(l1 - l3) <= tolerance * max(l1, l3, 1e-9):
            neck = float(np.max(closes[i2:i3 + 1]))
            if closes[-1] > neck:
                return "BUY"

    return "HOLD"