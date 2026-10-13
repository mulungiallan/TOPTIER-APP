"""
backtest.py
Minimal vectorized backtester for any strategy that returns a signal Series
(1/-1/0). Assumes a signal computed using data through bar t is acted on at
bar t+1's open (no lookahead), and applies basic slippage/commission.
"""
from __future__ import annotations
import numpy as np
import pandas as pd


def run_backtest(df: pd.DataFrame, signal: pd.Series, initial_equity=100_000,
                  commission_pct=0.0005, slippage_pct=0.0005):
    """
    df: OHLCV DataFrame.
    signal: Series of 1/-1/0 aligned to df.index (same convention used by
    every strategy in strategies/).
    Returns a DataFrame with equity curve and a dict of summary stats.
    """
    signal = signal.reindex(df.index).fillna(0)
    position = signal.shift(1).fillna(0)  # act on next bar's open
    entry_price = df["open"]

    daily_ret = df["close"].pct_change().fillna(0)
    strategy_ret = position * daily_ret

    trades = position.diff().fillna(0) != 0
    cost = trades * (commission_pct + slippage_pct)
    strategy_ret = strategy_ret - cost

    equity = (1 + strategy_ret).cumprod() * initial_equity
    running_max = equity.cummax()
    drawdown = (equity - running_max) / running_max

    stats = {
        "total_return_pct": (equity.iloc[-1] / initial_equity - 1) * 100,
        "annualized_sharpe": _sharpe(strategy_ret),
        "max_drawdown_pct": drawdown.min() * 100,
        "num_trades": int(trades.sum()),
        "win_rate_pct": _win_rate(strategy_ret, position),
    }
    result = pd.DataFrame({
        "close": df["close"],
        "position": position,
        "strategy_return": strategy_ret,
        "equity": equity,
        "drawdown_pct": drawdown * 100,
    })
    return result, stats


def _sharpe(returns: pd.Series, periods_per_year=252, risk_free=0.0):
    excess = returns - risk_free / periods_per_year
    std = excess.std()
    if std == 0 or np.isnan(std):
        return 0.0
    return float(np.sqrt(periods_per_year) * excess.mean() / std)


def _win_rate(returns: pd.Series, position: pd.Series):
    active = returns[position != 0]
    if len(active) == 0:
        return 0.0
    return float((active > 0).mean() * 100)
