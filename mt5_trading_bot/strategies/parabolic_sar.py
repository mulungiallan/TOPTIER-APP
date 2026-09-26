"""
strategies/parabolic_sar.py
-----------------------------
100-strategies reference #7: Parabolic SAR trails price with an accelerating
step; when price closes through the SAR the flip is a trend-reversal vote.
Fires only on the flip bar.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, af_start: float = 0.02, af_step: float = 0.02,
           af_max: float = 0.2) -> str:
    if len(df) < 50:
        return "HOLD"

    close = df["close"]
    # Bounded tail keeps the per-call recompute near-linear; a flip older than
    # this window is not a fresh signal anyway.
    window = df.iloc[-200:]
    psar = ind.parabolic_sar(window, af_start, af_step, af_max)

    now = psar.iloc[-1]
    prev = psar.iloc[-2]
    if pd.isna(now) or pd.isna(prev):
        return "HOLD"

    if close.iloc[-2] <= prev and close.iloc[-1] > now:
        return "BUY"
    if close.iloc[-2] >= prev and close.iloc[-1] < now:
        return "SELL"
    return "HOLD"