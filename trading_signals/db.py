"""
Lightweight SQLite persistence layer shared by portfolio, orders, alerts,
and watchlists. SQLite is used (not an external DB) so the package works
out of the box when embedded in a mobile/desktop app; swap get_connection()
for a Postgres/MySQL connection later without touching calling code, since
every other module only ever calls execute()/query_all()/query_one().

All tables are scoped by `user_id` (default "default") so the same package
can back a single-user app or a multi-user backend.
"""

from __future__ import annotations
import sqlite3
import os
from contextlib import contextmanager
from typing import Any, Iterable

DB_PATH = os.environ.get("TRADING_APP_DB", os.path.join(os.path.dirname(__file__), "trading_app.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS watchlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS watchlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
    market TEXT NOT NULL,
    symbol TEXT NOT NULL,
    tags TEXT DEFAULT '',
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(watchlist_id, market, symbol)
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    market TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,                 -- 'buy' | 'sell'
    order_type TEXT NOT NULL,           -- 'market'|'limit'|'stop'|'stop_limit'|'trailing_stop'
    quantity REAL NOT NULL,
    limit_price REAL,
    stop_price REAL,
    trail_amount REAL,                  -- absolute trailing distance, for trailing_stop
    oco_group_id TEXT,                  -- shared id links two OCO orders
    status TEXT NOT NULL DEFAULT 'open',-- 'open'|'filled'|'cancelled'|'rejected'
    filled_price REAL,
    filled_at TEXT,
    fee REAL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    order_id INTEGER REFERENCES orders(id),
    market TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fee REAL DEFAULT 0,
    executed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    market TEXT NOT NULL,
    symbol TEXT NOT NULL,
    condition_type TEXT NOT NULL,       -- 'price_above'|'price_below'|'indicator'
    field TEXT NOT NULL DEFAULT 'close',-- 'close'|'rsi_14'|'sma_20'... for indicator alerts
    comparator TEXT NOT NULL DEFAULT '>',-- '>' | '<'
    threshold REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- 'active'|'triggered'|'cancelled'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    triggered_at TEXT,
    triggered_value REAL,
    note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS risk_settings (
    user_id TEXT PRIMARY KEY,
    max_daily_loss_pct REAL DEFAULT 3.0,
    max_position_pct REAL DEFAULT 20.0,
    default_risk_per_trade_pct REAL DEFAULT 1.0,
    account_equity REAL DEFAULT 10000.0,
    trading_halted_until TEXT
);

-- Double-entry ledger: every movement of value is TWO entries (a debit and a
-- credit) that must sum to zero across the transaction. This is the same
-- pattern banks/exchanges use because it makes money impossible to silently
-- create or destroy through a bug — the books either balance or they don't.

CREATE TABLE IF NOT EXISTS ledger_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    asset TEXT NOT NULL,               -- 'USD', 'BTC', 'ETH', etc.
    account_type TEXT NOT NULL,        -- 'user' (a user's balance) or 'house' (platform-side clearing/fee account)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, asset, account_type)
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_type TEXT NOT NULL,             -- 'deposit'|'withdrawal'|'transfer'|'trade_settlement'|'fee'
    reference TEXT,                    -- external id: bank transfer id, on-chain tx hash, order id, etc.
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'posted'|'failed'|'reversed'
    memo TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    posted_at TEXT
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES ledger_transactions(id),
    account_id INTEGER NOT NULL REFERENCES ledger_accounts(id),
    amount REAL NOT NULL,               -- positive = credit (increases balance), negative = debit
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crypto_deposit_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    asset TEXT NOT NULL,                -- 'BTC', 'ETH', 'USDT-ERC20', etc.
    address TEXT NOT NULL UNIQUE,
    provider_ref TEXT,                  -- id the custody provider uses for this address/sub-account
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(SCHEMA)


@contextmanager
def cursor():
    conn = get_connection()
    try:
        cur = conn.cursor()
        yield cur
        conn.commit()
    finally:
        conn.close()


def execute(sql: str, params: Iterable[Any] = ()) -> int:
    """Run an INSERT/UPDATE/DELETE, return lastrowid."""
    with cursor() as cur:
        cur.execute(sql, params)
        return cur.lastrowid


def query_all(sql: str, params: Iterable[Any] = ()) -> list[dict]:
    with cursor() as cur:
        cur.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


def query_one(sql: str, params: Iterable[Any] = ()) -> dict | None:
    with cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return dict(row) if row else None


# Initialize on import so callers never have to remember to do it.
init_db()
