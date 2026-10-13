"""
options_pricing.py
Black-Scholes pricing + Greeks, needed for strategies whose payoff depends on
TIME (calendar spreads, diagonals) rather than just terminal spot price, and
for computing a proper theoretical premium/IV anywhere the app needs one.
"""
from __future__ import annotations
import numpy as np
from scipy.stats import norm


def bs_price(spot, strike, t_years, rate, vol, opt_type="call", dividend=0.0):
    if t_years <= 0:
        return max(spot - strike, 0.0) if opt_type == "call" else max(strike - spot, 0.0)
    d1 = (np.log(spot / strike) + (rate - dividend + 0.5 * vol ** 2) * t_years) / (vol * np.sqrt(t_years))
    d2 = d1 - vol * np.sqrt(t_years)
    if opt_type == "call":
        return spot * np.exp(-dividend * t_years) * norm.cdf(d1) - strike * np.exp(-rate * t_years) * norm.cdf(d2)
    else:
        return strike * np.exp(-rate * t_years) * norm.cdf(-d2) - spot * np.exp(-dividend * t_years) * norm.cdf(-d1)


def bs_greeks(spot, strike, t_years, rate, vol, opt_type="call", dividend=0.0):
    if t_years <= 0:
        return {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
    d1 = (np.log(spot / strike) + (rate - dividend + 0.5 * vol ** 2) * t_years) / (vol * np.sqrt(t_years))
    d2 = d1 - vol * np.sqrt(t_years)
    pdf_d1 = norm.pdf(d1)
    if opt_type == "call":
        delta = np.exp(-dividend * t_years) * norm.cdf(d1)
        theta = (-spot * pdf_d1 * vol * np.exp(-dividend * t_years) / (2 * np.sqrt(t_years))
                 - rate * strike * np.exp(-rate * t_years) * norm.cdf(d2)
                 + dividend * spot * np.exp(-dividend * t_years) * norm.cdf(d1))
    else:
        delta = -np.exp(-dividend * t_years) * norm.cdf(-d1)
        theta = (-spot * pdf_d1 * vol * np.exp(-dividend * t_years) / (2 * np.sqrt(t_years))
                 + rate * strike * np.exp(-rate * t_years) * norm.cdf(-d2)
                 - dividend * spot * np.exp(-dividend * t_years) * norm.cdf(-d1))
    gamma = np.exp(-dividend * t_years) * pdf_d1 / (spot * vol * np.sqrt(t_years))
    vega = spot * np.exp(-dividend * t_years) * pdf_d1 * np.sqrt(t_years)
    return {"delta": delta, "gamma": gamma, "theta": theta / 365.0, "vega": vega / 100.0}


def implied_volatility(market_price, spot, strike, t_years, rate, opt_type="call", dividend=0.0,
                        tol=1e-6, max_iter=100):
    """Newton-Raphson solve for IV, used to compare market premium vs a
    forecast realized-vol model (#75 volatility arbitrage)."""
    vol = 0.3
    for _ in range(max_iter):
        price = bs_price(spot, strike, t_years, rate, vol, opt_type, dividend)
        vega = bs_greeks(spot, strike, t_years, rate, vol, opt_type, dividend)["vega"] * 100
        if vega < 1e-8:
            break
        diff = market_price - price
        if abs(diff) < tol:
            return vol
        vol += diff / vega
        vol = max(0.001, min(vol, 5.0))
    return vol


def calendar_spread_value(spot, strike, t_short_years, t_long_years, rate, vol, opt_type="call"):
    """
    Value of a calendar spread AT THE SHORT LEG'S EXPIRATION: the short option
    is worth its intrinsic value (it has expired), the long option still has
    (t_long - t_short) years remaining and is priced with Black-Scholes.
    This is strategy #63/#64's core valuation, which the at-expiry payoff
    engine in engines.py cannot represent.
    """
    short_value_at_expiry = max(spot - strike, 0.0) if opt_type == "call" else max(strike - spot, 0.0)
    remaining_t = t_long_years - t_short_years
    long_value = bs_price(spot, strike, remaining_t, rate, vol, opt_type)
    return long_value - short_value_at_expiry
