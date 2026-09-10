"""
CLI demo: fetch data, run all strategies, backtest the consensus signal,
and save a chart — all in one command.

Usage:
    python -m trading_signals.main --market stock --symbol AAPL --period 1y --interval 1d
    python -m trading_signals.main --market crypto --symbol BTC/USDT --interval 1h
    python -m trading_signals.main --market forex --symbol EURUSD --period 1y --interval 1d
"""

from __future__ import annotations
import argparse
import json

from . import data_fetcher as dfetch
from . import indicators as ind
from . import strategies as strat
from . import backtester as bt
from . import charting


def main():
    parser = argparse.ArgumentParser(description="Multi-strategy trading signal generator")
    parser.add_argument("--market", required=True, choices=["stock", "forex", "crypto"])
    parser.add_argument("--symbol", required=True, help="e.g. AAPL, EURUSD, BTC/USDT")
    parser.add_argument("--period", default="6mo", help="yfinance period (ignored for crypto)")
    parser.add_argument("--interval", default="1d", help="bar interval / ccxt timeframe")
    parser.add_argument("--strategy", default="consensus", help="strategy to backtest/chart")
    parser.add_argument("--out-html", default="chart.html", help="output path for chart HTML")
    args = parser.parse_args()

    print(f"Fetching {args.market} data for {args.symbol}...")
    raw = dfetch.fetch_data(market=args.market, symbol=args.symbol, period=args.period, interval=args.interval)
    df = ind.add_all_indicators(raw)

    print("Running all strategies...")
    signals = strat.run_all_strategies(df)
    latest = signals.iloc[-1].to_dict()
    print("\nLatest signals:")
    print(json.dumps(latest, indent=2, default=float))

    if args.strategy not in signals.columns:
        print(f"\nUnknown strategy '{args.strategy}'. Options: {list(signals.columns)}")
        return

    print(f"\nBacktesting '{args.strategy}'...")
    result = bt.backtest_signal(df["close"], signals[args.strategy])
    summary = bt.performance_summary(result)
    print(json.dumps(summary, indent=2, default=float))

    print(f"\nSaving chart to {args.out_html}...")
    charting.plot_signals(df, signals[args.strategy], title=f"{args.symbol} — {args.strategy}", out_html=args.out_html)
    print("Done.")


if __name__ == "__main__":
    main()
