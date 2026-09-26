"""
strategies/vwap_reversion.py
------------------------------
100-strategies reference #23: trade the mean reversion of price back to the
session VWAP when price stretches further than a threshold (% of VWAP). Fire
on the bar that crosses the threshold, not on every stretched bar.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, dev_threshold_pct: float = 0.5) -> str:
    if len(df) < 30:
        return "HOLD"

    close = df["close"]
    v = ind.vwap(df)

    v_now = v.iloc[-1]
    v_prev = v.iloc[-2]
    if pd.isna(v_now) or pd.isna(v_prev) or v_now <= 0:
        return "HOLD"

    dev_now = (close.iloc[-1] - v_now) / v_now * 100.0
    dev_prev = (close.iloc[-2] - v_prev) / v_prev * 100.0

    if dev_prev < -dev_threshold_pct and dev_now >= -dev_threshold_pct:
        return "BUY"
    if dev_prev > dev_threshold_pct and dev_now <= dev_threshold_pct:
        return "SELL"
    return "HOLD"