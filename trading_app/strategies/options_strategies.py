"""
Strategies #49-66 -- Options Strategies.
Unlike the price-signal strategies elsewhere, these don't return a time
series signal -- they return an engines.OptionsStrategy object that the app's
options module can price, chart (payoff diagram), and check margin/risk on.
Each function's job is just to assemble the right legs; engines.py's generic
payoff/breakeven math (and options_pricing.py's Black-Scholes for the two
time-dependent spreads) does the actual work.
"""
import sys, os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import engines as eng
import options_pricing as opx


def s49_covered_call(stock_cost, call_strike, call_premium, shares=100):
    return eng.covered_call(stock_cost, call_strike, call_premium, shares)


def s50_protective_put(stock_cost, put_strike, put_premium, shares=100):
    return eng.protective_put(stock_cost, put_strike, put_premium, shares)


def s51_collar(stock_cost, put_strike, put_premium, call_strike, call_premium, shares=100):
    return eng.collar(stock_cost, put_strike, put_premium, call_strike, call_premium, shares)


def s52_long_call(strike, premium):
    return eng.long_call(strike, premium)


def s53_long_put(strike, premium):
    return eng.long_put(strike, premium)


def s54_bull_call_spread(low_strike, low_prem, high_strike, high_prem):
    return eng.bull_call_spread(low_strike, low_prem, high_strike, high_prem)


def s55_bear_put_spread(high_strike, high_prem, low_strike, low_prem):
    return eng.bear_put_spread(high_strike, high_prem, low_strike, low_prem)


def s56_bear_call_spread(low_strike, low_prem, high_strike, high_prem):
    return eng.bear_call_spread(low_strike, low_prem, high_strike, high_prem)


def s57_bull_put_spread(high_strike, high_prem, low_strike, low_prem):
    return eng.bull_put_spread(high_strike, high_prem, low_strike, low_prem)


def s58_iron_condor(put_long, put_long_prem, put_short, put_short_prem,
                     call_short, call_short_prem, call_long, call_long_prem):
    return eng.iron_condor(put_long, put_long_prem, put_short, put_short_prem,
                            call_short, call_short_prem, call_long, call_long_prem)


def s59_iron_butterfly(center_strike, put_prem, call_prem, wing_put_strike, wing_put_prem,
                        wing_call_strike, wing_call_prem):
    return eng.iron_butterfly(center_strike, put_prem, call_prem, wing_put_strike,
                               wing_put_prem, wing_call_strike, wing_call_prem)


def s60_long_straddle(strike, call_prem, put_prem):
    return eng.long_straddle(strike, call_prem, put_prem)


def s61_long_strangle(call_strike, call_prem, put_strike, put_prem):
    return eng.long_strangle(call_strike, call_prem, put_strike, put_prem)


def s62_short_straddle_strangle(strike_or_call, call_prem, put_strike_or_prem, put_prem=None):
    if put_prem is None:
        return eng.short_straddle(strike_or_call, call_prem, put_strike_or_prem)
    return eng.short_strangle(strike_or_call, call_prem, put_strike_or_prem, put_prem)


def s63_calendar_spread(spot, strike, t_short_years, t_long_years, rate, vol, opt_type="call"):
    """Time-dependent -- returns the spread's theoretical value at the SHORT
    leg's expiry (see options_pricing.calendar_spread_value), not a static
    payoff-at-expiry diagram like the strategies above."""
    return opx.calendar_spread_value(spot, strike, t_short_years, t_long_years, rate, vol, opt_type)


def s64_diagonal_spread(spot, short_strike, long_strike, t_short_years, t_long_years, rate, vol, opt_type="call"):
    short_intrinsic = max(spot - short_strike, 0.0) if opt_type == "call" else max(short_strike - spot, 0.0)
    remaining_t = t_long_years - t_short_years
    long_value = opx.bs_price(spot, long_strike, remaining_t, rate, vol, opt_type)
    return long_value - short_intrinsic


def s65_cash_secured_put(strike, premium):
    return eng.cash_secured_put(strike, premium)


def s66_ratio_spread(long_strike, long_prem, short_strike, short_prem, short_qty=2):
    return eng.ratio_spread(long_strike, long_prem, short_strike, short_prem, short_qty)
