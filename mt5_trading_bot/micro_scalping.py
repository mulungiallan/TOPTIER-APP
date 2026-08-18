"""
micro_scalping.py
---------------------
Sub-minute strategy targeting a small ABSOLUTE dollar profit
(config.MICRO_SCALP_TARGET_USD) over a very short hold
(config.MICRO_SCALP_MAX_HOLD_SECONDS). Works on raw tick data, not
candles, so it runs on its own faster loop (see main.py) rather than the
main per-candle scan.

This is listed in config.EXPERIMENTAL_STRATEGIES alongside ai_strategy:
tick-by-tick judgment isn't something that gets backtested the normal way,
so it can never trigger a trade on its own -- a backtest-approved strategy
on that symbol's M1 timeframe must already be leaning the same direction.

Read config.py's comment block above the MICRO-SCALPING settings before
turning this on: a target this small can be smaller than round-trip
spread cost on some symbols/brokers, in which case this strategy loses
money to transaction costs regardless of signal quality.
"""

import logging
from datetime import datetime, timedelta, timezone

import config
import mt5_connector as mt5c
import risk_manager as rm
import trade_tracker as tt
import backtest_filter as bf

logger = logging.getLogger("micro_scalping")

try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None


def get_tick_signal(symbol: str) -> str:
    """
    Looks at raw ticks over the last MICRO_SCALP_TICK_WINDOW_SECONDS and
    votes BUY/SELL if price has moved at least MICRO_SCALP_MIN_MOVE_POINTS
    in one direction (filters out pure noise), else HOLD.
    """
    if mt5 is None:
        return "HOLD"

    since = datetime.now() - timedelta(seconds=config.MICRO_SCALP_TICK_WINDOW_SECONDS)
    ticks = mt5.copy_ticks_from(symbol, since, 1000, mt5.COPY_TICKS_ALL)
    if ticks is None or len(ticks) < 2:
        return "HOLD"

    first_price = ticks[0]["bid"]
    last_price = ticks[-1]["bid"]
    info = mt5c.get_symbol_info(symbol)
    if info is None:
        return "HOLD"

    move_points = (last_price - first_price) / info.point
    if move_points >= config.MICRO_SCALP_MIN_MOVE_POINTS:
        return "BUY"
    if move_points <= -config.MICRO_SCALP_MIN_MOVE_POINTS:
        return "SELL"
    return "HOLD"


def _confirmed_by_approved_strategy(symbol: str, tick_direction: str, approved_combos: dict) -> bool:
    """Checks whether any backtest-approved strategy on this symbol's M1 timeframe already agrees with tick_direction."""
    allowed = approved_combos.get((symbol, "M1"), [])
    if not allowed:
        return False

    df = mt5c.get_rates_dataframe(symbol, "M1", 200)
    if df.empty:
        return False

    for name in allowed:
        fn = bf.STRATEGY_FUNCS.get(name)
        if fn is None:
            continue
        try:
            if fn(df) == tick_direction:
                return True
        except Exception:
            continue
    return False


def _build_micro_trade_plan(symbol: str, direction: str, account_info):
    """
    Sizes the position with the shared fixed-per-asset-class lot sizing
    (risk_manager.calculate_trade_plan), then solves for a take-profit
    distance that targets MICRO_SCALP_TARGET_USD rather than a fixed
    reward:risk multiple -- the whole point of this strategy is a small
    fixed dollar target, not a ratio.
    """
    info = mt5c.get_symbol_info(symbol)
    if info is None:
        return None

    df = mt5c.get_rates_dataframe(symbol, "M1", config.ATR_PERIOD + 10)
    if df.empty:
        return None

    plan = rm.calculate_trade_plan(
        symbol, direction, df, account_info,
        confidence_ratio=0.25,  # experimental strategy -- always sized at the low-confidence end
        atr_sl_multiplier=config.ATR_SL_MULTIPLIER_SCALPING,
        reward_risk_ratio=config.REWARD_RISK_RATIO_SCALPING,  # placeholder TP, overwritten below
    )
    if plan is None:
        return None

    tick_value = info.trade_tick_value
    tick_size = info.trade_tick_size or info.point
    lot = plan["lot"]
    if lot <= 0 or tick_value <= 0:
        return None

    # solve: target_usd = (tp_distance / tick_size) * tick_value * lot  ->  tp_distance = ...
    tp_distance = (config.MICRO_SCALP_TARGET_USD / (tick_value * lot)) * tick_size
    entry_price = info.ask if direction == "BUY" else info.bid
    tp_price = entry_price + tp_distance if direction == "BUY" else entry_price - tp_distance

    plan["tp_price"] = round(tp_price, info.digits)
    return plan


