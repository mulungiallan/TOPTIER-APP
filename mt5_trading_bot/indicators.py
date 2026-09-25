"""
indicators.py
-------------
Plain pandas/numpy implementations of the indicators the strategies need.
No external TA library required, so the bot has fewer dependencies to break.
"""

import pandas as pd
import numpy as np


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(window=period).mean()


def bollinger_bands(series: pd.Series, period: int = 20, num_std: float = 2.0):
    mid = sma(series, period)
    std = series.rolling(window=period).std()
    upper = mid + num_std * std
    lower = mid - num_std * std
    return upper, mid, lower


def donchian_channel(df: pd.DataFrame, period: int = 20):
    upper = df["high"].rolling(window=period).max()
    lower = df["low"].rolling(window=period).min()
    return upper, lower


def adx(df: pd.DataFrame, period: int = 14) -> tuple:
    """Wilder's ADX + directional indicators. Returns (adx, plus_di, minus_di)."""
    high, low, close = df["high"], df["low"], df["close"]

    up_move = high.diff()
    down_move = low.diff()
    plus_dm = up_move.where((up_move > -down_move) & (up_move > 0), 0.0)
    minus_dm = (-down_move).where((-down_move > up_move) & (-down_move > 0), 0.0)

    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)

    alpha = 1.0 / period
    tr_smoothed = tr.ewm(alpha=alpha, min_periods=period).mean()
    plus_dm_smoothed = plus_dm.ewm(alpha=alpha, min_periods=period).mean()
    minus_dm_smoothed = minus_dm.ewm(alpha=alpha, min_periods=period).mean()

    plus_di = 100 * plus_dm_smoothed / tr_smoothed.replace(0, np.nan)
    minus_di = 100 * minus_dm_smoothed / tr_smoothed.replace(0, np.nan)

    di_sum = (plus_di + minus_di).replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / di_sum
    adx_series = dx.ewm(alpha=alpha, min_periods=period).mean()
    return adx_series, plus_di, minus_di


def stochastic(close: pd.Series, low: pd.Series, high: pd.Series,
               period: int = 14, k_smooth: int = 3, d_smooth: int = 3) -> tuple:
    """Standard stochastic oscillator. Returns (%K, %D) as (k, d)."""
    lowest = low.rolling(window=period).min()
    highest = high.rolling(window=period).max()
    rng = (highest - lowest).replace(0, np.nan)
    k_raw = (close - lowest) / rng * 100
    k = k_raw.rolling(window=k_smooth).mean()
    d = k.rolling(window=d_smooth).mean()
    return k, d
