"""
trading_signals
---------------
Portable multi-strategy signal engine (file 9): fetches OHLCV data, computes
technical indicators, runs 10 strategy families, backtests them, and can
produce interactive charts. Exposed both as a Python API and a FastAPI layer
(api.py) that TOPTIER can embed or poll.
"""

from __future__ import annotations

from . import indicators
from . import strategies
from . import backtester
from . import charting
from . import data_fetcher

__all__ = [
    "indicators",
    "strategies",
    "backtester",
    "charting",
    "data_fetcher",
]