"""
engines.py
Reusable "engines" that many of the 100 strategies are built from. Rather than
writing 100 independent signal functions from scratch, most strategies are
thin configurations of one of these engines. See strategies/ for the mapping.

Signal convention used throughout this app:
    1  = long / buy
   -1  = short / sell
    0  = flat / no position
Signals are point-in-time (no lookahead): a signal computed using data through
bar t is assumed to be actable at bar t+1's open in the backtester.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
import indicators as ind


# ---------------------------------------------------------------------------
# 1. Crossover engine  (moving averages, MACD/signal, Tenkan/Kijun, price/SAR,
#    price/Supertrend ... anything of the form "series A crosses series B")
# ---------------------------------------------------------------------------
def crossover_signal(series_a: pd.Series, series_b: pd.Series) -> pd.Series:
    """+1 when A crosses above B, -1 when A crosses below B, else carries
    forward the last signal (i.e. stays in position until the opposite cross)."""
    diff = series_a - series_b
    cross_up = (diff > 0) & (diff.shift(1) <= 0)
    cross_down = (diff < 0) & (diff.shift(1) >= 0)
    signal = pd.Series(np.nan, index=series_a.index)
    signal[cross_up] = 1
    signal[cross_down] = -1
    return signal.ffill().fillna(0)


# ---------------------------------------------------------------------------
# 2. Oscillator mean-reversion engine (RSI, Stochastic, CCI, Williams %R, ...)
#    Covers strategies #16, 17, 19, 25, 26.
# ---------------------------------------------------------------------------
def oscillator_reversion_signal(
    osc: pd.Series, low_th: float, high_th: float, exit_mid: float | None = None
) -> pd.Series:
    """
    Long when the oscillator crosses back ABOVE low_th from below (i.e. was
    oversold and is recovering). Short when it crosses back BELOW high_th
    from above. Optionally flattens at exit_mid (e.g. RSI=50).
    """
    was_below = osc.shift(1) < low_th
    cross_up = was_below & (osc >= low_th)
    was_above = osc.shift(1) > high_th
    cross_down = was_above & (osc <= high_th)

    signal = pd.Series(np.nan, index=osc.index)
    signal[cross_up] = 1
    signal[cross_down] = -1
    signal = signal.ffill().fillna(0)

    if exit_mid is not None:
        long_exit = (signal == 1) & (osc >= exit_mid)
        short_exit = (signal == -1) & (osc <= exit_mid)
        signal = signal.mask(long_exit | short_exit, 0).replace(0, np.nan)
        signal[cross_up] = 1
        signal[cross_down] = -1
        signal = signal.ffill().fillna(0)
    return signal


# ---------------------------------------------------------------------------
# 3. Band/channel breakout & reversion engine (Bollinger, Donchian, Keltner,
#    opening range, support/resistance channels). Covers #5, 18, 29-31.
# ---------------------------------------------------------------------------
def band_breakout_signal(close: pd.Series, upper: pd.Series, lower: pd.Series) -> pd.Series:
    """+1 when close breaks above upper band, -1 when it breaks below lower band."""
    long_e = close > upper.shift(1)
    short_e = close < lower.shift(1)
    signal = pd.Series(np.nan, index=close.index)
    signal[long_e] = 1
    signal[short_e] = -1
    return signal.ffill().fillna(0)


def band_reversion_signal(close: pd.Series, upper: pd.Series, lower: pd.Series, mid: pd.Series) -> pd.Series:
    """+1 when price touches/crosses below the lower band (buy the dip back
    to the mean), -1 at the upper band, flat once price reaches mid."""
    long_e = close < lower
    short_e = close > upper
    signal = pd.Series(np.nan, index=close.index)
    signal[long_e] = 1
    signal[short_e] = -1
    signal = signal.ffill().fillna(0)
    long_exit = (signal == 1) & (close >= mid)
    short_exit = (signal == -1) & (close <= mid)
    signal = signal.mask(long_exit | short_exit, 0)
    return signal


# ---------------------------------------------------------------------------
# 4. Z-score / spread engine (mean reversion, pairs trading, yield spreads).
#    Covers #20, 21, 22, 28, 92.
# ---------------------------------------------------------------------------
def zscore_signal(z: pd.Series, entry: float = 2.0, exit: float = 0.0, stop: float | None = 3.5) -> pd.Series:
    """
    Long when z < -entry, short when z > +entry, flat when |z| <= exit.
    Optional hard stop: force-flat if |z| > stop (relationship may have broken).
    """
    signal = pd.Series(0.0, index=z.index)
    position = 0
    out = []
    for val in z:
        if pd.isna(val):
            out.append(position)
            continue
        if stop is not None and abs(val) > stop:
            position = 0
        elif position == 0:
            if val < -entry:
                position = 1
            elif val > entry:
                position = -1
        elif position == 1 and val >= -exit:
            position = 0
        elif position == -1 and val <= exit:
            position = 0
        out.append(position)
    return pd.Series(out, index=z.index)


def pair_spread(price_a: pd.Series, price_b: pd.Series, lookback: int = 60):
    """OLS hedge ratio (beta) estimated on a rolling window, spread = A - beta*B."""
    log_a, log_b = np.log(price_a), np.log(price_b)
    cov = log_a.rolling(lookback).cov(log_b)
    var = log_b.rolling(lookback).var()
    beta = cov / var.replace(0, np.nan)
    spread = log_a - beta * log_b
    return spread, beta


# ---------------------------------------------------------------------------
# 5. Volume / trend confirmation filters. Covers #4, 38 (used to gate other
#    engines' signals rather than generate signals themselves).
# ---------------------------------------------------------------------------
def volume_confirms(volume: pd.Series, lookback: int = 20, mult: float = 1.5) -> pd.Series:
    avg_vol = volume.rolling(lookback).mean()
    return volume > (avg_vol * mult)


def trend_filter_adx(df: pd.DataFrame, period: int = 14, threshold: float = 25.0):
    a = ind.adx(df, period)
    is_trending = a["adx"] > threshold
    direction = np.where(a["plus_di"] > a["minus_di"], 1, -1)
    return is_trending, pd.Series(direction, index=df.index)


def apply_filter(signal: pd.Series, gate: pd.Series) -> pd.Series:
    """Zero out a signal wherever gate is False."""
    return signal.where(gate, 0)


# ---------------------------------------------------------------------------
# 6. Generic multi-leg options payoff engine. Covers ALL of strategies 49-66.
# ---------------------------------------------------------------------------
class OptionLeg:
    def __init__(self, opt_type: str, strike: float, premium: float, qty: int = 1, side: str = "long"):
        assert opt_type in ("call", "put")
        assert side in ("long", "short")
        self.opt_type = opt_type
        self.strike = strike
        self.premium = premium
        self.qty = qty
        self.side = side

    def payoff_at_expiry(self, spot: np.ndarray) -> np.ndarray:
        if self.opt_type == "call":
            intrinsic = np.maximum(spot - self.strike, 0.0)
        else:
            intrinsic = np.maximum(self.strike - spot, 0.0)
        sign = 1 if self.side == "long" else -1
        premium_flow = -self.premium if self.side == "long" else self.premium
        return sign * intrinsic * self.qty + premium_flow * self.qty


class OptionsStrategy:
    """
    A generic container for any multi-leg options strategy (covered call,
    spreads, straddles, condors, butterflies, calendars-at-expiry-of-front-leg,
    ratio spreads, etc.). Build the specific 49-66 strategies by passing the
    right list of OptionLeg (+ optional underlying shares) into this class.
    """

    def __init__(self, legs: list[OptionLeg], shares: int = 0, share_cost: float | None = None):
        self.legs = legs
        self.shares = shares
        self.share_cost = share_cost

    def payoff(self, spot_range: np.ndarray) -> np.ndarray:
        total = np.zeros_like(spot_range, dtype=float)
        for leg in self.legs:
            total += leg.payoff_at_expiry(spot_range)
        if self.shares and self.share_cost is not None:
            total += self.shares * (spot_range - self.share_cost)
        return total

    def max_profit(self, spot_range: np.ndarray) -> float:
        return float(np.max(self.payoff(spot_range)))

    def max_loss(self, spot_range: np.ndarray) -> float:
        return float(np.min(self.payoff(spot_range)))

    def breakevens(self, spot_range: np.ndarray) -> list[float]:
        payoff = self.payoff(spot_range)
        sign_changes = np.where(np.diff(np.sign(payoff)) != 0)[0]
        breakevens = []
        for i in sign_changes:
            x0, x1 = spot_range[i], spot_range[i + 1]
            y0, y1 = payoff[i], payoff[i + 1]
            if y1 != y0:
                breakevens.append(x0 - y0 * (x1 - x0) / (y1 - y0))
        return breakevens


# Convenience builders for the 18 named options strategies (#49-66) ---------
def covered_call(stock_cost, call_strike, call_premium, shares=100):
    return OptionsStrategy([OptionLeg("call", call_strike, call_premium, side="short")],
                            shares=shares, share_cost=stock_cost)

def protective_put(stock_cost, put_strike, put_premium, shares=100):
    return OptionsStrategy([OptionLeg("put", put_strike, put_premium, side="long")],
                            shares=shares, share_cost=stock_cost)

def collar(stock_cost, put_strike, put_premium, call_strike, call_premium, shares=100):
    return OptionsStrategy([
        OptionLeg("put", put_strike, put_premium, side="long"),
        OptionLeg("call", call_strike, call_premium, side="short"),
    ], shares=shares, share_cost=stock_cost)

def long_call(strike, premium):
    return OptionsStrategy([OptionLeg("call", strike, premium, side="long")])

def long_put(strike, premium):
    return OptionsStrategy([OptionLeg("put", strike, premium, side="long")])

def bull_call_spread(low_strike, low_prem, high_strike, high_prem):
    return OptionsStrategy([
        OptionLeg("call", low_strike, low_prem, side="long"),
        OptionLeg("call", high_strike, high_prem, side="short"),
    ])

def bear_put_spread(high_strike, high_prem, low_strike, low_prem):
    return OptionsStrategy([
        OptionLeg("put", high_strike, high_prem, side="long"),
        OptionLeg("put", low_strike, low_prem, side="short"),
    ])

def bear_call_spread(low_strike, low_prem, high_strike, high_prem):
    return OptionsStrategy([
        OptionLeg("call", low_strike, low_prem, side="short"),
        OptionLeg("call", high_strike, high_prem, side="long"),
    ])

def bull_put_spread(high_strike, high_prem, low_strike, low_prem):
    return OptionsStrategy([
        OptionLeg("put", high_strike, high_prem, side="short"),
        OptionLeg("put", low_strike, low_prem, side="long"),
    ])

def iron_condor(put_long_strike, put_long_prem, put_short_strike, put_short_prem,
                call_short_strike, call_short_prem, call_long_strike, call_long_prem):
    return OptionsStrategy([
        OptionLeg("put", put_long_strike, put_long_prem, side="long"),
        OptionLeg("put", put_short_strike, put_short_prem, side="short"),
        OptionLeg("call", call_short_strike, call_short_prem, side="short"),
        OptionLeg("call", call_long_strike, call_long_prem, side="long"),
    ])

def iron_butterfly(center_strike, put_prem, call_prem, wing_put_strike, wing_put_prem,
                    wing_call_strike, wing_call_prem):
    return OptionsStrategy([
        OptionLeg("put", center_strike, put_prem, side="short"),
        OptionLeg("call", center_strike, call_prem, side="short"),
        OptionLeg("put", wing_put_strike, wing_put_prem, side="long"),
        OptionLeg("call", wing_call_strike, wing_call_prem, side="long"),
    ])

def long_straddle(strike, call_prem, put_prem):
    return OptionsStrategy([
        OptionLeg("call", strike, call_prem, side="long"),
        OptionLeg("put", strike, put_prem, side="long"),
    ])

def long_strangle(call_strike, call_prem, put_strike, put_prem):
    return OptionsStrategy([
        OptionLeg("call", call_strike, call_prem, side="long"),
        OptionLeg("put", put_strike, put_prem, side="long"),
    ])

def short_straddle(strike, call_prem, put_prem):
    return OptionsStrategy([
        OptionLeg("call", strike, call_prem, side="short"),
        OptionLeg("put", strike, put_prem, side="short"),
    ])

def short_strangle(call_strike, call_prem, put_strike, put_prem):
    return OptionsStrategy([
        OptionLeg("call", call_strike, call_prem, side="short"),
        OptionLeg("put", put_strike, put_prem, side="short"),
    ])

def cash_secured_put(strike, premium):
    return OptionsStrategy([OptionLeg("put", strike, premium, side="short")])

def ratio_spread(long_strike, long_prem, short_strike, short_prem, short_qty=2):
    return OptionsStrategy([
        OptionLeg("call", long_strike, long_prem, qty=1, side="long"),
        OptionLeg("call", short_strike, short_prem, qty=short_qty, side="short"),
    ])

# calendar_spread and diagonal_spread need two expiries and time-value (theta)
# decay, which the at-expiry payoff engine above can't represent -- they
# require a pricing model (e.g. Black-Scholes) evaluated at the front-month
# expiry date. See options_pricing.py for that model.


# ---------------------------------------------------------------------------
# 7. Position sizing module. Covers #6 (Turtle ATR sizing), #85, #86 (Kelly).
# ---------------------------------------------------------------------------
def atr_position_size(account_equity: float, risk_pct: float, atr_value: float, dollars_per_point: float = 1.0) -> float:
    """Turtle-style: size so that a 1-ATR move costs risk_pct of equity."""
    dollar_risk = account_equity * risk_pct
    if atr_value <= 0 or np.isnan(atr_value):
        return 0.0
    return dollar_risk / (atr_value * dollars_per_point)


def kelly_fraction(win_prob: float, win_loss_ratio: float, kelly_scale: float = 0.5) -> float:
    """kelly_scale=0.5 -> 'half-Kelly', a common practical safety discount."""
    f_star = win_prob - (1 - win_prob) / win_loss_ratio
    return max(0.0, f_star) * kelly_scale


def martingale_size(base_size: float, consecutive_losses: int, multiplier: float = 2.0, max_doublings: int = 4) -> float:
    n = min(consecutive_losses, max_doublings)
    return base_size * (multiplier ** n)


def anti_martingale_size(base_size: float, consecutive_wins: int, multiplier: float = 1.5, max_scaleups: int = 4) -> float:
    n = min(consecutive_wins, max_scaleups)
    return base_size * (multiplier ** n)
