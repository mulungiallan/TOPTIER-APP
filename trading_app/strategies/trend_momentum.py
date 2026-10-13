"""Strategies #1-15 -- Trend & Momentum. Each function returns a pd.Series of
signals (1/-1/0) aligned to df.index. Every function shares the same
signature: fn(df: pd.DataFrame, **params) -> pd.Series so the registry and
backtester can call any of them identically."""
import numpy as np
import pandas as pd
import sys, os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import indicators as ind
import engines as eng
import patterns as pat


def s01_ma_crossover(df, fast=10, slow=50, ma_type="sma"):
    f = ind.ema(df["close"], fast) if ma_type == "ema" else ind.sma(df["close"], fast)
    s = ind.ema(df["close"], slow) if ma_type == "ema" else ind.sma(df["close"], slow)
    return eng.crossover_signal(f, s)


def s02_golden_death_cross(df, fast=50, slow=200):
    return s01_ma_crossover(df, fast=fast, slow=slow, ma_type="sma")


def s03_macd_crossover(df, fast=12, slow=26, signal=9, zero_line_filter=False):
    m = ind.macd(df["close"], fast, slow, signal)
    sig = eng.crossover_signal(m["macd"], m["signal"])
    if zero_line_filter:
        sig = sig.where(~((sig == 1) & (m["macd"] < 0)), 0)
        sig = sig.where(~((sig == -1) & (m["macd"] > 0)), 0)
    return sig


def s04_adx_trend_gate(df, period=14, threshold=25):
    """Filter-only: returns +1/-1/0 direction wherever ADX confirms a trend,
    intended to be multiplied against another strategy's raw signal."""
    is_trending, direction = eng.trend_filter_adx(df, period, threshold)
    return direction.where(is_trending, 0)


def s05_donchian_breakout(df, period=20):
    dc = ind.donchian_channels(df, period)
    return eng.band_breakout_signal(df["close"], dc["upper"], dc["lower"])


def s06_turtle_system(df, entry_period=20, exit_period=10, atr_period=20,
                       account_equity=100_000, risk_pct=0.01):
    """Returns (signal, position_size) -- Turtle needs both entry logic AND
    ATR-based sizing to be faithfully implemented."""
    entry_ch = ind.donchian_channels(df, entry_period)
    exit_ch = ind.donchian_channels(df, exit_period)
    n = ind.atr(df, atr_period)

    signal = pd.Series(0, index=df.index)
    position = 0
    for i in range(1, len(df)):
        c = df["close"].iloc[i]
        if position == 0:
            if c > entry_ch["upper"].iloc[i - 1]:
                position = 1
            elif c < entry_ch["lower"].iloc[i - 1]:
                position = -1
        elif position == 1 and c < exit_ch["lower"].iloc[i - 1]:
            position = 0
        elif position == -1 and c > exit_ch["upper"].iloc[i - 1]:
            position = 0
        signal.iloc[i] = position

    size = n.apply(lambda a: eng.atr_position_size(account_equity, risk_pct, a))
    return signal, size


def s07_parabolic_sar(df, af_start=0.02, af_step=0.02, af_max=0.2):
    sar = ind.parabolic_sar(df, af_start, af_step, af_max)
    return eng.crossover_signal(df["close"], sar)


def s08_ichimoku(df, tenkan_p=9, kijun_p=26, senkou_b_p=52, displacement=26):
    ich = ind.ichimoku(df, tenkan_p, kijun_p, senkou_b_p, displacement)
    cloud_top = ich[["senkou_a", "senkou_b"]].max(axis=1)
    cloud_bottom = ich[["senkou_a", "senkou_b"]].min(axis=1)
    above_cloud = df["close"] > cloud_top
    below_cloud = df["close"] < cloud_bottom
    tk_cross = eng.crossover_signal(ich["tenkan"], ich["kijun"])
    signal = pd.Series(0, index=df.index)
    signal[(tk_cross == 1) & above_cloud] = 1
    signal[(tk_cross == -1) & below_cloud] = -1
    return signal.replace(0, np.nan).ffill().fillna(0)


def s09_supertrend(df, period=10, multiplier=3.0):
    st = ind.supertrend(df, period, multiplier)
    return st["direction"]


def s10_momentum_roc(df, period=10, threshold=0.0):
    r = ind.roc(df["close"], period)
    signal = pd.Series(np.nan, index=df.index)
    signal[r > threshold] = 1
    signal[r < -threshold] = -1
    return signal.ffill().fillna(0)


def s11_relative_strength_rotation(prices: pd.DataFrame, lookback=63, top_k=3, rebalance="M"):
    """
    prices: DataFrame with one column per asset (wide format), not OHLC.
    Returns a DataFrame of target weights (0 or 1/top_k) per asset per
    rebalance date -- this is a portfolio-level strategy, not a single-asset
    signal series.
    """
    returns = prices.pct_change(lookback)
    rebal_dates = prices.resample(rebalance).last().index
    weights = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
    for d in rebal_dates:
        if d not in returns.index:
            continue
        row = returns.loc[:d].iloc[-1].dropna()
        top = row.nlargest(top_k).index
        weights.loc[d:, :] = 0.0
        weights.loc[d:, top] = 1.0 / len(top)
    return weights.ffill().fillna(0)


def s12_new_high_momentum(prices: pd.DataFrame, lookback=252, proximity=0.05):
    """prices: wide DataFrame (columns=assets). Returns boolean DataFrame:
    True where asset is within `proximity` of its `lookback`-day high."""
    rolling_high = prices.rolling(lookback).max()
    return prices >= rolling_high * (1 - proximity)


def s13_dual_momentum(asset: pd.Series, benchmark: pd.Series, cash_return: float = 0.0, lookback=252):
    """
    asset, benchmark: price series (e.g. equities vs bonds).
    Returns a signal Series: 1 = hold asset, -1 = hold benchmark, 0 = hold cash.
    """
    asset_ret = asset.pct_change(lookback)
    bench_ret = benchmark.pct_change(lookback)
    signal = pd.Series(0, index=asset.index)
    better_than_bench = asset_ret > bench_ret
    positive_abs = asset_ret > cash_return
    signal[better_than_bench & positive_abs] = 1
    signal[~better_than_bench & (bench_ret > cash_return)] = -1  # -1 here means "hold benchmark"
    return signal


def s14_trendline_channel(df, window=5, lookback=100):
    return pat.triangle_wedge_breakout(df, window, lookback)


def s15_buy_the_dip(df, trend_ma=200, rsi_period=14, rsi_dip=40):
    trend_up = df["close"] > ind.sma(df["close"], trend_ma)
    r = ind.rsi(df["close"], rsi_period)
    dip = r < rsi_dip
    recovering = r > r.shift(1)
    signal = pd.Series(0, index=df.index)
    signal[trend_up & dip & recovering] = 1
    return signal
