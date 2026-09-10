"""
FastAPI service exposing:
  GET /signals   -> latest signal per strategy + consensus, as JSON
  GET /backtest  -> performance stats for one strategy or the consensus
  GET /chart     -> interactive HTML chart with signal overlays

Run with:
    uvicorn trading_signals.api:app --reload --port 8000

Example:
    GET /signals?market=crypto&symbol=BTC/USDT&interval=1h
    GET /signals?market=stock&symbol=AAPL&period=6mo&interval=1d
    GET /signals?market=forex&symbol=EURUSD&period=6mo&interval=1d
    GET /backtest?market=stock&symbol=AAPL&strategy=trend_following
    GET /chart?market=stock&symbol=AAPL&strategy=consensus
"""

from __future__ import annotations
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
import pandas as pd

from . import data_fetcher as dfetch
from . import indicators as ind
from . import strategies as strat
from . import backtester as bt
from . import charting

app = FastAPI(title="Trading Signals API", version="0.1.0")


def _load(market: str, symbol: str, period: str, interval: str) -> pd.DataFrame:
    try:
        raw = dfetch.fetch_data(market=market, symbol=symbol, period=period, interval=interval)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ind.add_all_indicators(raw)


@app.get("/signals")
def get_signals(
    market: str = Query(..., description="stock | forex | crypto"),
    symbol: str = Query(..., description="e.g. AAPL, EURUSD, BTC/USDT"),
    period: str = Query("6mo", description="yfinance period, ignored for crypto"),
    interval: str = Query("1d", description="bar interval / ccxt timeframe"),
):
    df = _load(market, symbol, period, interval)
    signals = strat.run_all_strategies(df)
    latest = signals.iloc[-1].to_dict()
    latest_price = float(df["close"].iloc[-1])
    return {
        "market": market,
        "symbol": symbol,
        "interval": interval,
        "latest_price": latest_price,
        "as_of": str(df.index[-1]),
        "signals": latest,
    }


@app.get("/backtest")
def get_backtest(
    market: str = Query(...),
    symbol: str = Query(...),
    strategy: str = Query("consensus", description="strategy name or 'consensus'"),
    period: str = Query("6mo"),
    interval: str = Query("1d"),
    fee_bps: float = Query(5.0),
):
    df = _load(market, symbol, period, interval)
    signals = strat.run_all_strategies(df)
    if strategy not in signals.columns:
        raise HTTPException(status_code=400, detail=f"Unknown strategy '{strategy}'. Options: {list(signals.columns)}")
    result = bt.backtest_signal(df["close"], signals[strategy], fee_bps=fee_bps)
    summary = bt.performance_summary(result)
    return {"market": market, "symbol": symbol, "strategy": strategy, "performance": summary}


@app.get("/chart", response_class=HTMLResponse)
def get_chart(
    market: str = Query(...),
    symbol: str = Query(...),
    strategy: str = Query("consensus"),
    period: str = Query("6mo"),
    interval: str = Query("1d"),
):
    df = _load(market, symbol, period, interval)
    signals = strat.run_all_strategies(df)
    if strategy not in signals.columns:
        raise HTTPException(status_code=400, detail=f"Unknown strategy '{strategy}'. Options: {list(signals.columns)}")
    fig = charting.plot_signals(df, signals[strategy], title=f"{symbol} — {strategy}")
    return HTMLResponse(content=fig.to_html(include_plotlyjs="cdn"))


@app.get("/health")
def health():
    return {"status": "ok"}
