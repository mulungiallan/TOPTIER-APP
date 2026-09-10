"""
Lightweight vectorized backtester for single-asset signal series.

Not a substitute for an execution-realistic backtest (no slippage model
beyond a flat fee/spread assumption, no partial fills, no order book) —
intended for quickly comparing strategies on historical data.
"""

from __future__ import annotations
import numpy as np
import pandas as pd


def backtest_signal(
    close: pd.Series,
    signal: pd.Series,
    fee_bps: float = 5.0,
    shift_signal: bool = True,
) -> pd.DataFrame:
    """
    close: price series
    signal: series of -1/0/1, same index as close
    fee_bps: round-trip cost in basis points charged whenever position changes
    shift_signal: if True, trades execute on the *next* bar after a signal
                  (avoids lookahead bias). Keep True unless you've already shifted.
    """
    sig = signal.shift(1) if shift_signal else signal
    sig = sig.fillna(0)

    returns = close.pct_change().fillna(0)
    strat_returns = sig * returns

    position_change = sig.diff().abs().fillna(0)
    fee = (fee_bps / 10000.0) * position_change
    strat_returns_net = strat_returns - fee

    equity_curve = (1 + strat_returns_net).cumprod()
    buy_hold_curve = (1 + returns).cumprod()

    return pd.DataFrame(
        {
            "signal": sig,
            "returns": returns,
            "strategy_returns": strat_returns_net,
            "equity_curve": equity_curve,
            "buy_hold_curve": buy_hold_curve,
        }
    )


def performance_summary(bt: pd.DataFrame, periods_per_year: int = 252) -> dict:
    """Compute standard performance stats from a backtest_signal() result."""
    r = bt["strategy_returns"]
    n = len(r)
    if n == 0 or r.std() == 0:
        return {"error": "Not enough data or zero variance in returns."}

    total_return = bt["equity_curve"].iloc[-1] - 1
    annualized_return = (1 + total_return) ** (periods_per_year / n) - 1
    annualized_vol = r.std() * np.sqrt(periods_per_year)
    sharpe = (r.mean() * periods_per_year) / annualized_vol if annualized_vol > 0 else 0.0

    equity = bt["equity_curve"]
    running_max = equity.cummax()
    drawdown = (equity - running_max) / running_max
    max_drawdown = drawdown.min()

    wins = (r > 0).sum()
    losses = (r < 0).sum()
    win_rate = wins / (wins + losses) if (wins + losses) > 0 else 0.0

    buy_hold_total_return = bt["buy_hold_curve"].iloc[-1] - 1

    return {
        "total_return_pct": round(total_return * 100, 2),
        "annualized_return_pct": round(annualized_return * 100, 2),
        "annualized_vol_pct": round(annualized_vol * 100, 2),
        "sharpe_ratio": round(sharpe, 2),
        "max_drawdown_pct": round(max_drawdown * 100, 2),
        "win_rate_pct": round(win_rate * 100, 2),
        "buy_hold_return_pct": round(buy_hold_total_return * 100, 2),
        "num_periods": n,
    }
