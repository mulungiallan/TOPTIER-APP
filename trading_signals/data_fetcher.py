"""
Unified market data fetcher.

Supports:
  - stocks  -> yfinance
  - forex   -> yfinance (pairs like "EURUSD=X")
  - crypto  -> ccxt (any exchange it supports, default binance)

All fetchers return a pandas DataFrame with columns:
  ['open', 'high', 'low', 'close', 'volume'] indexed by UTC datetime.
"""

from __future__ import annotations
import pandas as pd
from typing import Literal

MarketType = Literal["stock", "forex", "crypto"]


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns={c: c.lower() for c in df.columns})
    keep = [c for c in ["open", "high", "low", "close", "volume"] if c in df.columns]
    df = df[keep].copy()
    df.index.name = "timestamp"
    return df.dropna()


def fetch_stock(symbol: str, period: str = "6mo", interval: str = "1d") -> pd.DataFrame:
    """Fetch stock OHLCV data via yfinance. e.g. symbol='AAPL'."""
    import yfinance as yf

    df = yf.download(symbol, period=period, interval=interval, progress=False, auto_adjust=True)
    if df.empty:
        raise ValueError(f"No stock data returned for '{symbol}'. Check the ticker/period/interval.")
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]
    return _normalize_columns(df)


def fetch_forex(pair: str, period: str = "6mo", interval: str = "1d") -> pd.DataFrame:
    """Fetch forex OHLCV data via yfinance. e.g. pair='EURUSD' -> queries 'EURUSD=X'."""
    import yfinance as yf

    symbol = pair if pair.endswith("=X") else f"{pair}=X"
    df = yf.download(symbol, period=period, interval=interval, progress=False, auto_adjust=True)
    if df.empty:
        raise ValueError(f"No forex data returned for '{pair}'. Check the pair/period/interval.")
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]
    return _normalize_columns(df)


def fetch_crypto(
    symbol: str = "BTC/USDT",
    timeframe: str = "1h",
    limit: int = 500,
    exchange_id: str = "binance",
) -> pd.DataFrame:
    """Fetch crypto OHLCV data via ccxt. e.g. symbol='BTC/USDT'."""
    import ccxt

    exchange_class = getattr(ccxt, exchange_id)
    exchange = exchange_class({"enableRateLimit": True})
    raw = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    if not raw:
        raise ValueError(f"No crypto data returned for '{symbol}' on {exchange_id}.")
    df = pd.DataFrame(raw, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df = df.set_index("timestamp")
    return df


def fetch_data(
    market: MarketType,
    symbol: str,
    period: str = "6mo",
    interval: str = "1d",
    exchange_id: str = "binance",
    crypto_limit: int = 500,
) -> pd.DataFrame:
    """
    Single entry point.

    market='stock'  -> symbol e.g. 'AAPL', period/interval as yfinance accepts
                        (e.g. period='6mo', interval='1d'/'1h'/'15m')
    market='forex'  -> symbol e.g. 'EURUSD', same period/interval rules
    market='crypto' -> symbol e.g. 'BTC/USDT', interval is used as the ccxt
                        timeframe (e.g. '1h', '4h', '1d'), crypto_limit controls
                        number of candles
    """
    if market == "stock":
        return fetch_stock(symbol, period=period, interval=interval)
    elif market == "forex":
        return fetch_forex(symbol, period=period, interval=interval)
    elif market == "crypto":
        return fetch_crypto(symbol, timeframe=interval, limit=crypto_limit, exchange_id=exchange_id)
    else:
        raise ValueError(f"Unknown market type: {market}")
