"""
backtest_filter.py
--------------------
Implements the "only trade combos with a demonstrated history of working"
filter. For every (symbol, timeframe, strategy) combination, this module
replays BACKTEST_BARS of history bar-by-bar, simulates entries/exits using
the exact same SL/TP logic the live bot uses (ATR-based stop, fixed
reward:risk, and the 4-level take-profit ladder), and computes win rate +
profit factor.

A combo only gets added to the live "approved" list if it clears both
MIN_WIN_RATE_PCT and MIN_PROFIT_FACTOR with at least MIN_TRADES_FOR_VALIDITY
trades in the sample. This is a backtest-based filter, not a prediction.
Historical performance does not guarantee future results -- markets shift,
and a combo that worked over the backtest window can still lose money live.
"""

import logging
import pandas as pd

import config
import indicators as ind
import mt5_connector as mt5c
from strategies import trend_following, momentum, mean_reversion, swing_trading, scalping

logger = logging.getLogger("backtest_filter")

STRATEGY_FUNCS = {
    "trend_following": trend_following.signal,
    "momentum": momentum.signal,
    "mean_reversion": mean_reversion.signal,
    "swing_trading": swing_trading.signal,
    "scalping": scalping.signal,
}

# Each strategy can use its own stop-distance multiplier and reward:risk ratio.
# Scalping targets smaller, faster moves so it gets a tighter stop and ratio
# (see config.py) rather than reusing the swing/trend numbers.
STRATEGY_RISK_PARAMS = {
    "trend_following": (config.ATR_SL_MULTIPLIER, config.REWARD_RISK_RATIO),
    "momentum": (config.ATR_SL_MULTIPLIER, config.REWARD_RISK_RATIO),
    "mean_reversion": (config.ATR_SL_MULTIPLIER, config.REWARD_RISK_RATIO),
    "swing_trading": (config.ATR_SL_MULTIPLIER, config.REWARD_RISK_RATIO),
    "scalping": (config.ATR_SL_MULTIPLIER_SCALPING, config.REWARD_RISK_RATIO_SCALPING),
}


