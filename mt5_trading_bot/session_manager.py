"""
session_manager.py
---------------------
Determines the current trading session (Asian / London / NY / off-hours,
by server/broker time -- i.e. the machine's local clock the bot runs on)
and returns which strategies are allowed to vote during that session.
This is an ADDITIONAL filter on top of the backtest filter and the
volatility matching -- a strategy needs to clear all three to vote on a
given scan: backtest-approved for that (symbol, timeframe), suited to the
symbol's current volatility bucket, AND active in the current session.
"""

import logging
from datetime import datetime

import config

logger = logging.getLogger("session_manager")


def get_current_session() -> str:
    hour = datetime.now().hour

    def _in_window(h, start, end):
        if start <= end:
            return start <= h < end
        return h >= start or h < end  # window crosses midnight

    if _in_window(hour, config.SESSION_LONDON_START_HOUR, config.SESSION_LONDON_END_HOUR):
        return "LONDON"
    if _in_window(hour, config.SESSION_NY_START_HOUR, config.SESSION_NY_END_HOUR):
        return "NY"
    if _in_window(hour, config.SESSION_ASIAN_START_HOUR, config.SESSION_ASIAN_END_HOUR):
        return "ASIAN"
    return "OFF_HOURS"


def get_allowed_strategies_for_session() -> list:
    if not config.USE_SESSION_STRATEGY_FILTER:
        return None  # None means "no session restriction" to the caller
    session = get_current_session()
    return config.SESSION_STRATEGIES.get(session, [])
