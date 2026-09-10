"""
Implements the 10 strategy families as signal generators.

Convention: every strategy function takes an indicator-enriched OHLCV
DataFrame (see indicators.add_all_indicators) and returns a pandas Series
of signals aligned to the same index, valued:
    1  -> long / bullish
   -1  -> short / bearish
    0  -> flat / no signal

Two strategies (pairs trading, carry trade) inherently need more than a
single price series, so they're exposed as separate helper functions with
their own signatures rather than forced into the single-asset interface.
"""

from __future__ import annotations
import numpy as np
import pandas as pd

from . import indicators as ind


# ---------------------------------------------------------------------------
# 1. Trend following (moving average crossover)
# ---------------------------------------------------------------------------
def trend_following(df: pd.DataFrame, fast: int = 50, slow: int = 200) -> pd.Series:
    fast_ma = ind.sma(df["close"], fast)
    slow_ma = ind.sma(df["close"], slow)
    sig = np.where(fast_ma > slow_ma, 1, np.where(fast_ma < slow_ma, -1, 0))
    return pd.Series(sig, index=df.index, name="trend_following")


# ---------------------------------------------------------------------------
# 2. Mean reversion (Bollinger Bands + RSI)
# ---------------------------------------------------------------------------
def mean_reversion(df: pd.DataFrame, rsi_oversold: float = 30, rsi_overbought: float = 70) -> pd.Series:
    bb = ind.bollinger_bands(df["close"])
    rsi = ind.rsi(df["close"])
    long_cond = (df["close"] < bb["bb_lower"]) & (rsi < rsi_oversold)
    short_cond = (df["close"] > bb["bb_upper"]) & (rsi > rsi_overbought)
    sig = np.where(long_cond, 1, np.where(short_cond, -1, 0))
    return pd.Series(sig, index=df.index, name="mean_reversion")


# ---------------------------------------------------------------------------
# 3. Momentum (rate of change over lookback)
# ---------------------------------------------------------------------------
def momentum(df: pd.DataFrame, lookback: int = 20, threshold: float = 0.0) -> pd.Series:
    roc = df["close"].pct_change(lookback)
    sig = np.where(roc > threshold, 1, np.where(roc < -threshold, -1, 0))
    return pd.Series(sig, index=df.index, name="momentum")


# ---------------------------------------------------------------------------
# 4. Swing trading (short MA vs medium MA + RSI filter, wider swings)
# ---------------------------------------------------------------------------
def swing_trading(df: pd.DataFrame, fast: int = 10, slow: int = 30) -> pd.Series:
    fast_ma = ind.ema(df["close"], fast)
    slow_ma = ind.ema(df["close"], slow)
    rsi = ind.rsi(df["close"])
    long_cond = (fast_ma > slow_ma) & (rsi < 65) & (rsi > 40)
    short_cond = (fast_ma < slow_ma) & (rsi > 35) & (rsi < 60)
    sig = np.where(long_cond, 1, np.where(short_cond, -1, 0))
    return pd.Series(sig, index=df.index, name="swing_trading")


# ---------------------------------------------------------------------------
# 5. Scalping (very short EMA cross + tight volatility filter)
# ---------------------------------------------------------------------------
def scalping(df: pd.DataFrame, fast: int = 3, slow: int = 8, atr_window: int = 14) -> pd.Series:
    fast_ma = ind.ema(df["close"], fast)
    slow_ma = ind.ema(df["close"], slow)
    atr = ind.atr(df, atr_window)
    vol_ok = atr > atr.rolling(50).mean() * 0.5  # avoid dead/illiquid periods
    sig = np.where((fast_ma > slow_ma) & vol_ok, 1, np.where((fast_ma < slow_ma) & vol_ok, -1, 0))
    return pd.Series(sig, index=df.index, name="scalping")


# ---------------------------------------------------------------------------
# 6. Statistical arbitrage (single-asset proxy: z-score of price vs its mean)
#    For true cross-asset arbitrage, see pairs_trading() below.
# ---------------------------------------------------------------------------
def stat_arbitrage(df: pd.DataFrame, window: int = 20, entry_z: float = 2.0, exit_z: float = 0.5) -> pd.Series:
    z = ind.rolling_zscore(df["close"], window)
    sig = np.where(z > entry_z, -1, np.where(z < -entry_z, 1, 0))
    return pd.Series(sig, index=df.index, name="stat_arbitrage")


