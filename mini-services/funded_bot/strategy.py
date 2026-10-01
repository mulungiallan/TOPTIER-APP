"""M15 trend-pullback strategy. Pure numpy, no look-ahead (all indicators are causal).

Idea: trade only WITH a clean multi-timeframe-style trend (EMA50 > EMA200 > EMA800 on M15),
and enter when RSI dips into oversold/overbought territory and turns back. Stop = 1.5 ATR,
target = 1.5R. It has NO guaranteed edge: run backtest.py and forward-test on demo first.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class StrategyParams:
    ema_fast: int = 50
    ema_slow: int = 200
    ema_trend: int = 800
    rsi_n: int = 14
    rsi_long: float = 40.0
    rsi_short: float = 60.0
    atr_n: int = 14
    sl_atr: float = 1.5
    rr: float = 1.5
    max_spread_atr: float = 0.15     # skip if spread > 15% of ATR

    @property
    def warmup(self) -> int:
        return self.ema_trend + 20


def ema(x: np.ndarray, n: int) -> np.ndarray:
    a = 2.0 / (n + 1)
    out = np.empty(len(x), dtype=float)
    out[0] = x[0]
    for i in range(1, len(x)):
        out[i] = a * x[i] + (1 - a) * out[i - 1]
    return out


def wilder(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    if len(x) < n:
        return out
    out[n - 1] = x[:n].mean()
    for i in range(n, len(x)):
        out[i] = (out[i - 1] * (n - 1) + x[i]) / n
    return out


def rsi(c: np.ndarray, n: int) -> np.ndarray:
    d = np.diff(c, prepend=c[0])
    up, dn = np.where(d > 0, d, 0.0), np.where(d < 0, -d, 0.0)
    au, ad = wilder(up, n), wilder(dn, n)
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = au / ad
        out = 100 - 100 / (1 + rs)
    out[(ad == 0) & (au > 0)] = 100.0
    return out


def atr(h: np.ndarray, l: np.ndarray, c: np.ndarray, n: int) -> np.ndarray:
    pc = np.concatenate(([c[0]], c[:-1]))
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    return wilder(tr, n)


def compute_indicators(o, h, l, c, p: StrategyParams) -> dict:
    o, h, l, c = (np.asarray(a, dtype=float) for a in (o, h, l, c))
    return {
        "c": c,
        "ema_f": ema(c, p.ema_fast),
        "ema_s": ema(c, p.ema_slow),
        "ema_t": ema(c, p.ema_trend),
        "rsi": rsi(c, p.rsi_n),
        "atr": atr(h, l, c, p.atr_n),
    }


def signal_at(ind: dict, i: int, p: StrategyParams):
    """Decision made on the CLOSE of bar i. Returns (direction, atr) with direction in {+1,-1,0}."""
    if i < p.warmup:
        return 0, float("nan")
    ef, es, et = ind["ema_f"][i], ind["ema_s"][i], ind["ema_t"][i]
    r0, r1, a, c = ind["rsi"][i - 1], ind["rsi"][i], ind["atr"][i], ind["c"][i]
    if np.isnan(r0) or np.isnan(r1) or np.isnan(a) or a <= 0:
        return 0, float("nan")
    slope_up = ind["ema_s"][i] > ind["ema_s"][i - 10]
    slope_dn = ind["ema_s"][i] < ind["ema_s"][i - 10]
    if ef > es > et and slope_up and c > es and r0 < p.rsi_long <= r1:
        return 1, a
    if ef < es < et and slope_dn and c < es and r0 > p.rsi_short >= r1:
        return -1, a
    return 0, float("nan")
