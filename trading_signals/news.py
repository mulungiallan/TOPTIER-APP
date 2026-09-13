"""
News feed and economic/earnings calendar.

News sources (no API key required):
  - stocks/forex -> yfinance's built-in Ticker.news
  - crypto       -> CryptoCompare's public news API

Economic calendar is pluggable: this ships with a Finnhub-backed
implementation (free tier API key) because it covers both earnings and
macro events in one place. Set FINNHUB_API_KEY as an environment variable
to enable it; without a key, get_economic_calendar() returns an empty list
with a clear note rather than failing, so the rest of your app keeps working.
"""

from __future__ import annotations
import os
from datetime import datetime, timedelta


def get_news(market: str, symbol: str, limit: int = 10) -> list[dict]:
    """
    Returns a list of {title, publisher, link, published_at} sorted newest first.
    """
    if market in ("stock", "forex"):
        return _get_yfinance_news(symbol, limit)
    elif market == "crypto":
        return _get_crypto_news(symbol, limit)
    else:
        raise ValueError(f"Unknown market '{market}'")


def _get_yfinance_news(symbol: str, limit: int) -> list[dict]:
    import yfinance as yf

    ticker_symbol = symbol if not symbol.endswith("=X") else symbol  # forex tickers already suffixed by caller if needed
    try:
        raw_items = yf.Ticker(ticker_symbol).news or []
    except Exception as e:
        return [{"error": f"Could not fetch news for '{symbol}': {e}"}]

    items = []
    for item in raw_items[:limit]:
        content = item.get("content", item)  # yfinance news schema has shifted across versions
        items.append(
            {
                "title": content.get("title") or item.get("title"),
                "publisher": (content.get("provider") or {}).get("displayName") if isinstance(content.get("provider"), dict) else item.get("publisher"),
                "link": (content.get("canonicalUrl") or {}).get("url") if isinstance(content.get("canonicalUrl"), dict) else item.get("link"),
                "published_at": content.get("pubDate") or item.get("providerPublishTime"),
            }
        )
    return items


def _get_crypto_news(symbol: str, limit: int) -> list[dict]:
    import requests

    coin = symbol.split("/")[0]  # 'BTC/USDT' -> 'BTC'
    try:
        resp = requests.get(
            "https://min-api.cryptocompare.com/data/v2/news/",
            params={"categories": coin, "excludeCategories": "Sponsored"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json().get("Data", [])
    except Exception as e:
        return [{"error": f"Could not fetch crypto news for '{symbol}': {e}"}]

    items = []
    for item in data[:limit]:
        items.append(
            {
                "title": item.get("title"),
                "publisher": item.get("source_info", {}).get("name"),
                "link": item.get("url"),
                "published_at": item.get("published_on"),
            }
        )
    return items


def get_economic_calendar(days_ahead: int = 7) -> list[dict]:
    """
    Macro economic events (CPI, Fed decisions, jobs reports, etc.) for the
    next `days_ahead` days. Requires FINNHUB_API_KEY (free tier at
    finnhub.io). Returns an empty list with a 'note' if no key is set.
    """
    api_key = os.environ.get("FINNHUB_API_KEY")
    if not api_key:
        return [{"note": "Set FINNHUB_API_KEY environment variable to enable the economic calendar."}]

    import requests

    today = datetime.utcnow().date()
    end = today + timedelta(days=days_ahead)
    try:
        resp = requests.get(
            "https://finnhub.io/api/v1/calendar/economic",
            params={"from": today.isoformat(), "to": end.isoformat(), "token": api_key},
            timeout=10,
        )
        resp.raise_for_status()
        events = resp.json().get("economicCalendar", [])
    except Exception as e:
        return [{"error": f"Could not fetch economic calendar: {e}"}]

    return [
        {
            "event": e.get("event"),
            "country": e.get("country"),
            "time": e.get("time"),
            "actual": e.get("actual"),
            "estimate": e.get("estimate"),
            "previous": e.get("prev"),
            "impact": e.get("impact"),
        }
        for e in events
    ]


def get_earnings_calendar(symbol: str | None = None, days_ahead: int = 30) -> list[dict]:
    """
    Upcoming earnings dates. If symbol is given, filters to that ticker;
    otherwise requires FINNHUB_API_KEY for the broad market calendar.
    Single-symbol lookups use yfinance and need no API key.
    """
    if symbol:
        import yfinance as yf

        try:
            cal = yf.Ticker(symbol).calendar
            if not cal:
                return []
            earnings_dates = cal.get("Earnings Date", [])
            return [{"symbol": symbol, "earnings_date": str(d)} for d in earnings_dates]
        except Exception as e:
            return [{"error": f"Could not fetch earnings date for '{symbol}': {e}"}]

    api_key = os.environ.get("FINNHUB_API_KEY")
    if not api_key:
        return [{"note": "Set FINNHUB_API_KEY environment variable to enable the broad earnings calendar."}]

    import requests

    today = datetime.utcnow().date()
    end = today + timedelta(days=days_ahead)
    try:
        resp = requests.get(
            "https://finnhub.io/api/v1/calendar/earnings",
            params={"from": today.isoformat(), "to": end.isoformat(), "token": api_key},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("earningsCalendar", [])
    except Exception as e:
        return [{"error": f"Could not fetch earnings calendar: {e}"}]
