"""Strategies #16-28 -- Mean Reversion / Counter-Trend."""
import numpy as np
import pandas as pd
import sys, os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import indicators as ind
import engines as eng


def s16_rsi_reversion(df, period=14, low_th=30, high_th=70, exit_mid=50):
    r = ind.rsi(df["close"], period)
    return eng.oscillator_reversion_signal(r, low_th, high_th, exit_mid)


def s17_connors_rsi2(df, rsi_period=2, buy_th=10, sell_th=90, trend_ma=200, exit_ma=5):
    r = ind.rsi(df["close"], rsi_period)
    trend_up = df["close"] > ind.sma(df["close"], trend_ma)
    exit_line = ind.sma(df["close"], exit_ma)
    signal = pd.Series(0, index=df.index)
    position = 0
    for i in range(len(df)):
        if position == 0 and r.iloc[i] < buy_th and trend_up.iloc[i]:
            position = 1
        elif position == 1 and (df["close"].iloc[i] > exit_line.iloc[i] or r.iloc[i] > sell_th):
            position = 0
        signal.iloc[i] = position
    return signal


def s18_bollinger_reversion(df, period=20, num_std=2.0):
    bb = ind.bollinger_bands(df["close"], period, num_std)
    return eng.band_reversion_signal(df["close"], bb["upper"], bb["lower"], bb["mid"])


def s19_stochastic_reversion(df, k_period=14, d_period=3, low_th=20, high_th=80):
    st = ind.stochastic(df, k_period, d_period)
    cross = eng.crossover_signal(st["k"], st["d"])
    signal = pd.Series(0, index=df.index)
    signal[(cross == 1) & (st["k"] < low_th)] = 1
    signal[(cross == -1) & (st["k"] > high_th)] = -1
    return signal.replace(0, np.nan).ffill().fillna(0)


def s20_zscore_reversion(df, period=20, entry=2.0, exit=0.0):
    z = ind.zscore(df["close"], period)
    return eng.zscore_signal(z, entry, exit)


def s21_pairs_trading(price_a: pd.Series, price_b: pd.Series, lookback=60, entry=2.0, exit=0.0, stop=3.5):
    """Returns (signal_a, signal_b, spread_z). signal_a=+1 means long A/short B."""
    spread, beta = eng.pair_spread(price_a, price_b, lookback)
    z = ind.zscore(spread, lookback)
    sig = eng.zscore_signal(z, entry, exit, stop)
    return sig, -sig, z  # A follows sig, B is the opposite leg


def s22_stat_arb_basket(prices: pd.DataFrame, lookback=60, entry=2.0, exit=0.0):
    """
    prices: wide DataFrame (columns = assets in the basket).
    Simplified PCA-residual stat arb: for each asset, residual = price -
    projection onto the first principal component (a proxy 'market factor'),
    then trade the Z-score of each residual.
    Returns a DataFrame of signals, one column per asset.
    """
    log_prices = np.log(prices.dropna(axis=1, how="any"))
    signals = pd.DataFrame(0, index=log_prices.index, columns=log_prices.columns)
    window = lookback
    for i in range(window, len(log_prices)):
        window_data = log_prices.iloc[i - window:i]
        centered = window_data - window_data.mean()
        cov = np.cov(centered.values.T)
        eigvals, eigvecs = np.linalg.eigh(cov)
        pc1 = eigvecs[:, -1]
        factor_returns = centered.values @ pc1
        loadings = np.array([np.polyfit(factor_returns, centered.values[:, j], 1)[0]
                              for j in range(centered.shape[1])])
        predicted = np.outer(factor_returns, loadings)
        residuals = centered.values - predicted
        resid_z = (residuals[-1] - residuals.mean(axis=0)) / (residuals.std(axis=0) + 1e-9)
        row = log_prices.index[i]
        signals.loc[row, resid_z < -entry] = 1
        signals.loc[row, resid_z > entry] = -1
    return signals


def s23_vwap_reversion(df, dev_threshold_pct=0.5):
    vwap = ind.session_vwap(df)
    dev = (df["close"] - vwap) / vwap * 100
    signal = pd.Series(np.nan, index=df.index)
    signal[dev < -dev_threshold_pct] = 1
    signal[dev > dev_threshold_pct] = -1
    exit_mask = dev.abs() < (dev_threshold_pct * 0.1)
    signal[exit_mask] = 0
    return signal.ffill().fillna(0)


def s24_overnight_reversal(df, momentum_lookback=1, threshold_pct=1.0):
    """Signal generated at the close, meant to be acted on at next session's
    open by the backtester/execution layer -- short strong up-closes, long
    strong down-closes."""
    intraday_ret = (df["close"] - df["open"]) / df["open"] * 100
    signal = pd.Series(0, index=df.index)
    signal[intraday_ret > threshold_pct] = -1
    signal[intraday_ret < -threshold_pct] = 1
    return signal


def s25_cci_reversion(df, period=20, low_th=-100, high_th=100):
    c = ind.cci(df, period)
    return eng.oscillator_reversion_signal(c, low_th, high_th, exit_mid=0)


def s26_williams_r_reversion(df, period=14, low_th=-80, high_th=-20):
    w = ind.williams_r(df, period)
    return eng.oscillator_reversion_signal(w, low_th, high_th, exit_mid=-50)


def s27_fade_the_gap(df, gap_threshold_pct=1.0, max_hold_bars=5):
    prev_close = df["close"].shift(1)
    gap_pct = (df["open"] - prev_close) / prev_close * 100
    signal = pd.Series(0, index=df.index)
    position, hold_count = 0, 0
    for i in range(len(df)):
        if position == 0:
            if gap_pct.iloc[i] > gap_threshold_pct:
                position, hold_count = -1, 0
            elif gap_pct.iloc[i] < -gap_threshold_pct:
                position, hold_count = 1, 0
        else:
            hold_count += 1
            filled = (position == -1 and df["close"].iloc[i] <= prev_close.iloc[i]) or \
                     (position == 1 and df["close"].iloc[i] >= prev_close.iloc[i])
            if filled or hold_count >= max_hold_bars:
                position = 0
        signal.iloc[i] = position
    return signal


def s28_sector_mean_reversion(sector_prices: pd.DataFrame, benchmark: pd.Series, lookback=20, threshold_pct=-5.0):
    """sector_prices: wide DataFrame of sector ETF prices. Returns boolean
    DataFrame: True where a sector has underperformed the benchmark by more
    than threshold_pct over `lookback` bars (a buy candidate)."""
    sector_ret = sector_prices.pct_change(lookback) * 100
    bench_ret = benchmark.pct_change(lookback) * 100
    relative = sector_ret.sub(bench_ret, axis=0)
    return relative < threshold_pct
