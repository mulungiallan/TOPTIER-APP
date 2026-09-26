"""
strategies/three_soldiers_crows.py
------------------------------------
100-strategies reference #48: 3 Advancing White Soldiers / 3 Black Crows,
confirmed by a 4th bar that continues the move. Each of the three candles
must be green (soldiers, near the high) or red (crows, near the low) and open
inside the previous candle's body.
"""

import pandas as pd


def _near_high(c, h, l):
    if h <= l:
        return False
    return c >= l + 0.7 * (h - l)


def _near_low(c, h, l):
    if h <= l:
        return False
    return c <= l + 0.3 * (h - l)


def _deep(closes, opens, highs, lows, i):
    """Three advancing white soldiers ending at bar i-1."""
    j1, j2, j3 = i - 3, i - 2, i - 1
    for j in (j1, j2, j3):
        if closes[j] <= opens[j]:
            return False
        if j > j1 and closes[j] <= closes[j - 1]:
            return False
        if not _near_high(closes[j], highs[j], lows[j]):
            return False
    for j in (j2, j3):
        low_prev, high_prev = min(opens[j - 1], closes[j - 1]), max(opens[j - 1], closes[j - 1])
        if not (low_prev <= opens[j] <= high_prev):
            return False
        if closes[j] <= closes[j - 1]:
            return False
    return True


def _dcrow(closes, opens, highs, lows, i):
    """Three black crows ending at bar i-1."""
    j1, j2, j3 = i - 3, i - 2, i - 1
    for j in (j1, j2, j3):
        if closes[j] >= opens[j]:
            return False
        if j > j1 and closes[j] >= closes[j - 1]:
            return False
        if not _near_low(closes[j], highs[j], lows[j]):
            return False
    for j in (j2, j3):
        low_prev, high_prev = min(opens[j - 1], closes[j - 1]), max(opens[j - 1], closes[j - 1])
        if not (low_prev <= opens[j] <= high_prev):
            return False
        if closes[j] >= closes[j - 1]:
            return False
    return True


def signal(df: pd.DataFrame) -> str:
    if len(df) < 5:
        return "HOLD"

    closes = df["close"].to_numpy()
    opens = df["open"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    i = len(df) - 1

    if _deep(closes, opens, highs, lows, i):
        if closes[i] > closes[i - 1] and closes[i] >= opens[i]:
            return "BUY"
    if _dcrow(closes, opens, highs, lows, i):
        if closes[i] < closes[i - 1] and closes[i] <= opens[i]:
            return "SELL"
    return "HOLD"