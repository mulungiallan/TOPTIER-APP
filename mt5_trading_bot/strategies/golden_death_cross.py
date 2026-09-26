"""
strategies/golden_death_cross.py
----------------------------------
100-strategies reference #2: the SMA 50/200 golden cross (bullish) and death
cross (bearish). Slow, but the H4/D1 timeframes are exactly where it earns
its keep. Fires only on the cross bar.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, fast: int = 50, slow: int = 200) -> str:
    if len(df) < slow + 3:
        return "HOLD"

    close = df["close"]
    fast_ma = ind.sma(close, fast)
    slow_ma = ind.sma(close, slow)

    f_now, f_prev = fast_ma.iloc[-1], fast_ma.iloc[-2]
    s_now, s_prev = slow_ma.iloc[-1], slow_ma.iloc[-2]
    if not all(pd.notna(v) for v in (f_now, f_prev, s_now, s_prev)):
        return "HOLD"

    if f_prev <= s_prev and f_now > s_now:
        return "BUY"
    if f_prev >= s_prev and f_now < s_now:
        return "SELL"
    return "HOLD"