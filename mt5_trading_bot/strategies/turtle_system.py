"""
strategies/turtle_system.py
-----------------------------
100-strategies reference #6 (entry half of the Turtle system): enter long when
price breaks above the prior N-bar high, short below the prior N-bar low
(broken levels are evaluated on the PREVIOUS bar to avoid lookahead). Exits
are an exercise for the backtest's SL/TP ladder.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, entry_period: int = 20) -> str:
    if len(df) < entry_period + 2:
        return "HOLD"

    upper, lower = ind.donchian_channel(df, entry_period)
    close = df["close"]

    u_prev = upper.iloc[-2]
    l_prev = lower.iloc[-2]
    if pd.isna(u_prev) or pd.isna(l_prev):
        return "HOLD"

    if close.iloc[-1] > u_prev:
        return "BUY"
    if close.iloc[-1] < l_prev:
        return "SELL"
    return "HOLD"