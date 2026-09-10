"""
strategies/breakout.py
----------------------
Breakout trading (ported from file 9): price breaking above the prior
N-period high is a long, breaking below the prior N-period low is a short.
Uses the SHIFTED channel (previous window only), so a bar can't "break out"
of a channel that already includes its own high/low.
"""

import pandas as pd


def signal(df: pd.DataFrame, window: int = 20, confirmation_bars: int = 0) -> str:
    if len(df) < window + 2:
        return "HOLD"

    high = df["high"]
    low = df["low"]
    close = df["close"]

    prior_high = high.rolling(window).max().shift(1)
    prior_low = low.rolling(window).min().shift(1)

    # A small holding lag makes the signal persist through the breakout bar so
    # the combined voter doesn't drop the vote immediately after entry.
    lag = min(confirmation_bars, max(len(df) - window - 2, 0))
    last_idx = len(df) - 1 - lag

    c = close.iloc[last_idx]
    ph = prior_high.iloc[last_idx]
    pl = prior_low.iloc[last_idx]

    if pd.notna(c) and pd.notna(ph) and pd.notna(pl):
        if c > ph:
            return "BUY"
        if c < pl:
            return "SELL"
    return "HOLD"