def _simulate_strategy(df: pd.DataFrame, strategy_fn, atr_sl_multiplier: float, reward_risk_ratio: float) -> dict:
    """
    Walk forward through df bar-by-bar. At each bar, ask the strategy for a
    signal using only data up to that bar (no lookahead). If it signals
    BUY/SELL and we're flat, open a simulated position sized by ATR SL/TP
    exactly like the live risk manager. Each subsequent bar's high/low is
    checked against the 4-level take-profit ladder (partial closes banking
    a fixed % of the position) and the SL. Returns trade stats.
    """
    levels = getattr(config, "TAKE_PROFIT_LEVELS", []) if getattr(config, "USE_TP_LADDER", False) else []
    if not levels:
        levels = [(1.0, 100.0)]  # ladder off: single broker TP at the full target
    level_fracs = [fraction for fraction, _ in levels]
    close_pcts = [close_pct for _, close_pct in levels]

    atr_series = ind.atr(df, config.ATR_PERIOD)
    trades = []
    in_position = False
    direction = None
    entry_price = sl_price = None
    tp_prices = []  # one price per ladder level (ascending fraction)
    banked_levels = set()
    remaining_pct = 100.0
    min_bars_needed = 60  # give every strategy enough warm-up history

    for i in range(min_bars_needed, len(df) - 1):
        window = df.iloc[: i + 1]

        if not in_position:
            sig = strategy_fn(window)
            if sig in ("BUY", "SELL"):
                last_atr = atr_series.iloc[i]
                if pd.isna(last_atr) or last_atr <= 0:
                    continue
                entry_price = df["close"].iloc[i]
                sl_dist = last_atr * atr_sl_multiplier
                direction = sig
                if direction == "BUY":
                    sl_price = entry_price - sl_dist
                    tp_prices = [entry_price + sl_dist * fraction * reward_risk_ratio for fraction, _ in levels]
                else:
                    sl_price = entry_price + sl_dist
                    tp_prices = [entry_price - sl_dist * fraction * reward_risk_ratio for fraction, _ in levels]
                in_position = True
                banked_levels = set()
                remaining_pct = 100.0
        else:
            bar = df.iloc[i + 1]  # next bar after entry decision
            hit_sl = (bar["low"] <= sl_price) if direction == "BUY" else (bar["high"] >= sl_price)
            new_hits = [
                idx for idx, tp in enumerate(tp_prices)
                if idx not in banked_levels
                and (bar["high"] >= tp if direction == "BUY" else bar["low"] <= tp)
            ]

            if hit_sl and new_hits:
                # Conservative assumption: if SL and any TP fall within the same
                # bar's range, the SL came first (we can't know intrabar order).
                # The remaining position is the loss (already-banked shares stay).
                total_r = sum(
                    (close_pcts[idx] / 100.0) * (level_fracs[idx] * reward_risk_ratio)
                    for idx in banked_levels
                )
                trades.append(total_r - remaining_pct / 100.0)
                in_position = False
            elif hit_sl:
                total_r = sum(
                    (close_pcts[idx] / 100.0) * (level_fracs[idx] * reward_risk_ratio)
                    for idx in banked_levels
                )
                trades.append(total_r - remaining_pct / 100.0)
                in_position = False
            elif new_hits:
                # Each ladder level reached this bar banks its share of the
                # ORIGINAL position at that level's R multiple. The final
                # level (fraction 1.0) closes the rest at the full reward:risk.
                for idx in sorted(new_hits):
                    banked_levels.add(idx)
                    remaining_pct -= close_pcts[idx]
                total_r = sum(
                    (close_pcts[idx] / 100.0) * (level_fracs[idx] * reward_risk_ratio)
                    for idx in banked_levels
                )
                if remaining_pct <= 0 or max(banked_levels) == len(levels) - 1:
                    # Fully exited via the ladder (final level = broker TP).
                    trades.append(total_r)
                    in_position = False
            # else: still open, keep waiting for next bar

    wins = [t for t in trades if t > 0]
    losses = [t for t in trades if t < 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    win_rate = (len(wins) / len(trades) * 100) if trades else 0.0
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (float("inf") if gross_profit > 0 else 0.0)

    return {
        "trade_count": len(trades),
        "win_rate_pct": round(win_rate, 1),
        "profit_factor": round(profit_factor, 2) if profit_factor != float("inf") else profit_factor,
    }


def evaluate_all_combos() -> dict:
    """
    Runs the backtest across every (symbol, timeframe, strategy) combo.
    Returns: {(symbol, timeframe): {strategy_name: stats_dict, ...}, ...}
    """
    results = {}
    for symbol in config.SYMBOLS:
        for timeframe in config.TIMEFRAMES:
            df = mt5c.get_rates_dataframe(symbol, timeframe, config.BACKTEST_BARS)
            if df.empty or len(df) < 100:
                logger.warning(f"Not enough history for {symbol} {timeframe}, skipping backtest.")
                continue

            combo_results = {}
            for name, fn in STRATEGY_FUNCS.items():
                atr_mult, rr = STRATEGY_RISK_PARAMS[name]
                stats = _simulate_strategy(df, fn, atr_mult, rr)
                combo_results[name] = stats
                logger.info(
                    f"[BACKTEST] {symbol} {timeframe} {name}: "
                    f"{stats['trade_count']} trades, win rate {stats['win_rate_pct']}%, "
                    f"profit factor {stats['profit_factor']}"
                )
            results[(symbol, timeframe)] = combo_results
    return results


def approved_strategies_for(combo_results: dict) -> dict:
    """
    Given evaluate_all_combos() output, returns:
    {(symbol, timeframe): [list of strategy names that passed the filter]}
    Combos/strategies that don't meet the thresholds are excluded entirely --
    they will not generate live trades regardless of MIN_VOTES_TO_TRADE.
    """
    approved = {}
    for key, strat_stats in combo_results.items():
        passing = []
        for name, stats in strat_stats.items():
            if (stats["trade_count"] >= config.MIN_TRADES_FOR_VALIDITY
                    and stats["win_rate_pct"] >= config.MIN_WIN_RATE_PCT
                    and stats["profit_factor"] >= config.MIN_PROFIT_FACTOR):
                passing.append(name)
        approved[key] = passing
        symbol, timeframe = key
        if passing:
            logger.info(f"APPROVED for live trading: {symbol} {timeframe} -> {passing}")
        else:
            logger.info(f"NOT approved: {symbol} {timeframe} -> no strategy cleared the bar, this combo stays disabled.")
    return approved