def run_micro_scalp_scan(approved_combos: dict):
    """
    Call this on the fast loop (config.MICRO_SCALP_SCAN_INTERVAL_SECONDS).
    Checks every symbol currently in the EXTREME volatility bucket for a
    tick-confirmed signal, and opens a bounded micro-scalp trade if one
    exists and capacity allows.
    """
    if not config.USE_MICRO_SCALPING:
        return

    import volatility_screener as vs

    account_info = mt5c.get_account_info()
    if account_info is None:
        return

    # The account-size tier caps TOTAL open entries (2 on $50-$100 accounts,
    # 3 on <=$50). Micro-scalps count toward that cap too.
    if rm.too_many_open_positions(account_info):
        return

    open_micro_trades = [
        t for t in tt.get_open_pending_trades().values() if t.get("timeframe") == "TICK"
    ]
    if len(open_micro_trades) >= config.MICRO_SCALP_MAX_CONCURRENT:
        return

    rankings = vs.get_all_rankings()
    extreme_symbols = [s for s, info in rankings.items() if info["bucket"] == "EXTREME"]

    for symbol in extreme_symbols:
        already_open = any(t["symbol"] == symbol for t in open_micro_trades)
        if already_open or len(mt5c.get_open_positions(symbol)) > 0:
            continue

        tick_dir = get_tick_signal(symbol)
        if tick_dir == "HOLD":
            continue

        if config.REQUIRE_NON_EXPERIMENTAL_AGREEMENT:
            if not _confirmed_by_approved_strategy(symbol, tick_dir, approved_combos):
                continue

        plan = _build_micro_trade_plan(symbol, tick_dir, account_info)
        if plan is None:
            continue

        order_result, actual_sl, actual_tp = mt5c.send_order(
            symbol=symbol, direction=plan["direction"], lot=plan["lot"],
            sl_price=plan["sl_price"], tp_price=plan["tp_price"],
        )
        if order_result is not None and getattr(order_result, "order", None):
            mt5c.draw_trade_markers(
                symbol=symbol, direction=plan["direction"], entry_price=order_result.price,
                sl_price=actual_sl, tp_price=actual_tp, ticket=order_result.order,
            )
            tt.record_new_trade(
                ticket=order_result.order, symbol=symbol, timeframe="TICK",
                direction=plan["direction"], lot=plan["lot"], entry_price=order_result.price,
                sl_price=actual_sl, tp_price=actual_tp,
                strategies_agreed={"micro_scalping": tick_dir}, risk_amount=plan["risk_amount"],
            )
            logger.info(
                f"Micro-scalp opened: {plan['direction']} {symbol}, target ${config.MICRO_SCALP_TARGET_USD}, "
                f"max hold {config.MICRO_SCALP_MAX_HOLD_SECONDS}s."
            )
        return  # one micro-scalp entry per scan is plenty given the fast loop interval


def close_expired_micro_scalps():
    """Force-closes any micro-scalp position that has been open longer than MICRO_SCALP_MAX_HOLD_SECONDS, win or lose."""
    if not config.USE_MICRO_SCALPING:
        return

    pending = tt.get_open_pending_trades()
    now = datetime.now(timezone.utc)

    for ticket_str, trade in pending.items():
        if trade.get("timeframe") != "TICK":
            continue
        open_time = datetime.fromisoformat(trade["open_time"])
        age_seconds = (now - open_time).total_seconds()
        if age_seconds < config.MICRO_SCALP_MAX_HOLD_SECONDS:
            continue

        position = mt5c.get_position_by_ticket(int(ticket_str))
        if position is None:
            continue  # already closed by SL/TP, trade_tracker will pick it up normally

        logger.info(f"Micro-scalp ticket {ticket_str} ({trade['symbol']}) hit max hold time ({age_seconds:.0f}s), force-closing.")
        mt5c.close_position(position)
