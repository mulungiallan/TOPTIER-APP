"""
trading_signals
---------------
Portable multi-strategy signal engine: fetches OHLCV data, computes technical
indicators, runs 10 strategy families, backtests them, and produces interactive
charts — plus a full trading-app backend (orders, portfolio, alerts, risk,
watchlists, news) and double-entry-ledger wallets (cash + crypto, with
swappable payment/custody providers). Exposed both as a Python API and a
FastAPI layer (api.py) that TOPTIER can embed or poll.
"""

from __future__ import annotations

from . import indicators
from . import strategies
from . import backtester
from . import charting
from . import data_fetcher
from . import db
from . import orders
from . import portfolio
from . import alerts
from . import risk
from . import watchlist
from . import news
from . import ledger
from . import payment_provider
from . import custody_provider
from . import cash_wallet
from . import crypto_wallet

__all__ = [
    "indicators",
    "strategies",
    "backtester",
    "charting",
    "data_fetcher",
    "db",
    "orders",
    "portfolio",
    "alerts",
    "risk",
    "watchlist",
    "news",
    "ledger",
    "payment_provider",
    "custody_provider",
    "cash_wallet",
    "crypto_wallet",
]