"""
strategies/failed_breakout_reversal.py
----------------------------------------
100-strategies reference #33: a Donchian(10) breakout that closes back inside
the range the NEXT bar is a failed breakout -- the opposite move is the
entry. Scanning the window keeps it causal: each trigger can only use data up
to its own bar.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, period: int = 10) -> str:
    if len(df) < period + 3:
        return "HOLD"

    # Bounded tail: only a RECENT failed breakout is a fresh signal, and it
    # keeps the per-call scan near-linear for the bar-by-bar backtest.
    window = df.iloc[-40:]
    upper, lower = ind.donchian_channel(window, period)
    close = window["close"]
    n = len(window)

    for i in range(period + 1, n):
        c_prev = close.iloc[i - 1]
        if c_prev > upper.iloc[i - 2] and close.iloc[i] <= upper.iloc[i - 2]:
            if i == n - 1:
                return "SELL"
            return "HOLD"
        if c_prev < lower.iloc[i - 2] and close.iloc[i] >= lower.iloc[i - 2]:
            if i == n - 1:
                return "BUY"
            return "HOLD"
    return "HOLD"