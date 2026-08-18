"""
position_manager.py
----------------------
Manages trades AFTER they're opened: breakeven shift, trailing stop, and
the no-overnight-hold close. Runs every scan against every position the
bot currently has open (identified by BOT_MAGIC_NUMBER), independent of
which strategy or timeframe opened it.
"""

import logging
from datetime import datetime, time as dtime

import config
import indicators as ind
import mt5_connector as mt5c
import trade_tracker as tt

logger = logging.getLogger("position_manager")


def _pip_size(info) -> float:
    return info.point * 10 if info.digits in (3, 5) else info.point


def _profit_in_r(position, trade_meta, info) -> float:
    """How many multiples of the original risk (1R = entry-to-original-SL distance) this position is currently up."""
    entry = trade_meta["entry_price"]
    original_sl = trade_meta["original_sl_price"]
    risk_distance = abs(entry - original_sl)
    if risk_distance == 0:
        return 0.0

    direction = trade_meta["direction"]
    current_price = info.bid if direction == "BUY" else info.ask  # a BUY position closes/marks at bid
    profit_distance = (current_price - entry) if direction == "BUY" else (entry - current_price)
    return profit_distance / risk_distance


def _apply_breakeven(position, trade_meta, info):
    if trade_meta.get("breakeven_applied"):
        return
    if _profit_in_r(position, trade_meta, info) < config.BREAKEVEN_TRIGGER_R:
        return

    pip = _pip_size(info)
    buffer_distance = config.BREAKEVEN_BUFFER_PIPS * pip
    entry = trade_meta["entry_price"]
    direction = trade_meta["direction"]
    new_sl = entry + buffer_distance if direction == "BUY" else entry - buffer_distance

    result = mt5c.modify_position_sltp(position.ticket, position.symbol, new_sl, position.tp)
    if result is not None:
        tt.update_pending_trade(position.ticket, sl_price=new_sl, breakeven_applied=True)
        logger.info(f"Ticket {position.ticket} ({position.symbol}): breakeven shift applied, SL -> {new_sl}")


def _apply_trailing_stop(position, trade_meta, info, df):
    if _profit_in_r(position, trade_meta, info) < config.TRAILING_START_R:
        return

    last_atr = ind.atr(df, config.ATR_PERIOD).iloc[-1]
    if last_atr is None or last_atr <= 0:
        return

    trail_distance = last_atr * config.TRAILING_ATR_MULTIPLIER
    direction = trade_meta["direction"]
    current_price = info.bid if direction == "BUY" else info.ask
    current_sl = trade_meta["sl_price"]

    if direction == "BUY":
        candidate_sl = current_price - trail_distance
        improves = candidate_sl > current_sl  # only ever move a BUY's stop up
    else:
        candidate_sl = current_price + trail_distance
        improves = candidate_sl < current_sl  # only ever move a SELL's stop down

    if not improves:
        return

    result = mt5c.modify_position_sltp(position.ticket, position.symbol, candidate_sl, position.tp)
    if result is not None:
        tt.update_pending_trade(position.ticket, sl_price=candidate_sl)
        logger.info(f"Ticket {position.ticket} ({position.symbol}): trailing stop -> {candidate_sl}")


