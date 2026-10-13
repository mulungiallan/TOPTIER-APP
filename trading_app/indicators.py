"""
indicators.py
Shared technical-indicator library used by every strategy in the app.
All functions take a pandas DataFrame with columns: open, high, low, close, volume
(lowercase) and a DatetimeIndex, and return a pandas Series or DataFrame aligned
to that index.

Keeping every indicator in one place means each of the 100 strategies just calls
into this module instead of re-implementing math -- one bug fix here fixes it
everywhere.
"""
from __future__ import annotations
import numpy as np
import pandas as pd


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(period, min_periods=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False, min_periods=period).mean()


def roc(series: pd.Series, period: int = 10) -> pd.Series:
    return (series - series.shift(period)) / series.shift(period) * 100.0


def zscore(series: pd.Series, period: int = 20) -> pd.Series:
    m = series.rolling(period).mean()
    s = series.rolling(period).std(ddof=0)
    return (series - m) / s.replace(0, np.nan)


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    tr = true_range(df)
    return tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    macd_line = ema(series, fast) - ema(series, slow)
    signal_line = ema(macd_line, signal)
    hist = macd_line - signal_line
    return pd.DataFrame({"macd": macd_line, "signal": signal_line, "hist": hist})


def bollinger_bands(series: pd.Series, period: int = 20, num_std: float = 2.0):
    mid = sma(series, period)
    std = series.rolling(period).std(ddof=0)
    upper = mid + num_std * std
    lower = mid - num_std * std
    pct_b = (series - lower) / (upper - lower).replace(0, np.nan)
    return pd.DataFrame({"mid": mid, "upper": upper, "lower": lower, "pct_b": pct_b})


def keltner_channels(df: pd.DataFrame, period: int = 20, mult: float = 1.5):
    mid = ema(df["close"], period)
    rng = atr(df, period)
    upper = mid + mult * rng
    lower = mid - mult * rng
    return pd.DataFrame({"mid": mid, "upper": upper, "lower": lower})


def stochastic(df: pd.DataFrame, k_period: int = 14, d_period: int = 3):
    low_n = df["low"].rolling(k_period).min()
    high_n = df["high"].rolling(k_period).max()
    k = (df["close"] - low_n) / (high_n - low_n).replace(0, np.nan) * 100
    d = k.rolling(d_period).mean()
    return pd.DataFrame({"k": k, "d": d})


def williams_r(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high_n = df["high"].rolling(period).max()
    low_n = df["low"].rolling(period).min()
    return (high_n - df["close"]) / (high_n - low_n).replace(0, np.nan) * -100


def cci(df: pd.DataFrame, period: int = 20) -> pd.Series:
    tp = (df["high"] + df["low"] + df["close"]) / 3
    ma = tp.rolling(period).mean()
    md = tp.rolling(period).apply(lambda x: np.mean(np.abs(x - x.mean())), raw=True)
    return (tp - ma) / (0.015 * md.replace(0, np.nan))


def adx(df: pd.DataFrame, period: int = 14):
    up_move = df["high"].diff()
    down_move = -df["low"].diff()
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    tr = true_range(df)
    atr_ = tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    plus_di = 100 * pd.Series(plus_dm, index=df.index).ewm(
        alpha=1 / period, adjust=False, min_periods=period
    ).mean() / atr_.replace(0, np.nan)
    minus_di = 100 * pd.Series(minus_dm, index=df.index).ewm(
        alpha=1 / period, adjust=False, min_periods=period
    ).mean() / atr_.replace(0, np.nan)
    dx = (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan) * 100
    adx_line = dx.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    return pd.DataFrame({"adx": adx_line, "plus_di": plus_di, "minus_di": minus_di})


def donchian_channels(df: pd.DataFrame, period: int = 20):
    upper = df["high"].rolling(period).max()
    lower = df["low"].rolling(period).min()
    mid = (upper + lower) / 2
    return pd.DataFrame({"upper": upper, "lower": lower, "mid": mid})


def parabolic_sar(df: pd.DataFrame, af_start: float = 0.02, af_step: float = 0.02, af_max: float = 0.2) -> pd.Series:
    high, low = df["high"].values, df["low"].values
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
    return pd.Series(sar, index=df.index, name="psar")


def supertrend(df: pd.DataFrame, period: int = 10, multiplier: float = 3.0):
    hl2 = (df["high"] + df["low"]) / 2
    rng = atr(df, period)
    upper_basic = hl2 + multiplier * rng
    lower_basic = hl2 - multiplier * rng
    upper = upper_basic.copy()
    lower = lower_basic.copy()
    close = df["close"]
    for i in range(1, len(df)):
        if close.iloc[i - 1] > upper.iloc[i - 1]:
            upper.iloc[i] = upper_basic.iloc[i]
        else:
            upper.iloc[i] = min(upper_basic.iloc[i], upper.iloc[i - 1])
        if close.iloc[i - 1] < lower.iloc[i - 1]:
            lower.iloc[i] = lower_basic.iloc[i]
        else:
            lower.iloc[i] = max(lower_basic.iloc[i], lower.iloc[i - 1])

    trend = pd.Series(index=df.index, dtype=float)
    direction = pd.Series(index=df.index, dtype=int)
    direction.iloc[0] = 1
    trend.iloc[0] = lower.iloc[0]
    for i in range(1, len(df)):
        if trend.iloc[i - 1] == upper.iloc[i - 1]:
            direction.iloc[i] = -1 if close.iloc[i] <= upper.iloc[i] else 1
        else:
            direction.iloc[i] = 1 if close.iloc[i] >= lower.iloc[i] else -1
        trend.iloc[i] = lower.iloc[i] if direction.iloc[i] == 1 else upper.iloc[i]
    return pd.DataFrame({"supertrend": trend, "direction": direction})


def ichimoku(df: pd.DataFrame, tenkan_p=9, kijun_p=26, senkou_b_p=52, displacement=26):
    tenkan = (df["high"].rolling(tenkan_p).max() + df["low"].rolling(tenkan_p).min()) / 2
    kijun = (df["high"].rolling(kijun_p).max() + df["low"].rolling(kijun_p).min()) / 2
    senkou_a = ((tenkan + kijun) / 2).shift(displacement)
    senkou_b = ((df["high"].rolling(senkou_b_p).max() + df["low"].rolling(senkou_b_p).min()) / 2).shift(displacement)
    chikou = df["close"].shift(-displacement)
    return pd.DataFrame(
        {"tenkan": tenkan, "kijun": kijun, "senkou_a": senkou_a, "senkou_b": senkou_b, "chikou": chikou}
    )


def session_vwap(df: pd.DataFrame) -> pd.Series:
    """Assumes df.index is intraday and resets each calendar day."""
    typical = (df["high"] + df["low"] + df["close"]) / 3
    pv = typical * df["volume"]
    day = df.index.date
    cum_pv = pd.Series(pv).groupby(day).cumsum()
    cum_vol = pd.Series(df["volume"]).groupby(day).cumsum()
    return (cum_pv / cum_vol.replace(0, np.nan)).set_axis(df.index)


def rolling_pivots(series: pd.Series, window: int = 5):
    """
    Simple local extrema (swing highs/lows) detector used by pattern &
    trendline strategies. A point is a pivot high if it's the max within
    +/- window bars, pivot low if it's the min.
    Returns two boolean Series: pivot_high, pivot_low.
    """
    roll_max = series.rolling(window * 2 + 1, center=True).max()
    roll_min = series.rolling(window * 2 + 1, center=True).min()
    pivot_high = series == roll_max
    pivot_low = series == roll_min
    return pivot_high.fillna(False), pivot_low.fillna(False)
