"""
strategies/double_top_bottom.py
---------------------------------
100-strategies reference #40: a double top / bottom forms after a swing high
(P1)/low (P1) retest (P2). The pattern completes when close breaks the
swing-low/neck that separates the two tops. All pivots are causal (trailing),
so the pattern is only confirmable after the second top has printed.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, pivot_window: int = 5, neck_back: int = 20) -> str:
    if len(df) < 40:
        return "HOLD"

    closes = df["close"].to_numpy()
    piv_high, piv_low = ind.rolling_pivots(df["close"], pivot_window)
    ph = closes[piv_high.to_numpy()]
    pl = closes[piv_low.to_numpy()]

    if len(ph) >= 2:
        h1, h2 = ph[-2], ph[-1]
        if h2 > h1:
            h1, h2 = h2, h1
        sep_ok = h2 <= h1 * 1.002 and h2 >= h1 * 0.998
        n = len(closes)
        if sep_ok:
            neck = min(df["close"].iloc[n - neck_back:n].to_numpy()) if neck_back < n else closes.min()
            if closes[-1] < neck:
                return "SELL"

    if len(pl) >= 2:
        l1, l2 = pl[-2], pl[-1]
        if l2 < l1:
            l1, l2 = l2, l1
        sep_ok = l2 <= l1 * 1.002 and l2 >= l1 * 0.998
        n = len(closes)
        if sep_ok:
            neck = max(df["close"].iloc[n - neck_back:n].to_numpy()) if neck_back < n else closes.max()
            if closes[-1] > neck:
                return "BUY"

    return "HOLD"