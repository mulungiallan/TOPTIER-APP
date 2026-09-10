# Trading Signals Engine

A Python package that fetches market data (stocks, forex, crypto), computes
technical indicators, generates signals from 10 strategy families, backtests
them, and produces interactive charts — all exposed via a FastAPI JSON layer
you can embed in your app.

## Install

```bash
pip install -r requirements.txt
```

## Strategies implemented

| # | Strategy | Function |
|---|----------|----------|
| 1 | Trend following (MA crossover) | `strategies.trend_following` |
| 2 | Mean reversion (Bollinger + RSI) | `strategies.mean_reversion` |
| 3 | Momentum (rate of change) | `strategies.momentum` |
| 4 | Swing trading (EMA cross + RSI band) | `strategies.swing_trading` |
| 5 | Scalping (fast EMA cross + vol filter) | `strategies.scalping` |
| 6 | Statistical arbitrage (z-score proxy) | `strategies.stat_arbitrage` |
| 7 | Market making bias (fair-value deviation) | `strategies.market_making_bias` |
| 8 | Pairs trading (two-asset spread) | `strategies.pairs_trading` |
| 9 | Breakout (N-period high/low) | `strategies.breakout` |
| 10 | Carry trade (rate differential, FX) | `strategies.carry_trade` |

Strategies 1–7 and 9 share a single-asset interface and are run together by
`strategies.run_all_strategies()`, which also returns a `composite` (sum of
signals) and `consensus` (majority-vote -1/0/1) column. Pairs trading and
carry trade need extra inputs (a second asset, and interest rates
respectively) so call them directly.

## Quick start (CLI)

```bash
python -m trading_signals.main --market stock --symbol AAPL --period 1y --interval 1d
python -m trading_signals.main --market crypto --symbol BTC/USDT --interval 1h
python -m trading_signals.main --market forex --symbol EURUSD --period 1y --interval 1d
```

This prints the latest signal from every strategy, backtests the consensus
signal, and saves an interactive chart to `chart.html`.

## Quick start (API — for embedding in your app)

```bash
uvicorn trading_signals.api:app --reload --port 8000
```

Then:

```
GET /signals?market=stock&symbol=AAPL&period=6mo&interval=1d
GET /backtest?market=crypto&symbol=BTC/USDT&strategy=trend_following&interval=1h
GET /chart?market=forex&symbol=EURUSD&strategy=consensus
```

`/signals` returns JSON like:

```json
{
  "market": "stock",
  "symbol": "AAPL",
  "interval": "1d",
  "latest_price": 227.43,
  "as_of": "2026-09-09 00:00:00",
  "signals": {
    "trend_following": 1,
    "mean_reversion": 0,
    "momentum": 1,
    "swing_trading": 1,
    "scalping": -1,
    "stat_arbitrage": 0,
    "market_making_bias": 0,
    "breakout": 1,
    "composite": 3,
    "consensus": 1
  }
}
```

Your app can poll this endpoint, or call the Python functions directly if
it's also Python-based (see `main.py` for the pattern).

## Data sources

- **Stocks**: `yfinance` (free, delayed data — fine for signals, not for
  latency-sensitive execution)
- **Forex**: `yfinance` using tickers like `EURUSD=X`
- **Crypto**: `ccxt`, default exchange `binance` (swap `exchange_id` for
  others it supports)

## Important caveats — read before connecting real money

- **This is a signal/backtesting toolkit, not a guarantee of profit.**
  Every strategy here is a simplified, well-known template; real edge comes
  from tuning parameters to your specific asset/timeframe and from careful
  risk management, not from the strategy list itself.
- **Backtests are optimistic by default.** The included backtester assumes
  fills at the next bar's price with a flat fee — no slippage curve, no
  partial fills, no market-impact model. Live results will differ, often
  worse, especially for scalping/market-making at low fee assumptions.
- **Free data has gaps.** `yfinance` can silently return partial or stale
  data; always validate before trusting a signal, especially intraday.
- **Nothing here is financial advice.** Test extensively in a paper-trading
  or sandboxed environment before wiring signals to live order execution.
