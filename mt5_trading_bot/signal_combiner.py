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
from strategies import (
    trend_following,
    momentum,
    mean_reversion,
    swing_trading,
    scalping,
    stat_arbitrage,
    market_making_bias,
    breakout,
    ema_cross,
    macd_cross,
    adx_trend,
    stochastic_reversion,
    atr_channel_breakout,
    supertrend,
    parabolic_sar,
    ichimoku,
    turtle_system,
    buy_the_dip,
    golden_death_cross,
    rsi_reversion,
    connors_rsi2,
    vwap_reversion,
    cci_reversion,
    williams_r_reversion,
    volatility_squeeze,
    retest_entry,
    failed_breakout_reversal,
    support_resistance_bounce,
    round_number_levels,
    engulfing,
    hammer_shooting_star,
    doji_confirmation,
    morning_evening_star,
    inside_bar_breakout,
    three_soldiers_crows,
    double_top_bottom,
    head_and_shoulders,
    triangle_wedge_breakout,
)
import ai_strategy

logger = logging.getLogger("signal_combiner")

STRATEGY_REGISTRY = [
    ("trend_following", trend_following.signal, config.USE_TREND_FOLLOWING),
    ("momentum", momentum.signal, config.USE_MOMENTUM),
    ("mean_reversion", mean_reversion.signal, config.USE_MEAN_REVERSION),
    ("swing_trading", swing_trading.signal, config.USE_SWING),
    ("scalping", scalping.signal, config.USE_SCALPING),
    ("stat_arbitrage", stat_arbitrage.signal, config.USE_STAT_ARBITRAGE),
    ("market_making_bias", market_making_bias.signal, config.USE_MARKET_MAKING_BIAS),
    ("breakout", breakout.signal, config.USE_BREAKOUT),
    ("ema_cross", ema_cross.signal, config.USE_EMA_CROSS),
    ("macd_cross", macd_cross.signal, config.USE_MACD_CROSS),
    ("adx_trend", adx_trend.signal, config.USE_ADX_TREND),
    ("stochastic_reversion", stochastic_reversion.signal, config.USE_STOCHASTIC_REVERSION),
    ("atr_channel_breakout", atr_channel_breakout.signal, config.USE_ATR_CHANNEL_BREAKOUT),
    ("supertrend", supertrend.signal, config.USE_SUPERTREND),
    ("parabolic_sar", parabolic_sar.signal, config.USE_PARABOLIC_SAR),
    ("ichimoku", ichimoku.signal, config.USE_ICHIMOKU),
    ("turtle_system", turtle_system.signal, config.USE_TURTLE_SYSTEM),
    ("buy_the_dip", buy_the_dip.signal, config.USE_BUY_THE_DIP),
    ("golden_death_cross", golden_death_cross.signal, config.USE_GOLDEN_DEATH_CROSS),
    ("rsi_reversion", rsi_reversion.signal, config.USE_RSI_REVERSION),
    ("connors_rsi2", connors_rsi2.signal, config.USE_CONNORS_RSI2),
    ("vwap_reversion", vwap_reversion.signal, config.USE_VWAP_REVERSION),
    ("cci_reversion", cci_reversion.signal, config.USE_CCI_REVERSION),
    ("williams_r_reversion", williams_r_reversion.signal, config.USE_WILLIAMS_R_REVERSION),
    ("volatility_squeeze", volatility_squeeze.signal, config.USE_VOLATILITY_SQUEEZE),
    ("retest_entry", retest_entry.signal, config.USE_RETEST_ENTRY),
    ("failed_breakout_reversal", failed_breakout_reversal.signal, config.USE_FAILED_BREAKOUT_REVERSAL),
    ("support_resistance_bounce", support_resistance_bounce.signal, config.USE_SUPPORT_RESISTANCE_BOUNCE),
    ("round_number_levels", round_number_levels.signal, config.USE_ROUND_NUMBER_LEVELS),
    ("engulfing", engulfing.signal, config.USE_ENGULFING),
    ("hammer_shooting_star", hammer_shooting_star.signal, config.USE_HAMMER_SHOOTING_STAR),
    ("doji_confirmation", doji_confirmation.signal, config.USE_DOJI_CONFIRMATION),
    ("morning_evening_star", morning_evening_star.signal, config.USE_MORNING_EVENING_STAR),
    ("inside_bar_breakout", inside_bar_breakout.signal, config.USE_INSIDE_BAR_BREAKOUT),
    ("three_soldiers_crows", three_soldiers_crows.signal, config.USE_THREE_SOLDIERS_CROWS),
    ("double_top_bottom", double_top_bottom.signal, config.USE_DOUBLE_TOP_BOTTOM),
    ("head_and_shoulders", head_and_shoulders.signal, config.USE_HEAD_AND_SHOULDERS),
    ("triangle_wedge_breakout", triangle_wedge_breakout.signal, config.USE_TRIANGLE_WEDGE_BREAKOUT),
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
