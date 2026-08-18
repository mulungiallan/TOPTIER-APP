"""
trade_frequency.py
----------------------
Implements the SOFT daily trade-frequency target. Tracks how many trades
the bot has opened so far today against the pace needed to hit
config.DAILY_TRADE_TARGET within config.TRADE_TARGET_WINDOW_HOURS. If
it's falling behind pace, it progressively lowers the effective
MIN_VOTES_TO_TRADE (down to RELAXATION_FLOOR_MIN_VOTES, never below 1) --
widening what counts as a tradeable signal. It never invents a trade with
zero strategy agreement; on a genuinely quiet day it will fall short of
the target rather than gamble to hit a number.
"""

import csv
import os
import logging
from datetime import datetime, timezone

import config

logger = logging.getLogger("trade_frequency")

_day_start = None
_relaxation_level = 0


def _count_trades_today() -> int:
    """Counts trades opened today by reading both the closed-trade log and the pending-trades file."""
    count = 0
    today = datetime.now(timezone.utc).date()

    if os.path.exists(config.TRADE_LOG_FILE):
        with open(config.TRADE_LOG_FILE, "r", newline="") as f:
            for row in csv.DictReader(f):
                try:
                    open_time = datetime.fromisoformat(row["open_time"])
                    if open_time.date() == today:
                        count += 1
                except (KeyError, ValueError):
                    continue

    import json
    if os.path.exists(config.PENDING_TRADES_FILE):
        try:
            with open(config.PENDING_TRADES_FILE, "r") as f:
                pending = json.load(f)
            for trade in pending.values():
                open_time = datetime.fromisoformat(trade["open_time"])
                if open_time.date() == today:
                    count += 1
        except (json.JSONDecodeError, OSError, KeyError, ValueError):
            pass

    return count


def _reset_if_new_day():
    global _day_start, _relaxation_level
    today = datetime.now(timezone.utc).date()
    if _day_start != today:
        _day_start = today
        _relaxation_level = 0
        logger.info("New trading day -- trade-frequency relaxation level reset to 0.")


def update_relaxation_level():
    """Call periodically (config.RELAXATION_CHECK_EVERY_N_SCANS). Widens the net if behind pace."""
    global _relaxation_level

    if not config.USE_TRADE_FREQUENCY_TARGET:
        return

    _reset_if_new_day()

    now = datetime.now(timezone.utc)
    hours_elapsed = (now - datetime.combine(_day_start, datetime.min.time(), tzinfo=timezone.utc)).total_seconds() / 3600
    hours_elapsed = max(hours_elapsed, 0.01)

    if hours_elapsed >= config.TRADE_TARGET_WINDOW_HOURS:
        return  # window's over for today, no point relaxing further

    expected_by_now = config.DAILY_TRADE_TARGET * (hours_elapsed / config.TRADE_TARGET_WINDOW_HOURS)
    actual = _count_trades_today()

    max_relaxation = config.MIN_VOTES_TO_TRADE - config.RELAXATION_FLOOR_MIN_VOTES
    if actual < expected_by_now and _relaxation_level < max_relaxation:
        _relaxation_level += 1
        logger.info(
            f"Trade pace check: {actual} trades vs ~{expected_by_now:.1f} expected by now. "
            f"Widening net -- relaxation level now {_relaxation_level} "
            f"(effective MIN_VOTES_TO_TRADE = {get_effective_min_votes()})."
        )
    elif actual >= expected_by_now and _relaxation_level > 0:
        _relaxation_level = max(0, _relaxation_level - 1)
        logger.info(f"Trade pace check: back on pace ({actual} trades). Tightening net -- relaxation level now {_relaxation_level}.")


def get_effective_min_votes() -> int:
    """Returns the current effective MIN_VOTES_TO_TRADE after any relaxation."""
    if not config.USE_TRADE_FREQUENCY_TARGET:
        return config.MIN_VOTES_TO_TRADE
    return max(config.RELAXATION_FLOOR_MIN_VOTES, config.MIN_VOTES_TO_TRADE - _relaxation_level)


def get_status() -> dict:
    _reset_if_new_day()
    return {
        "trades_today": _count_trades_today(),
        "target": config.DAILY_TRADE_TARGET,
        "relaxation_level": _relaxation_level,
        "effective_min_votes": get_effective_min_votes(),
    }
