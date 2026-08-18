"""
high_vol_branch.py
-------------------
Primary trading branch for high-volatility instruments (gold, BTC, oil,
indices, volatile forex crosses). This runs FIRST in each scan cycle and
gets priority over the low-vol branch.

Key differences from the low-vol branch:
- Same fixed-per-asset-class lot sizing as the low-vol branch (see
  risk_manager.calculate_trade_plan) -- high-vol instruments are already
  sized smaller by their own asset class (0.02/$100 for metals/oil/indices)
- Tighter ATR stop multiplier (high-vol instruments have bigger ATR already)
- Looser spread tolerance (gold/BTC/oil naturally have wider spreads)
- Only needs 1 strategy to agree (faster signals = faster action)
- Strategy map biased toward scalping + momentum
- Uses HIGH_VOL_REWARD_RISK_RATIO (2:1 instead of 3:1) for faster exits
"""

import logging
import pandas as pd

import config
import mt5_connector as mt5c
import volatility_screener as vs
from signal_combiner import get_combined_signal

logger = logging.getLogger("high_vol_branch")


def _is_high_vol_symbol(symbol: str) -> bool:
    return symbol in config.HIGH_VOL_SYMBOLS


def _get_high_vol_strategy_pool(symbol: str, approved_combos: dict, timeframe: str) -> list:
    """
    Gets the voting pool for a high-vol symbol:
    - backtest-approved strategies for this (symbol, timeframe) combo
    - intersected with the HIGH_VOL_STRATEGY_MAP for the symbol's current bucket
    - falls back to backtest-approved if intersection is empty
    """
    backtest_approved = approved_combos.get((symbol, timeframe), [])
    if not backtest_approved:
        return []

    bucket = vs.get_bucket(symbol)
    hv_allowed = set(config.HIGH_VOL_STRATEGY_MAP.get(bucket, []))
    pool = [s for s in backtest_approved if s in hv_allowed]
    if not pool:
        # don't over-filter -- fall back to backtest-approved if high-vol map would empty it
        pool = backtest_approved

    if config.USE_AI_STRATEGY:
        pool = pool + ["ai_strategy"]
    return pool


def _calculate_high_vol_plan(symbol: str, direction: str, df: pd.DataFrame, account_info,
                              confidence_ratio: float = 1.0):
    """
    High-vol branch position plan. Uses the same fixed-per-asset-class lot
    sizing as the low-vol branch (see risk_manager.calculate_trade_plan),
    with high-vol ATR stop multiplier and reward:risk ratio (faster exits
    on bigger movers). confidence_ratio is accepted for compatibility but
    no longer changes the lot -- the fixed lot wins.
    """
    import risk_manager as rm

    plan = rm.calculate_trade_plan(
        symbol, direction, df, account_info,
        confidence_ratio=confidence_ratio,
        atr_sl_multiplier=config.HIGH_VOL_ATR_SL_MULTIPLIER,
        reward_risk_ratio=config.HIGH_VOL_REWARD_RISK_RATIO,
    )
    return plan


def scan_high_vol_symbols(approved_combos: dict, account_info,
                           open_position_symbols: set) -> list:
    """
    Scans all HIGH_VOL_SYMBOLS and returns a list of trade plans to place.
    Called first in each main-loop scan cycle (see main.py).

    Returns a list of dicts, each with keys: symbol, timeframe, direction,
    lot, sl_price, tp_price, risk_amount, risk_pct_used, votes.
    Multiple high-vol signals can fire in the same scan (one per symbol
    is the limit -- once a symbol has an open position it's skipped).
    """
    from risk_manager import spread_too_wide, too_many_open_positions
    from news_filter import is_news_blackout
    from trade_frequency import get_effective_min_votes

    if too_many_open_positions(account_info):
        return []

    plans = []

    for symbol in config.HIGH_VOL_SYMBOLS:
        if symbol in open_position_symbols:
            continue

        # Use HIGH_VOL_MAX_SPREAD_PIPS for spread check (not the tighter forex default)
        info = mt5c.get_symbol_info(symbol)
        if info is None:
            continue

        point = info.point
        digits = info.digits
        pip_size = point * 10 if digits in (3, 5) else point
        spread_pips = (info.ask - info.bid) / pip_size if pip_size else float("inf")
        if spread_pips > config.HIGH_VOL_MAX_SPREAD_PIPS:
            logger.info(f"{symbol} [HIGH-VOL]: spread {spread_pips:.1f} pips exceeds high-vol max {config.HIGH_VOL_MAX_SPREAD_PIPS}, skipping.")
            continue

        if is_news_blackout(symbol):
            continue

        # High-vol branch requires only 1 strategy to agree (configurable)
        min_votes = max(1, config.HIGH_VOL_MIN_VOTES)

        for timeframe in config.TIMEFRAMES:
            pool = _get_high_vol_strategy_pool(symbol, approved_combos, timeframe)
            non_experimental = [s for s in pool if s not in config.EXPERIMENTAL_STRATEGIES]
            if len(non_experimental) < 1:
                continue

            df = mt5c.get_rates_dataframe(symbol, timeframe, config.BARS_TO_FETCH)
            if df.empty:
                continue

            result = get_combined_signal(df, allowed_strategies=pool, min_votes_override=min_votes)
            if result["direction"] == "HOLD":
                continue

            logger.info(
                f"{symbol} [HIGH-VOL] {timeframe}: votes={result['votes']} -> {result['direction']}"
            )

            plan = _calculate_high_vol_plan(
                symbol, result["direction"], df, account_info,
                confidence_ratio=result.get("confidence_ratio", 1.0),
            )
            if plan is None:
                continue

            plan["timeframe"] = timeframe
            plan["votes"] = result["votes"]
            plans.append(plan)
            open_position_symbols.add(symbol)  # mark as claimed for this scan
            break  # one timeframe per symbol per scan

    return plans
