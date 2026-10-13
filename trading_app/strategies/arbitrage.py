"""
Strategies #67-75 -- Arbitrage & Relative Value.
Several of these need external data feeds this app doesn't generate itself
(deal terms, multi-exchange order books, bond fundamentals). Each function
documents exactly what feed/interface it expects so you can plug in a real
data provider later; the math/decision logic itself is fully implemented.
"""
import numpy as np
import pandas as pd
import sys, os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import engines as eng
import indicators as ind


def s67_merger_arbitrage(target_price: pd.Series, deal_price: float, completion_prob: pd.Series = None):
    """
    target_price: the target company's trading price over time.
    deal_price: the announced acquisition price (cash deal) or an equivalent
    stock-deal value series if it's a stock-for-stock deal.
    completion_prob: optional externally-supplied estimate of deal-completion
    probability (0-1) per bar, e.g. from a prediction-market or analyst feed.
    Returns the arb spread (%) and a simple signal: long the spread whenever
    it's wide enough to compensate for completion risk.
    """
    spread_pct = (deal_price - target_price) / target_price * 100
    if completion_prob is None:
        completion_prob = pd.Series(0.9, index=target_price.index)  # naive default
    expected_value_pct = spread_pct * completion_prob - (spread_pct * (1 - completion_prob))
    signal = (expected_value_pct > 0).astype(int)
    return spread_pct, signal


def s68_convertible_bond_arbitrage(bond_price: pd.Series, stock_price: pd.Series,
                                    conversion_ratio: float, delta: pd.Series):
    """
    delta: the convertible's equity delta (from an external convertible
    pricing model -- not derived here, since convert pricing needs a
    dedicated model beyond plain Black-Scholes). Returns the short-stock
    hedge ratio to run alongside a static long-bond position.
    """
    hedge_shares = delta * conversion_ratio
    return hedge_shares  # short this many shares per bond held, rebalanced as delta changes


def s69_index_arbitrage(index_level: pd.Series, futures_price: pd.Series, rate: float,
                         dividend_yield: float, t_years: pd.Series):
    fair_value = index_level * np.exp((rate - dividend_yield) * t_years)
    mispricing = futures_price - fair_value
    signal = pd.Series(0, index=index_level.index)
    signal[mispricing > 0] = -1  # futures rich -> sell futures / buy basket
    signal[mispricing < 0] = 1   # futures cheap -> buy futures / sell basket
    return mispricing, signal


def s70_triangular_arbitrage(rate_ab: pd.Series, rate_bc: pd.Series, rate_ac: pd.Series, cost_bps: float = 2.0):
    """rate_ab * rate_bc should equal rate_ac if no arbitrage. Flags where the
    discrepancy exceeds the assumed round-trip transaction cost (cost_bps)."""
    implied_ac = rate_ab * rate_bc
    discrepancy_pct = (implied_ac - rate_ac) / rate_ac * 100
    tradable = discrepancy_pct.abs() * 100 > cost_bps
    return discrepancy_pct, tradable


def s71_cross_exchange_arbitrage(price_venue_a: pd.Series, price_venue_b: pd.Series,
                                  fee_pct: float = 0.2, transfer_cost_pct: float = 0.1):
    spread_pct = (price_venue_b - price_venue_a) / price_venue_a * 100
    total_cost_pct = fee_pct * 2 + transfer_cost_pct
    signal = pd.Series(0, index=price_venue_a.index)
    signal[spread_pct > total_cost_pct] = 1    # buy A, sell B
    signal[-spread_pct > total_cost_pct] = -1  # buy B, sell A
    return spread_pct, signal


def s72_carry_trade(rate_high: pd.Series, rate_low: pd.Series, fx_price: pd.Series,
                     stop_loss_pct: float = 5.0):
    """
    fx_price: exchange rate of the high-yield currency vs the funding currency.
    Returns daily carry return (rate differential / 365) and a stop-triggered
    flag if the adverse FX move exceeds accumulated carry.
    """
    daily_carry = (rate_high - rate_low) / 365.0
    fx_ret_pct = fx_price.pct_change() * 100
    cum_carry = daily_carry.cumsum()
    cum_fx = fx_ret_pct.cumsum()
    stopped_out = (cum_fx + cum_carry) < -stop_loss_pct
    return daily_carry, stopped_out


def s73_futures_calendar_arbitrage(near_price: pd.Series, far_price: pd.Series, rate: float,
                                    t_near: pd.Series, t_far: pd.Series, spot: pd.Series):
    fair_spread = spot * (np.exp(rate * t_far) - np.exp(rate * t_near))
    actual_spread = far_price - near_price
    mispricing = actual_spread - fair_spread
    signal = pd.Series(0, index=near_price.index)
    signal[mispricing > 0] = -1  # spread too wide -> sell far/buy near
    signal[mispricing < 0] = 1
    return mispricing, signal


def s74_etf_arbitrage_monitor(etf_price: pd.Series, nav: pd.Series, threshold_pct: float = 0.5):
    """
    Retail apps typically can't execute creation/redemption directly (that
    requires Authorized Participant status) -- implemented here as a
    monitoring/alert feature: flags premium/discount beyond threshold_pct.
    """
    premium_discount_pct = (etf_price - nav) / nav * 100
    alert = premium_discount_pct.abs() > threshold_pct
    return premium_discount_pct, alert


def s75_volatility_arbitrage(market_iv: pd.Series, forecast_realized_vol: pd.Series, threshold: float = 0.02):
    """
    market_iv: option's implied volatility (e.g. from options_pricing.implied_volatility).
    forecast_realized_vol: your model's forecast (e.g. GARCH, EWMA of realized vol)
    supplied externally -- forecasting realized vol is its own subsystem.
    """
    edge = market_iv - forecast_realized_vol
    signal = pd.Series(0, index=market_iv.index)
    signal[edge > threshold] = -1  # IV too high -> sell options (delta-hedged)
    signal[edge < -threshold] = 1   # IV too low -> buy options (delta-hedged)
    return edge, signal
