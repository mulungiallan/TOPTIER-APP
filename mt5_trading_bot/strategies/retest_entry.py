"""
strategies/retest_entry.py
----------------------------
100-strategies reference #32: after a Donchian(20) breakout, do not chase --
wait for price to pull back within tolerance*ATR of the broken level and
enter on the retest. The state machine replays the window causally and votes
with the position state at the last bar.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, period: int = 20, tolerance_atr_mult: float = 0.3,
           confirm_bars: int = 10) -> str:
    if len(df) < period + 2:
        return "HOLD"

    # Scan a bounded recent tail: the breakout+retest cycle decays within a
    # handful of bars (confirm_bars), and bounding keeps per-call cost flat so
    # the bar-by-bar backtest stays near-linear instead of quadratic.
    window = df.iloc[-120:]
    upper, lower = ind.donchian_channel(window, period)
    a = ind.atr(window, 14)

    closes = window["close"]
    state = None  # ("await_retest_long"/"await_retest_short", level, bars_left)
    position = 0
    n = len(window)
    for i in range(period, n):
        c = closes.iloc[i]
        if state is None and position == 0:
            if c > upper.iloc[i - 1]:
                state = ("await_retest_long", upper.iloc[i - 1], confirm_bars)
            elif c < lower.iloc[i - 1]:
                state = ("await_retest_short", lower.iloc[i - 1], confirm_bars)
        elif state is not None:
            kind, level, bars_left = state
            tol = tolerance_atr_mult * a.iloc[i]
            if kind == "await_retest_long":
                if abs(c - level) <= tol and c > level - tol:
                    position = 1
                    state = None
                elif c < level - tol:
                    state = None
            else:
                if abs(c - level) <= tol and c < level + tol:
                    position = -1
                    state = None
                elif c > level + tol:
                    state = None
            if state is not None:
                bars_left -= 1
                if bars_left <= 0:
                    state = None
        if position != 0:
            break

    if position == 1:
        return "BUY"
    if position == -1:
        return "SELL"
    return "HOLD"