# ---------------------------------------------------------------------------
# 7. Market making (proxy signal: fade short-term extremes within a range)
#    A real market maker quotes both sides continuously; this proxy signals
#    which side to lean when inventory-skewing around a fair-value estimate.
# ---------------------------------------------------------------------------
def market_making_bias(df: pd.DataFrame, window: int = 20) -> pd.Series:
    fair_value = ind.ema(df["close"], window)
    deviation = (df["close"] - fair_value) / fair_value
    sig = np.where(deviation < -0.002, 1, np.where(deviation > 0.002, -1, 0))
    return pd.Series(sig, index=df.index, name="market_making_bias")


# ---------------------------------------------------------------------------
# 8. Pairs trading (needs two price series)
# ---------------------------------------------------------------------------
def pairs_trading(price_a: pd.Series, price_b: pd.Series, window: int = 30, entry_z: float = 2.0):
    """
    Returns a DataFrame with the spread z-score and signals for each leg:
      signal_a = 1  -> long A / short B
      signal_a = -1 -> short A / long B
    """
    spread = np.log(price_a) - np.log(price_b)
    z = ind.rolling_zscore(spread, window)
    signal_a = np.where(z < -entry_z, 1, np.where(z > entry_z, -1, 0))
    return pd.DataFrame(
        {"spread": spread, "zscore": z, "signal_a": signal_a, "signal_b": -np.array(signal_a)},
        index=price_a.index,
    )


# ---------------------------------------------------------------------------
# 9. Breakout trading (price breaks N-period high/low)
# ---------------------------------------------------------------------------
def breakout(df: pd.DataFrame, window: int = 20) -> pd.Series:
    highest = df["high"].rolling(window).max().shift(1)
    lowest = df["low"].rolling(window).min().shift(1)
    sig = np.where(df["close"] > highest, 1, np.where(df["close"] < lowest, -1, 0))
    return pd.Series(sig, index=df.index, name="breakout")


# ---------------------------------------------------------------------------
# 10. Carry trade (needs interest-rate differential; FX-specific)
# ---------------------------------------------------------------------------
def carry_trade(rate_base: float, rate_quote: float, threshold: float = 0.0) -> int:
    """
    Simple static carry signal: long the pair if the base currency's rate
    exceeds the quote currency's rate by more than `threshold`.
    rate_base / rate_quote are annualized interest rates as decimals (e.g. 0.05 = 5%).
    Returns 1 (long carry), -1 (short carry), or 0 (flat).
    """
    diff = rate_base - rate_quote
    if diff > threshold:
        return 1
    elif diff < -threshold:
        return -1
    return 0


# ---------------------------------------------------------------------------
# Runner: apply every single-asset strategy and build a composite signal
# ---------------------------------------------------------------------------
SINGLE_ASSET_STRATEGIES = {
    "trend_following": trend_following,
    "mean_reversion": mean_reversion,
    "momentum": momentum,
    "swing_trading": swing_trading,
    "scalping": scalping,
    "stat_arbitrage": stat_arbitrage,
    "market_making_bias": market_making_bias,
    "breakout": breakout,
}


def run_all_strategies(df_with_indicators: pd.DataFrame) -> pd.DataFrame:
    """
    Runs every single-asset strategy and returns a DataFrame:
      one column per strategy, plus 'composite' (sum of signals) and
      'consensus' (majority vote: 1 / -1 / 0).
    Pairs trading and carry trade are excluded since they need extra inputs
    (call pairs_trading()/carry_trade() directly).
    """
    out = pd.DataFrame(index=df_with_indicators.index)
    for name, fn in SINGLE_ASSET_STRATEGIES.items():
        out[name] = fn(df_with_indicators)

    out["composite"] = out.sum(axis=1)
    n = len(SINGLE_ASSET_STRATEGIES)
    out["consensus"] = np.where(
        out["composite"] >= n * 0.3, 1, np.where(out["composite"] <= -n * 0.3, -1, 0)
    )
    return out
