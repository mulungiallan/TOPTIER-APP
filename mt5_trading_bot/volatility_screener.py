"""
volatility_screener.py
--------------------------
Ranks every symbol in config.SYMBOLS by current volatility (ATR as a % of
price, on VOLATILITY_REFERENCE_TIMEFRAME) RELATIVE TO THE OTHERS being
scanned right now, and buckets each into LOW / MEDIUM / HIGH / EXTREME.
config.STRATEGY_VOLATILITY_MAP then determines which strategies are even
allowed to vote on a symbol in each bucket -- this is what makes "trade
every pair depending on volatility from low to high" mean something
concrete: a quiet pair gets matched with range/mean-reversion style logic,
a wild pair gets matched with momentum/scalping.

Buckets are RELATIVE (percentile-based across whatever's currently being
scanned), not fixed absolute ATR% thresholds -- volatility regimes shift
all the time, so a fixed cutoff would quietly stop matching reality.
Re-ranking periodically (config.VOLATILITY_REFRESH_EVERY_N_SCANS) keeps it current.
"""

import logging
import numpy as np

import config
import indicators as ind
import mt5_connector as mt5c

logger = logging.getLogger("volatility_screener")

_cached_rankings = {}  # symbol -> {"atr_pct": float, "bucket": "LOW"|"MEDIUM"|"HIGH"|"EXTREME"}


def _atr_pct_for_symbol(symbol: str):
    """ATR as a percentage of price -- comparable across pairs of very different price scales (USDJPY ~150 vs EURUSD ~1.1)."""
    df = mt5c.get_rates_dataframe(symbol, config.VOLATILITY_REFERENCE_TIMEFRAME, config.VOLATILITY_LOOKBACK_BARS)
    if df.empty or len(df) < config.ATR_PERIOD + 2:
        return None

    last_atr = ind.atr(df, config.ATR_PERIOD).iloc[-1]
    last_close = df["close"].iloc[-1]
    if last_atr is None or not last_close or np.isnan(last_atr):
        return None

    return (last_atr / last_close) * 100


def refresh_rankings():
    """Re-ranks every symbol in config.SYMBOLS. Call periodically, not every scan."""
    global _cached_rankings

    raw = {}
    for symbol in config.SYMBOLS:
        atr_pct = _atr_pct_for_symbol(symbol)
        if atr_pct is not None:
            raw[symbol] = atr_pct

    if not raw:
        logger.warning("Volatility screener got no usable data for any symbol -- keeping previous rankings.")
        return

    values = list(raw.values())
    low_cut = np.percentile(values, config.VOLATILITY_LOW_PERCENTILE)
    high_cut = np.percentile(values, config.VOLATILITY_HIGH_PERCENTILE)
    median_val = np.median(values)

    new_rankings = {}
    for symbol, atr_pct in raw.items():
        if atr_pct <= low_cut:
            bucket = "LOW"
        elif atr_pct >= high_cut:
            bucket = "EXTREME"
        elif atr_pct >= median_val:
            bucket = "HIGH"
        else:
            bucket = "MEDIUM"
        new_rankings[symbol] = {"atr_pct": round(atr_pct, 4), "bucket": bucket}

    _cached_rankings = new_rankings
    bucket_summary = {}
    for info in new_rankings.values():
        bucket_summary[info["bucket"]] = bucket_summary.get(info["bucket"], 0) + 1
    logger.info(f"Volatility rankings refreshed: {bucket_summary} (from {len(new_rankings)} symbols).")


def get_bucket(symbol: str) -> str:
    """Returns the symbol's current volatility bucket, or 'MEDIUM' as a safe default if not yet ranked."""
    info = _cached_rankings.get(symbol)
    return info["bucket"] if info else "MEDIUM"


def get_allowed_strategies_for_symbol(symbol: str) -> list:
    """Returns the list of strategy names suited to this symbol's current volatility bucket."""
    bucket = get_bucket(symbol)
    return config.STRATEGY_VOLATILITY_MAP.get(bucket, [])


def get_all_rankings() -> dict:
    return dict(_cached_rankings)
