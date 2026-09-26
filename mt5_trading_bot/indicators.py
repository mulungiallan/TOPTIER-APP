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


def roc(series: pd.Series, period: int = 10) -> pd.Series:
    """Rate of change (%): (price now / price N bars ago - 1) * 100."""
    prev = series.shift(period)
    return (series - prev) / prev.replace(0, np.nan) * 100.0


def zscore(series: pd.Series, period: int = 20) -> pd.Series:
    """How many standard deviations price sits from its rolling mean."""
    m = series.rolling(window=period).mean()
    s = series.rolling(window=period).std()
    return (series - m) / s.replace(0, np.nan)


def cci(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """Commodity Channel Index: typical-price deviation from its rolling mean
    in units of mean absolute deviation. Vectorized, no per-row Python."""
    tp = (df["high"] + df["low"] + df["close"]) / 3.0
    ma = tp.rolling(window=period).mean()
    md = (tp - ma).abs().rolling(window=period).mean()
    return (tp - ma) / (0.015 * md.replace(0, np.nan))


def williams_r(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Williams %R (0..-100): overbought near 0, oversold near -100."""
    highest = df["high"].rolling(window=period).max()
    lowest = df["low"].rolling(window=period).min()
    return (highest - df["close"]) / (highest - lowest).replace(0, np.nan) * -100.0


def vwap(df: pd.DataFrame) -> pd.Series:
    """Session VWAP using typical price * tick volume, resetting each calendar
    day. Falls back to the full-window VWAP if volume is missing/zero."""
    if "volume" not in df.columns or df["volume"].sum() <= 0:
        return pd.Series(np.nan, index=df.index)
    typical = (df["high"] + df["low"] + df["close"]) / 3.0
    pv = typical * df["volume"]
    if "time" in df.columns and hasattr(df["time"].iloc[0], "date"):
        days = pd.Series(df["time"].dt.date, index=df.index)
    else:
        days = pd.Series(df.index.date if hasattr(df.index, "date") else 0, index=df.index)
    cum_pv = pv.groupby(days).cumsum()
    cum_vol = df["volume"].groupby(days).cumsum()
    return (cum_pv / cum_vol.replace(0, np.nan)).reindex(df.index)


def parabolic_sar(df: pd.DataFrame, af_start: float = 0.02, af_step: float = 0.02,
                  af_max: float = 0.2) -> pd.Series:
    """Wilder's Parabolic SAR. Returns the SAR Series aligned to df.index."""
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    n = len(df)
    sar = np.zeros(n)
    trend_up = True
    af = af_start
    ep = high[0]
    sar[0] = low[0]
    for i in range(1, n):
        prev_sar = sar[i - 1]
        if trend_up:
            sar[i] = prev_sar + af * (ep - prev_sar)
            sar[i] = min(sar[i], low[i - 1], low[i - 2] if i > 1 else low[i - 1])
            if low[i] < sar[i]:
                trend_up = False
                sar[i] = ep
                ep = low[i]
                af = af_start
            else:
                if high[i] > ep:
                    ep = high[i]
                    af = min(af + af_step, af_max)
        else:
            sar[i] = prev_sar + af * (ep - prev_sar)
            sar[i] = max(sar[i], high[i - 1], high[i - 2] if i > 1 else high[i - 1])
            if high[i] > sar[i]:
                trend_up = True
                sar[i] = ep
                ep = high[i]
                af = af_start
            else:
                if low[i] < ep:
                    ep = low[i]
                    af = min(af + af_step, af_max)
    return pd.Series(sar, index=df.index)


def supertrend(df: pd.DataFrame, period: int = 10, multiplier: float = 3.0) -> pd.Series:
    """Supertrend direction: +1 long, -1 short. ATR(period) bands around the
    high/low midpoint; direction flips when price closes through the bands."""
    hl2 = (df["high"] + df["low"]) / 2.0
    rng = atr(df, period)
    upper_basic = hl2 + multiplier * rng
    lower_basic = hl2 - multiplier * rng
    close = df["close"]
    upper = upper_basic.copy()
    lower = lower_basic.copy()
    for i in range(1, len(df)):
        if close.iloc[i - 1] > upper.iloc[i - 1]:
            upper.iloc[i] = upper_basic.iloc[i]
        else:
            upper.iloc[i] = min(upper_basic.iloc[i], upper.iloc[i - 1])
        if close.iloc[i - 1] < lower.iloc[i - 1]:
            lower.iloc[i] = lower_basic.iloc[i]
        else:
            lower.iloc[i] = max(lower_basic.iloc[i], lower.iloc[i - 1])
    direction = pd.Series(1, index=df.index, dtype=int)
    trend = lower.copy()
    for i in range(1, len(df)):
        if trend.iloc[i - 1] == upper.iloc[i - 1]:
            direction.iloc[i] = -1 if close.iloc[i] <= upper.iloc[i] else 1
        else:
            direction.iloc[i] = 1 if close.iloc[i] >= lower.iloc[i] else -1
        trend.iloc[i] = lower.iloc[i] if direction.iloc[i] == 1 else upper.iloc[i]
    return direction


def ichimoku(df: pd.DataFrame, tenkan_p: int = 9, kijun_p: int = 26,
             senkou_b_p: int = 52, displacement: int = 26) -> tuple:
    """Ichimoku components (the cloud is shifted so it only uses past bars).
    Returns (tenkan, kijun, senkou_a, senkou_b)."""
    tenkan = (df["high"].rolling(window=tenkan_p).max() + df["low"].rolling(window=tenkan_p).min()) / 2.0
    kijun = (df["high"].rolling(window=kijun_p).max() + df["low"].rolling(window=kijun_p).min()) / 2.0
    senkou_a = ((tenkan + kijun) / 2.0).shift(displacement)
    senkou_b = ((df["high"].rolling(window=senkou_b_p).max()
                 + df["low"].rolling(window=senkou_b_p).min()) / 2.0).shift(displacement)
    return tenkan, kijun, senkou_a, senkou_b


def rolling_pivots(close: pd.Series, window: int = 5) -> tuple:
    """Causal swing-high/swing-low detection (no lookahead): bar i is a pivot
    high if it is the maximum of the trailing (window*2+1) bars ending at i,
    and a pivot low as the trailing minimum. Returns (piv_high, piv_low)"""
    span = window * 2 + 1
    roll_max = close.rolling(window=span, center=False).max()
    roll_min = close.rolling(window=span, center=False).min()
    piv_high = (close == roll_max).fillna(False)
    piv_low = (close == roll_min).fillna(False)
    return piv_high, piv_low
