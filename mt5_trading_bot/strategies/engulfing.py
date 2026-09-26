"""
strategies/engulfing.py
-------------------------
100-strategies reference #43: a bullish engulfing candle closes above the
previous candle's high after a down tick; the bearish engulfing mirrors it.
No lookahead -- both candles are already confirmed.
"""

import pandas as pd


def signal(df: pd.DataFrame) -> str:
    if len(df) < 3:
        return "HOLD"

    closes = df["close"].to_numpy()
    opens = df["open"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()

    i = len(df) - 1
    prev_green = closes[i - 1] > opens[i - 1]
    cur_green = closes[i] > opens[i]

    if not prev_green and cur_green:
        if closes[i] > opens[i - 1] and opens[i] < closes[i - 1]:
            return "BUY"
    if prev_green and not cur_green:
        if closes[i] < opens[i - 1] and opens[i] > closes[i - 1]:
            return "SELL"
    return "HOLD"