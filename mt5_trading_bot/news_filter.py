"""
news_filter.py
-----------------
Blocks new trade entries on a symbol around high-impact news events for
either of its two currencies (e.g. EURUSD is blocked around high-impact
USD or EUR news). Pulls a free public calendar feed used widely by retail
EAs. If the feed is unreachable, behavior is controlled by
config.NEWS_FAIL_OPEN (default: allow trading rather than silently stop
the bot because a third-party feed happened to be down).

This is a best-effort filter, not a guarantee -- free calendar feeds can
be delayed, incomplete, or occasionally wrong. Treat it as one more risk
control layered on top of the others, not a substitute for being aware of
major scheduled events yourself.
"""

import logging
from datetime import datetime, timedelta, timezone

import requests

import config

logger = logging.getLogger("news_filter")

_cached_events = []
_cache_time = None

_IMPACT_RANK = {"Low": 1, "Medium": 2, "High": 3}


def _refresh_cache_if_needed():
    global _cached_events, _cache_time
    now = datetime.now(timezone.utc)
    if _cache_time is not None and (now - _cache_time).total_seconds() < config.NEWS_CACHE_REFRESH_MINUTES * 60:
        return

    try:
        resp = requests.get(config.NEWS_CALENDAR_URL, timeout=10)
        resp.raise_for_status()
        _cached_events = resp.json()
        _cache_time = now
        logger.info(f"News calendar refreshed: {len(_cached_events)} events loaded.")
    except Exception as e:
        logger.warning(f"Could not refresh news calendar ({e}). "
                        f"{'Failing open (trading allowed).' if config.NEWS_FAIL_OPEN else 'Failing closed (trading blocked).'}")
        # Keep whatever was cached before; if nothing was ever cached, _cached_events stays []


def _currencies_for_symbol(symbol: str) -> set:
    """EURUSD -> {'EUR', 'USD'}. Strips any broker suffix like '.a' first."""
    base_symbol = symbol.split(".")[0].upper()
    if len(base_symbol) < 6:
        return set()
    return {base_symbol[:3], base_symbol[3:6]}


def is_news_blackout(symbol: str) -> bool:
    """
    Returns True if `symbol` should NOT be traded right now because a
    high-impact event for one of its currencies is within the configured
    before/after window.
    """
    if not config.USE_NEWS_FILTER:
        return False

    _refresh_cache_if_needed()
    if not _cached_events:
        return not config.NEWS_FAIL_OPEN  # no data: fail open (False) or fail closed (True) per config

    relevant_currencies = _currencies_for_symbol(symbol)
    if not relevant_currencies:
        return False

    now = datetime.now(timezone.utc)
    min_rank = _IMPACT_RANK.get(config.NEWS_MIN_IMPACT, 3)
    before = timedelta(minutes=config.NEWS_BLACKOUT_MINUTES_BEFORE)
    after = timedelta(minutes=config.NEWS_BLACKOUT_MINUTES_AFTER)

    for event in _cached_events:
        try:
            currency = event.get("country", "")
            impact = event.get("impact", "")
            if currency not in relevant_currencies:
                continue
            if _IMPACT_RANK.get(impact, 0) < min_rank:
                continue

            event_time = datetime.fromisoformat(event["date"].replace("Z", "+00:00"))
            if event_time.tzinfo is None:
                event_time = event_time.replace(tzinfo=timezone.utc)

            if (event_time - before) <= now <= (event_time + after):
                logger.info(f"{symbol}: news blackout active ({currency} {impact} event at {event_time.isoformat()}).")
                return True
        except (KeyError, ValueError, TypeError):
            continue  # malformed entry in the feed, skip it rather than fail the whole check

    return False
