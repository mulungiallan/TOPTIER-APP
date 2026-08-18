"""
strategies/scalping.py
------------------------
Fast, frequent-signal strategy meant for M1/M5 timeframes on pairs
currently showing real movement (the EXTREME/HIGH volatility buckets --
see volatility_screener.py). Uses a quick EMA crossover plus a momentum
confirmation (price vs a very short lookback) to catch short bursts.
This strategy is intentionally more trigger-happy than the others; it's
matched with a tighter ATR-based stop and a smaller reward:risk ratio
(REWARD_RISK_RATIO_SCALPING in config.py) because it's targeting smaller,
faster moves rather than a multi-hour trend.
"""

import pandas as pd
import indicators as ind


def signal(df: pd.DataFrame, fast_period: int = 5, slow_period: int = 13, confirm_lookback: int = 3) -> str:
    if len(df) < slow_period + confirm_lookback + 2:
        return "HOLD"

    close = df["close"]
    fast_ema = ind.ema(close, fast_period)
    slow_ema = ind.ema(close, slow_period)

    fast_now, fast_prev = fast_ema.iloc[-1], fast_ema.iloc[-2]
    slow_now, slow_prev = slow_ema.iloc[-1], slow_ema.iloc[-2]

    bullish_cross = fast_prev <= slow_prev and fast_now > slow_now
    bearish_cross = fast_prev >= slow_prev and fast_now < slow_now

    # confirmation: price actually moved in that direction over the last
    # few bars, not just a marginal EMA wiggle
    recent_change = close.iloc[-1] - close.iloc[-1 - confirm_lookback]

    if bullish_cross and recent_change > 0:
        return "BUY"
    if bearish_cross and recent_change < 0:
        return "SELL"
    return "HOLD"