def _apply_take_profit_ladder(position, trade_meta, info):
    """
    Realizes profit in up to config.TAKE_PROFIT_LEVELS steps: partial closes at
    the earlier levels (each banking a fixed % of the ORIGINAL position), and
    the final level (fraction 1.0) is the broker-side TP, which closes whatever
    is left automatically. Triggers are measured as fractions of this trade's
    own target distance, so the same ladder scales to any strategy's RR.
    """
    if not config.USE_TP_LADDER:
        return
    levels = config.TAKE_PROFIT_LEVELS
    if not levels:
        return

    entry = trade_meta["entry_price"]
    original_sl = trade_meta["original_sl_price"]
    tp = trade_meta["tp_price"]
    risk_distance = abs(entry - original_sl)
    if risk_distance <= 0:
        return
    eff_rr = abs(tp - entry) / risk_distance
    if eff_rr <= 0:
        return

    current_r = _profit_in_r(position, trade_meta, info)

    hit = list(trade_meta.get("tp_levels_hit") or [])
    # Legacy trades partially closed under the old single-level rule: treat
    # every ladder level up to that trigger as already banked.
    if not hit and trade_meta.get("partial_closed"):
        hit = [i for i, (frac, _) in enumerate(levels) if frac * eff_rr <= config.PARTIAL_CLOSE_TRIGGER_R]

    original_lot = trade_meta.get("original_lot", trade_meta["lot"])
    changed = False

    for i, (fraction, close_pct) in enumerate(levels):
        if i in hit:
            continue
        if current_r < fraction * eff_rr:
            continue
        if fraction >= 1.0:
            # Final level is the broker TP itself -- it closes the remainder.
            hit.append(i)
            changed = True
            continue

        volume_to_close = original_lot * close_pct / 100.0
        if mt5c.partial_close_to_volume(position, volume_to_close):
            hit.append(i)
            changed = True
            logger.info(
                f"Ticket {position.ticket} ({position.symbol}): TP level {i + 1}/{len(levels)} "
                f"hit at {fraction * 100:.0f}% of target, banked {close_pct}% of position."
            )
            # The position object is now stale -- refresh it so any further
            # slices in this scan are clamped against the true remaining size.
            refreshed = [p for p in mt5c.get_open_positions() if p.ticket == position.ticket]
            if not refreshed:
                break  # the slice closed the entire position
            position = refreshed[0]

    if changed:
        tt.update_pending_trade(position.ticket, tp_levels_hit=hit)


def manage_open_positions():
    """Call every scan. Applies the take-profit ladder, breakeven shift, and trailing stop to every open bot position."""
    if not (config.USE_TP_LADDER or config.USE_BREAKEVEN_SHIFT or config.USE_TRAILING_STOP or config.USE_PARTIAL_CLOSE):
        return

    positions = mt5c.get_open_positions()
    bot_positions = [p for p in positions if p.magic == config.BOT_MAGIC_NUMBER]

    for position in bot_positions:
        trade_meta = tt.get_pending_trade(position.ticket)
        if trade_meta is None:
            continue  # not one of ours, or opened before tracking existed

        info = mt5c.get_symbol_info(position.symbol)
        if info is None:
            continue

        if config.USE_TP_LADDER or config.USE_PARTIAL_CLOSE:
            _apply_take_profit_ladder(position, trade_meta, info)
            trade_meta = tt.get_pending_trade(position.ticket)  # re-read in case it just changed
            if trade_meta is None:
                continue  # the partial close happened to be the full remaining size and fully closed it

        if config.USE_BREAKEVEN_SHIFT:
            _apply_breakeven(position, trade_meta, info)
            trade_meta = tt.get_pending_trade(position.ticket)  # re-read in case it just changed

        if config.USE_TRAILING_STOP:
            df = mt5c.get_rates_dataframe(position.symbol, trade_meta["timeframe"], config.ATR_PERIOD + 10)
            if not df.empty:
                _apply_trailing_stop(position, trade_meta, info, df)


def is_within_trading_hours() -> bool:
    """True if the current local time falls inside TRADING_HOURS_START/END (new trades only)."""
    if not config.USE_TRADING_HOURS:
        return True
    now = datetime.now().time()
    start = dtime.fromisoformat(config.TRADING_HOURS_START)
    end = dtime.fromisoformat(config.TRADING_HOURS_END)
    if start <= end:
        return start <= now <= end
    return now >= start or now <= end  # handles a window that crosses midnight


def close_positions_for_rollover():
    """Force-closes every open bot position at/after ROLLOVER_CLOSE_TIME, so nothing holds overnight."""
    if not config.USE_NO_OVERNIGHT_HOLD:
        return

    rollover_time = dtime.fromisoformat(config.ROLLOVER_CLOSE_TIME)
    now = datetime.now().time()
    if now < rollover_time:
        return

    positions = mt5c.get_open_positions()
    bot_positions = [p for p in positions if p.magic == config.BOT_MAGIC_NUMBER]
    for position in bot_positions:
        logger.info(f"No-overnight-hold rule: closing ticket {position.ticket} ({position.symbol}) before rollover.")
        mt5c.close_position(position)
