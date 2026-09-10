"""
strategies/carry_trade.py
-------------------------
Carry trade (ported from file 9): long the pair if the base currency's
interest rate exceeds the quote's (perpetual positive swap), short the pair
if the quote rate exceeds the base's. Needs the two annualized rates.

Not part of the single-asset STRATEGY_REGISTRY: call carry_trade_signal() with
the base/quote rates (decimals, e.g. 0.05 = 5%).
"""


def signal(rate_base: float, rate_quote: float, threshold: float = 0.0,
           symbol: str = "") -> str:
    diff = rate_base - rate_quote
    if diff > threshold:
        return "BUY"
    if diff < -threshold:
        return "SELL"
    return "HOLD"