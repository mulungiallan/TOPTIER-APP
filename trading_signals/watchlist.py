"""
Watchlists: named groups of symbols, each with optional comma-separated tags
(e.g. "tech,growth"). A user can have multiple watchlists (e.g. "Core",
"Crypto watch", "Earnings this week").
"""

from __future__ import annotations
from . import db


def create_watchlist(name: str, user_id: str = "default") -> dict:
    try:
        wl_id = db.execute(
            "INSERT INTO watchlists (user_id, name) VALUES (?, ?)", (user_id, name)
        )
    except Exception as e:
        raise ValueError(f"Could not create watchlist '{name}': {e}")
    return get_watchlist(wl_id)


def list_watchlists(user_id: str = "default") -> list[dict]:
    watchlists = db.query_all(
        "SELECT * FROM watchlists WHERE user_id = ? ORDER BY created_at", (user_id,)
    )
    for wl in watchlists:
        wl["items"] = db.query_all(
            "SELECT * FROM watchlist_items WHERE watchlist_id = ? ORDER BY added_at", (wl["id"],)
        )
    return watchlists


def get_watchlist(watchlist_id: int) -> dict | None:
    wl = db.query_one("SELECT * FROM watchlists WHERE id = ?", (watchlist_id,))
    if not wl:
        return None
    wl["items"] = db.query_all(
        "SELECT * FROM watchlist_items WHERE watchlist_id = ? ORDER BY added_at", (watchlist_id,)
    )
    return wl


def add_symbol(watchlist_id: int, market: str, symbol: str, tags: str = "") -> dict:
    db.execute(
        "INSERT OR IGNORE INTO watchlist_items (watchlist_id, market, symbol, tags) VALUES (?, ?, ?, ?)",
        (watchlist_id, market, symbol.upper(), tags),
    )
    return get_watchlist(watchlist_id)


def remove_symbol(watchlist_id: int, market: str, symbol: str) -> dict:
    db.execute(
        "DELETE FROM watchlist_items WHERE watchlist_id = ? AND market = ? AND symbol = ?",
        (watchlist_id, market, symbol.upper()),
    )
    return get_watchlist(watchlist_id)


def delete_watchlist(watchlist_id: int) -> None:
    db.execute("DELETE FROM watchlists WHERE id = ?", (watchlist_id,))
