"""
strategies/round_number_levels.py
-----------------------------------
100-strategies reference #37: psychology-level rejections. Round levels sit
at the 1/100th of the price's leading magnitude (1.2345 -> levels at 0.01
steps; 1234.5 -> 10 steps) plus one level either side. A bar whose wick
touches a level while price had approached it, then closes back through it,
is the rejection entry.
"""

import math

import pandas as pd


def _levels(c: float):
    """A round level below and one above the price."""
    step = 10 ** (math.floor(math.log10(max(abs(c), 1e-12))) - 2)
    base = math.floor(c / step) * step
    return base, base + step


def _near(c: float, level: float, tol: float) -> bool:
    return level - tol <= c <= level + tol


def signal(df: pd.DataFrame, tol_frac: float = 0.0002) -> str:
    if len(df) < 5:
        return "HOLD"

    closes = df["close"].to_numpy()
    lows = df["low"].to_numpy()
    highs = df["high"].to_numpy()

    c = closes[-1]
    c_prev = closes[-2]
    below, above = _levels(c)
    tol = tol_frac * c

    if _near(lows[-1], below, tol) and c > below + tol and c_prev >= c:
        return "BUY"

    if _near(highs[-1], above, tol) and c < above - tol and c_prev <= c:
        return "SELL"

    return "HOLD"