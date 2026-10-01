"""Backtest the strategy in R-multiples with the same daily stops the live bot uses.

    python backtest.py --csv EURUSD_M15.csv --symbol EURUSD --risk 0.25
    python backtest.py --mt5 EURUSD --bars 60000          (Windows + MT5 terminal)
    python backtest.py --synthetic                         (smoke test only; results are meaningless)

CSV columns: time,open,high,low,close   (time in UTC, M15 bars)
Fill model: entry at next bar's open plus spread, SL checked before TP inside a bar (pessimistic).
Reports the numbers that matter for prop rules: worst day, max drawdown, and the MINIMUM number of
profitable days (>= 0.25%) over any rolling 30 days (Zero needs 7).
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import timedelta

import numpy as np
import pandas as pd

from strategy import StrategyParams, compute_indicators, signal_at

SPREADS = {"EURUSD": 0.00010, "GBPUSD": 0.00012, "USDJPY": 0.010, "XAUUSD": 0.25,
           "AUDUSD": 0.00012, "USDCAD": 0.00015, "USDCHF": 0.00015, "NZDUSD": 0.00015}


def simulate(df: pd.DataFrame, spread: float, p: StrategyParams, risk_pct: float,
             profit_stop=0.6, loss_stop=0.5, max_consec=3, session=(7 * 60, 16 * 60 + 30),
             flatten=19 * 60 + 30, max_hold=24, cooldown_bars=2):
    times = pd.DatetimeIndex(pd.to_datetime(df["time"], utc=True))
    o, h, l, c = (df[k].to_numpy(float) for k in ("open", "high", "low", "close"))
    ind = compute_indicators(o, h, l, c, p)
    minutes = times.hour * 60 + times.minute
    wd = times.weekday
    days = [t.date() for t in (times + pd.Timedelta(hours=3))]
    n = len(df)
    day_pnl, consec, trades = defaultdict(float), defaultdict(int), []
    i = p.warmup
    while i < n - 2:
        dk = days[i]
        if (wd[i] >= 5 or not (session[0] <= minutes[i] < session[1]) or day_pnl[dk] >= profit_stop
                or day_pnl[dk] <= -loss_stop or consec[dk] >= max_consec):
            i += 1
            continue
        d, a = signal_at(ind, i, p)
        if d == 0 or spread > p.max_spread_atr * a:
            i += 1
            continue
        dist = p.sl_atr * a
        e_open = o[i + 1]
        if d == 1:
            entry = e_open + spread
            sl, tp = entry - dist, entry + p.rr * dist
        else:
            entry = e_open
            sl, tp = entry + dist, entry - p.rr * dist
        end = min(n - 1, i + 1 + max_hold)
        j, exit_px = i + 1, None
        while j <= end:
            hit_sl = (l[j] <= sl) if d == 1 else (h[j] + spread >= sl)
            hit_tp = (h[j] >= tp) if d == 1 else (l[j] + spread <= tp)
            if hit_sl:
                exit_px = sl
                break
            if hit_tp:
                exit_px = tp
                break
            if minutes[j] >= flatten or j == end:
                exit_px = c[j] if d == 1 else c[j] + spread
                break
            j += 1
        r = (exit_px - entry) / dist if d == 1 else (entry - exit_px) / dist
        pnl = r * risk_pct
        day_pnl[days[j]] += pnl
        consec[days[j]] = consec[days[j]] + 1 if r < 0 else 0
        trades.append((times[j], r, pnl))
        i = j + cooldown_bars
    return trades, day_pnl


def report(trades, day_pnl, risk_pct, label=""):
    if not trades:
        print(f"{label}: no trades")
        return None
    r = np.array([t[1] for t in trades])
    pnl = np.array([t[2] for t in trades])
    wins, losses = r[r > 0].sum(), -r[r < 0].sum()
    eq = np.cumsum(pnl)
    dd = (np.maximum.accumulate(np.concatenate(([0], eq))) - np.concatenate(([0], eq))).max()
    s = pd.Series(day_pnl).sort_index()
    idx = pd.date_range(s.index.min(), s.index.max())
    s = s.reindex(idx, fill_value=0.0)
    prof = (s >= 0.25).astype(int)
    roll = prof.rolling(30).sum().dropna()
    months = max(len(s) / 30.4, 1e-9)
    out = {
        "trades": len(r), "trades/month": len(r) / months, "win%": (r > 0).mean() * 100,
        "avg R": r.mean(), "profit factor": wins / losses if losses else float("inf"),
        "total %": pnl.sum(), "%/month": pnl.sum() / months, "max DD %": dd,
        "worst day %": s.min(), "best day %": s.max(),
        "min prof-days/30d": int(roll.min()) if len(roll) else None,
        "avg prof-days/30d": float(roll.mean()) if len(roll) else None,
    }
    print(f"--- {label} (risk {risk_pct}%/trade) ---")
    for k, v in out.items():
        print(f"  {k:>20}: {v:,.2f}" if isinstance(v, float) else f"  {k:>20}: {v}")
    return out


def synthetic(bars=52000, seed=7) -> pd.DataFrame:
    """Regime-switching random walk. Only for checking the code runs."""
    rng = np.random.default_rng(seed)
    t = pd.date_range("2024-01-01", periods=bars, freq="15min", tz="UTC")
    drift = np.zeros(bars)
    k = 0
    while k < bars:
        L = int(rng.integers(300, 2500))
        drift[k:k + L] = rng.choice([-1, 0, 1]) * 0.00002
        k += L
    ret = drift + rng.normal(0, 0.0007, bars)
    close = 1.10 * np.exp(np.cumsum(ret))
    op = np.concatenate(([close[0]], close[:-1]))
    hi = np.maximum(op, close) + np.abs(rng.normal(0, 0.0003, bars))
    lo = np.minimum(op, close) - np.abs(rng.normal(0, 0.0003, bars))
    return pd.DataFrame({"time": t, "open": op, "high": hi, "low": lo, "close": close})


def load_mt5(symbol, bars):
    import MetaTrader5 as mt5
    if not mt5.initialize():
        raise SystemExit(f"MT5 init failed: {mt5.last_error()}")
    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M15, 0, bars)
    mt5.shutdown()
    df = pd.DataFrame(rates)
    df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)   # server time; fine for stats
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    ap.add_argument("--mt5")
    ap.add_argument("--bars", type=int, default=60000)
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--symbol", default="EURUSD")
    ap.add_argument("--spread", type=float, help="price units; default per symbol")
    ap.add_argument("--risk", type=float, default=0.25)
    ap.add_argument("--rr", type=float)
    ap.add_argument("--sl-atr", type=float)
    a = ap.parse_args()

    p = StrategyParams()
    if a.rr:
        p.rr = a.rr
    if a.sl_atr:
        p.sl_atr = a.sl_atr
    if a.synthetic:
        df, sym = synthetic(), a.symbol
    elif a.mt5:
        df, sym = load_mt5(a.mt5, a.bars), a.mt5
    elif a.csv:
        df, sym = pd.read_csv(a.csv), a.symbol
    else:
        ap.error("give --csv, --mt5 or --synthetic")
    spread = a.spread if a.spread is not None else SPREADS.get(sym.upper()[:6], 0.0001)
    trades, day_pnl = simulate(df, spread, p, a.risk)
    report(trades, day_pnl, a.risk, sym)


if __name__ == "__main__":
    main()
