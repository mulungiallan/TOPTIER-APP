"""Strategies #76-86 -- Quant, Systematic & Execution."""
import numpy as np
import pandas as pd
import sys, os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import engines as eng


def s76_factor_investing(fundamentals: pd.DataFrame, factor: str = "value", top_pct=0.2):
    """
    fundamentals: wide DataFrame indexed by date, MultiIndex columns
    (ticker, metric) with metrics like 'pe','pb','roe','debt_equity',
    'momentum_12_1','trailing_vol'. Returns boolean DataFrame: True where a
    ticker is in the top `top_pct` bucket for the chosen factor at each date.
    """
    factor_map = {
        "value": lambda df: -df.xs("pe", axis=1, level=1),         # lower PE = better value
        "momentum": lambda df: df.xs("momentum_12_1", axis=1, level=1),
        "quality": lambda df: df.xs("roe", axis=1, level=1) - df.xs("debt_equity", axis=1, level=1),
        "low_vol": lambda df: -df.xs("trailing_vol", axis=1, level=1),
    }
    scores = factor_map[factor](fundamentals)
    cutoff = scores.quantile(1 - top_pct, axis=1)
    return scores.ge(cutoff, axis=0)


def s77_risk_parity(returns: pd.DataFrame, vol_lookback=60):
    """returns: wide DataFrame of asset daily returns. Returns target weight
    DataFrame where each asset's risk contribution is (approximately) equal,
    via the standard inverse-volatility approximation."""
    vol = returns.rolling(vol_lookback).std()
    inv_vol = 1 / vol.replace(0, np.nan)
    weights = inv_vol.div(inv_vol.sum(axis=1), axis=0)
    return weights.fillna(0)


def s78_market_making(mid_price: pd.Series, base_spread_pct=0.1, inventory: float = 0,
                       max_inventory=100, skew_factor=0.02):
    """
    Returns (bid, ask) quote series. Skews quotes away from mid as inventory
    grows to encourage mean-reverting toward flat -- the standard
    inventory-risk-managed market-making formula. NOTE: genuinely competitive
    market making needs L2 order-book access and sub-millisecond latency;
    treat this as a simulation/paper-trading module, not a live strategy for
    a typical retail-facing app.
    """
    half_spread = mid_price * base_spread_pct / 200
    skew = mid_price * skew_factor * (inventory / max_inventory)
    bid = mid_price - half_spread - skew
    ask = mid_price + half_spread - skew
    return bid, ask


def s79_hft_latency_arbitrage_note():
    """
    Not implementable as a library function: HFT/latency arbitrage depends on
    co-location, direct exchange feeds, and microsecond-level infrastructure
    that a typical application layer cannot provide. Included here only so
    the strategy registry is complete -- calling this raises intentionally.
    """
    raise NotImplementedError(
        "High-Frequency Trading / latency arbitrage requires exchange "
        "co-location and specialized hardware infrastructure outside the "
        "scope of an application-layer strategy library."
    )


def s80_vwap_execution(order_size: float, historical_volume_curve: pd.Series):
    """historical_volume_curve: expected volume per time bucket (e.g. per
    minute) over the execution window, summing to 1.0. Returns the number of
    shares/contracts to execute in each bucket."""
    weights = historical_volume_curve / historical_volume_curve.sum()
    return (weights * order_size).round()


def s81_twap_execution(order_size: float, num_slices: int):
    slice_size = order_size / num_slices
    return pd.Series([slice_size] * num_slices)


def s82_ml_signal_trading(features: pd.DataFrame, model, confidence_threshold=0.6):
    """
    model: any fitted classifier exposing predict_proba(features) -> [P(down), P(up)].
    This function only handles converting a trained model's output into a
    trading signal with a confidence gate -- training/validation/feature
    engineering are a separate pipeline (see README for the walk-forward
    validation requirement before using this live).
    """
    probs = model.predict_proba(features)
    p_up = probs[:, 1]
    signal = pd.Series(0, index=features.index)
    signal[p_up > confidence_threshold] = 1
    signal[p_up < (1 - confidence_threshold)] = -1
    return signal


def s83_sentiment_trading(sentiment_scores: pd.Series, threshold=0.3, smoothing_window=5):
    """sentiment_scores: pre-computed per-bar sentiment in [-1, 1] from an
    external NLP pipeline (news/social/earnings-call classifier)."""
    smoothed = sentiment_scores.rolling(smoothing_window).mean()
    signal = pd.Series(0, index=sentiment_scores.index)
    signal[smoothed > threshold] = 1
    signal[smoothed < -threshold] = -1
    return signal


def s84_grid_trading(price: pd.Series, lower_bound: float, upper_bound: float,
                      grid_levels: int = 10, order_size: float = 1.0, hard_stop=True):
    """
    Returns a DataFrame of grid level prices and, for each bar, which level
    (if any) was crossed and in which direction. `hard_stop=True` forces full
    liquidation if price exits [lower_bound, upper_bound] -- REQUIRED safety
    guard since grid trading has unbounded risk in a strong trend.
    """
    levels = np.linspace(lower_bound, upper_bound, grid_levels + 1)
    signal = pd.Series(0.0, index=price.index)
    position = 0.0
    last_level_idx = None
    for i, p in enumerate(price):
        if hard_stop and (p < lower_bound or p > upper_bound):
            signal.iloc[i] = -position  # liquidate everything
            position = 0.0
            continue
        idx = np.searchsorted(levels, p)
        if last_level_idx is not None and idx != last_level_idx:
            direction = 1 if idx < last_level_idx else -1  # price fell -> buy; rose -> sell
            signal.iloc[i] = direction * order_size
            position += direction * order_size
        last_level_idx = idx
    return signal


def s85_martingale_sizing(trade_results: list, base_size=1.0, multiplier=2.0, max_doublings=4):
    """trade_results: list of past P&L (negative=loss). Returns the size for
    the NEXT trade. WARNING: exponential position growth on a losing streak
    -- always pair with an absolute capital-at-risk cap in the caller."""
    consecutive_losses = 0
    for r in reversed(trade_results):
        if r < 0:
            consecutive_losses += 1
        else:
            break
    return eng.martingale_size(base_size, consecutive_losses, multiplier, max_doublings)


def s86_kelly_sizing(win_prob: float, win_loss_ratio: float, kelly_scale=0.5, account_equity=100_000):
    fraction = eng.kelly_fraction(win_prob, win_loss_ratio, kelly_scale)
    return fraction * account_equity
