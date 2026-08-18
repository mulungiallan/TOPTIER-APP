"""
signal_combiner.py
--------------------
Runs every enabled strategy against the same price data and combines their
votes. A trade direction is only returned when at least MIN_VOTES_TO_TRADE
(or the relaxed effective value from trade_frequency.py) strategies agree
-- this is what keeps trend-following/momentum (trend strategies) from
constantly fighting mean_reversion (counter-trend) and firing on noise.

ai_strategy and micro_scalping are EXPERIMENTAL_STRATEGIES (config.py) --
they sit outside the backtest filter (an LLM call and tick data aren't
things that get cheaply/meaningfully backtested). REQUIRE_NON_EXPERIMENTAL_
AGREEMENT enforces that at least one OTHER (backtest-approved) strategy
must agree with whatever direction the vote settles on, so neither one can
single-handedly force a trade.
"""

import pandas as pd
import logging

import config
from strategies import trend_following, momentum, mean_reversion, swing_trading, scalping
import ai_strategy

logger = logging.getLogger("signal_combiner")

STRATEGY_REGISTRY = [
    ("trend_following", trend_following.signal, config.USE_TREND_FOLLOWING),
    ("momentum", momentum.signal, config.USE_MOMENTUM),
    ("mean_reversion", mean_reversion.signal, config.USE_MEAN_REVERSION),
    ("swing_trading", swing_trading.signal, config.USE_SWING),
    ("scalping", scalping.signal, config.USE_SCALPING),
    ("ai_strategy", ai_strategy.signal, config.USE_AI_STRATEGY),
]


def get_combined_signal(df: pd.DataFrame, allowed_strategies: list = None, min_votes_override: int = None) -> dict:
    """
    Returns: {"direction": "BUY"|"SELL"|"HOLD", "votes": {...}, "agree_count": int, "confidence_ratio": float}
    direction is only ever BUY/SELL when enough strategies agree; else HOLD.

    allowed_strategies: if provided, only strategies whose name is in this
    list are allowed to vote (used to intersect the backtest-approved,
    volatility-matched, and session-matched lists before calling this).

    min_votes_override: if provided, used instead of config.MIN_VOTES_TO_TRADE
    (this is how trade_frequency.py's soft daily-target relaxation takes effect).

    confidence_ratio: agree_count as a fraction of total strategies that
    actually voted (not HOLD-by-absence) -- retained for compatibility;
    lot sizing is now fixed per asset class, so this no longer scales
    position size (see risk_manager.calculate_trade_plan).
    """
    min_votes = min_votes_override if min_votes_override is not None else config.MIN_VOTES_TO_TRADE

    votes = {}
    for name, fn, enabled in STRATEGY_REGISTRY:
        if not enabled:
            continue
        if allowed_strategies is not None and name not in allowed_strategies:
            continue
        try:
            votes[name] = fn(df)
        except Exception as e:
            logger.warning(f"Strategy '{name}' raised an error, treating as HOLD: {e}")
            votes[name] = "HOLD"

    buy_votes = sum(1 for v in votes.values() if v == "BUY")
    sell_votes = sum(1 for v in votes.values() if v == "SELL")
    total_voters = len(votes) if votes else 1

    direction = "HOLD"
    agree_count = 0
    if buy_votes >= min_votes and buy_votes > sell_votes:
        direction = "BUY"
        agree_count = buy_votes
    elif sell_votes >= min_votes and sell_votes > buy_votes:
        direction = "SELL"
        agree_count = sell_votes

    if direction != "HOLD" and config.REQUIRE_NON_EXPERIMENTAL_AGREEMENT:
        non_experimental_agree = sum(
            1 for name, v in votes.items()
            if name not in config.EXPERIMENTAL_STRATEGIES and v == direction
        )
        if non_experimental_agree < 1:
            logger.info(
                f"Direction {direction} reached vote threshold but only via experimental strategies "
                f"{config.EXPERIMENTAL_STRATEGIES} -- blocking trade. Votes: {votes}"
            )
            direction = "HOLD"
            agree_count = 0

    confidence_ratio = (agree_count / total_voters) if direction != "HOLD" else 0.0
    return {"direction": direction, "votes": votes, "agree_count": agree_count, "confidence_ratio": confidence_ratio}
