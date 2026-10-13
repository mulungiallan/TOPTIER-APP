# Trading Strategies App — Code Base

A working Python implementation of all 100 strategies from the reference doc,
built as ~10 reusable engines rather than 100 copy-pasted scripts.

## Structure

```
trading_app/
├── indicators.py        # ~20 technical indicators (RSI, MACD, Bollinger, ATR, ADX, etc.)
├── engines.py            # Reusable signal engines: crossover, oscillator-reversion,
│                          # breakout, Z-score/pairs, options payoff calculator, position sizing
├── patterns.py            # Candlestick + chart pattern detectors (pivot-based)
├── options_pricing.py     # Black-Scholes pricing/Greeks/IV, for time-dependent options strategies
├── backtest.py             # Vectorized backtester (equity curve, Sharpe, drawdown, win rate)
├── example.py              # Runnable demo — `python example.py`
├── strategies/
│   ├── __init__.py         # REGISTRY dict mapping "01_ma_crossover" etc. -> function
│   ├── trend_momentum.py       # #1-15
│   ├── mean_reversion.py       # #16-28
│   ├── breakout_range.py       # #29-38
│   ├── chart_patterns.py       # #39-48
│   ├── options_strategies.py   # #49-66
│   ├── arbitrage.py            # #67-75
│   ├── quant_systematic.py     # #76-86
│   ├── fundamental_macro.py    # #87-94
│   └── seasonal_niche.py       # #95-100
└── requirements.txt
```

## Quick start

```bash
pip install -r requirements.txt
python example.py
```

This generates synthetic OHLCV data, lists all 100 registered strategies,
backtests 7 representative ones, and prices an Iron Condor.

## Using a strategy in your own code

Most strategies (trend, mean-reversion, breakout, patterns) share one interface:

```python
from strategies import get_strategy
from backtest import run_backtest
import pandas as pd

df = pd.read_csv("your_ohlcv.csv", index_col=0, parse_dates=True)  # columns: open, high, low, close, volume

signal = get_strategy("16_rsi_reversion")(df, period=14, low_th=30, high_th=70)
result, stats = run_backtest(df, signal)
print(stats)
```

Signal convention everywhere: `1` = long, `-1` = short, `0` = flat.

## Strategies with different interfaces

Not everything is a single-asset price signal — check each module's
docstring, but roughly:

| Category | Signature | Why |
|---|---|---|
| Options (#49-66) | Returns an `engines.OptionsStrategy` object, not a time series | Payoff depends on strikes/premiums, priced across a spot range, not on historical bars |
| Portfolio-level (#11, 13, 22, 76, 77, 92, 96) | Takes a **wide** DataFrame (columns = assets/tickers) | Cross-sectional ranking/allocation, not single-asset timing |
| Arbitrage (#67-75) | Takes external market data as explicit args (deal terms, multi-venue prices, rates) | This library implements the decision math; it does not fetch this data for you |
| Fundamental/Macro (#87-94) | Takes a `fundamentals`/`macro_data` DataFrame you supply | Needs financial-statement / economic-release data from an external provider |
| Execution algos (#80, 81) | Takes an order size, returns a slicing schedule | Not a directional signal at all |
| Position sizing (#85, 86) | Takes trade history / win-rate stats, returns a position size | Sizing layer, applied on top of any signal |

## Not realistically implementable as an app feature

`strategies/quant_systematic.py::s79_hft_latency_arbitrage_note()` raises
`NotImplementedError` deliberately. True HFT/latency arbitrage needs exchange
co-location and sub-millisecond infrastructure no application layer can
provide — it's included in the registry only for completeness. Similarly,
`s78_market_making` and `s74_etf_arbitrage_monitor` are flagged in their
docstrings as simulation/monitoring-only, not live-tradable as built.

## Before trading any of this with real money

1. **Backtest thoroughly** on real historical data with realistic
   commission/slippage (see `backtest.py`'s `commission_pct`/`slippage_pct`
   params) — the demo uses synthetic random-walk data, which has no
   real edge to find by construction.
2. **Walk-forward validate** anything in `quant_systematic.py::s82_ml_signal_trading`
   — in-sample fit on ML models here will look great and mean nothing.
3. **Cap risk explicitly** before enabling `s84_grid_trading` or
   `s85_martingale_sizing` live — both have unbounded/exponential downside
   if the safety guards described in their docstrings are removed.
4. This code is an engineering scaffold, not investment advice, and nothing
   here is a guarantee that any strategy is profitable.

## Extending

To add a new strategy: write a function `fn(df, **params) -> pd.Series`
(or the appropriate alternate signature above) in the relevant category
file, then register it in `strategies/__init__.py`'s `REGISTRY` dict. If it
reuses existing math, build it from `engines.py`/`indicators.py` rather than
re-deriving formulas — that's the whole point of the shared-engine structure.
