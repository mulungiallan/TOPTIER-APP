"""
example.py
Runnable demo:
  1. Generates synthetic daily OHLCV data (swap this for a real data feed).
  2. Lists all 100 registered strategies.
  3. Runs a handful of representative price-signal strategies through the
     backtester and prints results.
  4. Prices one options strategy (Iron Condor) and prints its payoff summary.

Run:  python example.py
"""
import numpy as np
import pandas as pd

from strategies import REGISTRY, list_strategies, get_strategy
from backtest import run_backtest


def make_synthetic_ohlcv(n=1000, start_price=100.0, seed=42):
    rng = np.random.default_rng(seed)
    returns = rng.normal(0.0003, 0.012, n)
    close = start_price * np.cumprod(1 + returns)
    dates = pd.bdate_range("2021-01-01", periods=n)
    high = close * (1 + np.abs(rng.normal(0, 0.005, n)))
    low = close * (1 - np.abs(rng.normal(0, 0.005, n)))
    open_ = close * (1 + rng.normal(0, 0.003, n))
    volume = rng.integers(1_000_000, 5_000_000, n)
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=dates)


def main():
    df = make_synthetic_ohlcv()

    print("=" * 70)
    print(f"Registered strategies: {len(REGISTRY)}")
    print("=" * 70)
    for key in list_strategies():
        print(f"  {key}")

    print("\n" + "=" * 70)
    print("BACKTESTS -- representative price-signal strategies")
    print("=" * 70)
    to_test = [
        ("01_ma_crossover", dict(fast=10, slow=50)),
        ("05_donchian_breakout", dict(period=20)),
        ("09_supertrend", dict(period=10, multiplier=3.0)),
        ("16_rsi_reversion", dict(period=14, low_th=30, high_th=70)),
        ("18_bollinger_reversion", dict(period=20, num_std=2.0)),
        ("20_zscore_reversion", dict(period=20, entry=2.0)),
        ("29_range_breakout", dict(period=20)),
    ]
    for key, params in to_test:
        fn = get_strategy(key)
        signal = fn(df, **params)
        result, stats = run_backtest(df, signal)
        print(f"\n{key}  params={params}")
        for k, v in stats.items():
            print(f"    {k}: {v:.2f}" if isinstance(v, float) else f"    {k}: {v}")

    print("\n" + "=" * 70)
    print("OPTIONS EXAMPLE -- Iron Condor (#58) payoff summary")
    print("=" * 70)
    condor = get_strategy("58_iron_condor")(
        put_long=90, put_long_prem=1.0,
        put_short=95, put_short_prem=2.0,
        call_short=105, call_short_prem=2.0,
        call_long=110, call_long_prem=1.0,
    )
    spot_range = np.linspace(70, 130, 2000)
    print(f"  Max profit: {condor.max_profit(spot_range):.2f}")
    print(f"  Max loss:   {condor.max_loss(spot_range):.2f}")
    print(f"  Breakevens: {[round(b, 2) for b in condor.breakevens(spot_range)]}")


if __name__ == "__main__":
    main()
