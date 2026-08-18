"""
mt5_connector.py
----------------
Thin wrapper around the MetaTrader5 python package: connect, pull price
history as a pandas DataFrame, fetch account/symbol info, and send orders.
Keeping all raw MT5 calls in one place makes the rest of the bot easier
to read and to test.
"""

import MetaTrader5 as mt5
import pandas as pd
from datetime import datetime
import logging

import config

logger = logging.getLogger("mt5_connector")

TIMEFRAME_MAP = {
    "M1": mt5.TIMEFRAME_M1,
    "M5": mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30,
    "H1": mt5.TIMEFRAME_H1,
    "H4": mt5.TIMEFRAME_H4,
    "D1": mt5.TIMEFRAME_D1,
}

_COLOR_NAME_MAP = {
    # MT5 color ints are BGR-ordered (0xBBGGRR), not RGB.
    "clrLimeGreen": 0x32CD32,
    "clrRed": 0x0000FF,
    "clrOrange": 0x00A5FF,
    "clrDodgerBlue": 0xFF901E,
}


def connect() -> bool:
    """Initialize the MT5 terminal connection and log in."""
    init_kwargs = {}
    if config.MT5_PATH:
        init_kwargs["path"] = config.MT5_PATH

    if not mt5.initialize(**init_kwargs):
        logger.error(f"MT5 initialize() failed: {mt5.last_error()}")
        return False

    if config.MT5_LOGIN:
        authorized = mt5.login(
            config.MT5_LOGIN,
            password=config.MT5_PASSWORD,
            server=config.MT5_SERVER,
        )
        if not authorized:
            logger.error(f"MT5 login() failed: {mt5.last_error()}")
            return False

    info = mt5.account_info()
    if info is None:
        logger.error("Could not retrieve account info after login.")
        return False

    logger.info(f"Connected to MT5. Account: {info.login}, Balance: {info.balance} {info.currency}")
    return True


def shutdown():
    mt5.shutdown()


def get_account_info():
    return mt5.account_info()


def get_open_positions(symbol: str = None):
    if symbol:
        return mt5.positions_get(symbol=symbol) or ()
    return mt5.positions_get() or ()


def position_exists(ticket: int) -> bool:
    return len(mt5.positions_get(ticket=ticket) or ()) > 0


def get_position_by_ticket(ticket: int):
    positions = mt5.positions_get(ticket=ticket)
    return positions[0] if positions else None


def get_rates_dataframe(symbol: str, timeframe: str, n_bars: int) -> pd.DataFrame:
    """Fetch n_bars of OHLC history for symbol/timeframe as a DataFrame."""
    tf = TIMEFRAME_MAP.get(timeframe)
    if tf is None:
        raise ValueError(f"Unknown timeframe '{timeframe}'")

    rates = mt5.copy_rates_from_pos(symbol, tf, 0, n_bars)
    if rates is None or len(rates) == 0:
        logger.warning(f"No rate data returned for {symbol} {timeframe}")
        return pd.DataFrame()

    df = pd.DataFrame(rates)
    df["time"] = pd.to_datetime(df["time"], unit="s")
    df.rename(columns={"tick_volume": "volume"}, inplace=True)
    return df


def get_symbol_info(symbol: str):
    info = mt5.symbol_info(symbol)
    if info is not None and not info.visible:
        mt5.symbol_select(symbol, True)
        info = mt5.symbol_info(symbol)
    return info


_filling_mode_cache = {}  # symbol -> resolved ORDER_FILLING_* constant, avoids re-deriving every order


def _get_filling_mode(symbol: str, info):
    """
    Different brokers/symbols support different order 'filling modes'
    (FOK, IOC, RETURN) for market execution -- using one the symbol
    doesn't support is exactly what produces retcode 10030 'Unsupported
    filling mode'. info.filling_mode is a bitmask: bit 0 (value 1) = FOK
    supported, bit 1 (value 2) = IOC supported. Prefer IOC (lets a partial
    fill go through instead of canceling the whole order), fall back to
    FOK, and fall back further to RETURN as a last resort for brokers that
    report neither bit (some report 0 and only accept RETURN).
    """
    if symbol in _filling_mode_cache:
        return _filling_mode_cache[symbol]

    mode_bitmask = getattr(info, "filling_mode", 0)
    if mode_bitmask & 2:  # SYMBOL_FILLING_IOC bit
        resolved = mt5.ORDER_FILLING_IOC
    elif mode_bitmask & 1:  # SYMBOL_FILLING_FOK bit
        resolved = mt5.ORDER_FILLING_FOK
    else:
        resolved = mt5.ORDER_FILLING_RETURN

    _filling_mode_cache[symbol] = resolved
    return resolved


def get_spread_pips(symbol: str) -> float:
    info = get_symbol_info(symbol)
    if info is None:
        return float("inf")
    point = info.point
    digits = info.digits
    pip_size = point * 10 if digits in (3, 5) else point
    return (info.ask - info.bid) / pip_size if pip_size else float("inf")


def send_order(symbol: str, direction: str, lot: float, sl_price: float, tp_price: float, comment: str = "auto-bot"):
    """
    Send a market order.
    direction: "BUY" or "SELL"
    Returns the MT5 order_send result, or None if symbol info unavailable.
    """
    info = get_symbol_info(symbol)
    if info is None:
        logger.error(f"No symbol info for {symbol}, cannot trade.")
        return None, sl_price, tp_price

    price = info.ask if direction == "BUY" else info.bid
    order_type = mt5.ORDER_TYPE_BUY if direction == "BUY" else mt5.ORDER_TYPE_SELL
    filling_mode = _get_filling_mode(symbol, info)

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": lot,
        "type": order_type,
        "price": price,
        "sl": sl_price,
        "tp": tp_price,
        "deviation": 10,
        "magic": config.BOT_MAGIC_NUMBER,
        "comment": comment,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling_mode,
    }

    result = mt5.order_send(request)

    # retcode 10030 = "Unsupported filling mode" -- our cached guess was wrong for this
    # symbol/broker combo. Try the other modes once before giving up, and cache whichever
    # one actually works so future orders on this symbol use it directly.
    if result is not None and result.retcode == 10030:
        for fallback_mode in (mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN):
            if fallback_mode == filling_mode:
                continue
            logger.warning(f"{symbol}: filling mode {filling_mode} unsupported, retrying with {fallback_mode}.")
            request["type_filling"] = fallback_mode
            result = mt5.order_send(request)
            if result is not None and result.retcode != 10030:
                _filling_mode_cache[symbol] = fallback_mode  # remember what actually worked
                break

    # retcode 10016 = "Invalid stops" -- our pre-check in risk_manager.py uses the
    # broker's reported minimum, but that can shift in fast-moving conditions, or be
    # reported as 0 when the real-world minimum isn't. Widen SL/TP by 50% and retry once
    # before giving up, rather than just losing the trade opportunity outright.
    if result is not None and result.retcode == 10016:
        logger.warning(f"{symbol}: stops rejected as too tight, widening by 50% and retrying once.")
        info = mt5.symbol_info(symbol)
        if info is None:
            logger.error(f"{symbol}: cannot re-fetch symbol info for retry")
            return None, sl_price, tp_price
        current_price = info.ask if direction == "BUY" else info.bid
        sl_distance = abs(current_price - sl_price) * 1.5
        tp_distance = abs(tp_price - current_price) * 1.5
        if direction == "BUY":
            request["sl"] = current_price - sl_distance
            request["tp"] = current_price + tp_distance
        else:
            request["sl"] = current_price + sl_distance
            request["tp"] = current_price - tp_distance
        result = mt5.order_send(request)

    if result is None:
        logger.error(f"order_send returned None for {symbol}: {mt5.last_error()}")
        return None, sl_price, tp_price

    final_sl = request["sl"]
    final_tp = request["tp"]

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        logger.error(f"Order failed for {symbol}: retcode={result.retcode}, comment={result.comment}")
    else:
        logger.info(f"Order placed: {direction} {lot} lots {symbol} @ {price}, SL={final_sl}, TP={final_tp}")

    return result, final_sl, final_tp


def draw_trade_markers(symbol: str, direction: str, entry_price: float, sl_price: float,
                        tp_price: float, ticket: int):
    """
    Draws an entry arrow plus SL/TP horizontal lines on the symbol's open
    chart in the MT5 terminal, so a placed trade is visible at a glance.
    Requires that symbol's chart to be open in the terminal window.
    Object names are unique per ticket so multiple trades don't collide
    and old markers don't get silently overwritten.

    This is a cosmetic, best-effort feature -- different MT5 Python
    package versions/builds expose different subsets of the OBJ_*
    constants, so EVERY constant lookup here uses getattr with a
    fallback rather than assuming it exists. This function must NEVER
    raise: a missing chart constant is not allowed to prevent the trade
    itself from being tracked (see the caller in main.py, which records
    the trade before calling this).
    """
    if not config.DRAW_CHART_MARKERS:
        return

    try:
        now = datetime.now()
        arrow_color = _COLOR_NAME_MAP.get(
            config.CHART_MARKER_BUY_COLOR if direction == "BUY" else config.CHART_MARKER_SELL_COLOR
        )
        sl_color = _COLOR_NAME_MAP.get(config.CHART_SL_COLOR)
        tp_color = _COLOR_NAME_MAP.get(config.CHART_TP_COLOR)

        arrow_name = f"bot_entry_{ticket}"
        sl_name = f"bot_sl_{ticket}"
        tp_name = f"bot_tp_{ticket}"

        # OBJ_ARROW_UP/DOWN aren't exposed in every MT5 Python package build.
        # Fall back to the generic OBJ_ARROW + an arrow-code property, and if
        # even that's missing, skip the entry arrow but still draw SL/TP lines.
        obj_arrow_up = getattr(mt5, "OBJ_ARROW_UP", None)
        obj_arrow_down = getattr(mt5, "OBJ_ARROW_DOWN", None)
        obj_arrow_generic = getattr(mt5, "OBJ_ARROW", None)
        obj_hline = getattr(mt5, "OBJ_HLINE", None)
        objprop_color = getattr(mt5, "OBJPROP_COLOR", None)
        objprop_width = getattr(mt5, "OBJPROP_WIDTH", None)
        objprop_style = getattr(mt5, "OBJPROP_STYLE", None)
        objprop_arrowcode = getattr(mt5, "OBJPROP_ARROWCODE", None)
        style_dash = getattr(mt5, "STYLE_DASH", None)

        if obj_arrow_up is not None and obj_arrow_down is not None:
            arrow_code = obj_arrow_up if direction == "BUY" else obj_arrow_down
            mt5.object_create(symbol, arrow_name, arrow_code, 0, now, entry_price)
        elif obj_arrow_generic is not None:
            mt5.object_create(symbol, arrow_name, obj_arrow_generic, 0, now, entry_price)
            if objprop_arrowcode is not None:
                mt5.object_set_integer(symbol, arrow_name, objprop_arrowcode, 233 if direction == "BUY" else 234)
        else:
            arrow_name = None  # this build doesn't support arrow objects at all -- skip it

        if arrow_name and objprop_color is not None:
            mt5.object_set_integer(symbol, arrow_name, objprop_color, arrow_color)
        if arrow_name and objprop_width is not None:
            mt5.object_set_integer(symbol, arrow_name, objprop_width, 3)

        if obj_hline is not None:
            mt5.object_create(symbol, sl_name, obj_hline, 0, now, sl_price)
            if objprop_color is not None:
                mt5.object_set_integer(symbol, sl_name, objprop_color, sl_color)
            if objprop_style is not None and style_dash is not None:
                mt5.object_set_integer(symbol, sl_name, objprop_style, style_dash)

            mt5.object_create(symbol, tp_name, obj_hline, 0, now, tp_price)
            if objprop_color is not None:
                mt5.object_set_integer(symbol, tp_name, objprop_color, tp_color)
            if objprop_style is not None and style_dash is not None:
                mt5.object_set_integer(symbol, tp_name, objprop_style, style_dash)

        logger.info(f"Chart markers drawn for ticket {ticket} on {symbol}.")
    except Exception:
        logger.exception(f"Failed to draw chart markers for ticket {ticket} on {symbol}.")


def remove_trade_markers(ticket: int, symbol: str):
    """
    Call this once a trade closes, to clean its markers off the chart.
    Cosmetic and best-effort, same as draw_trade_markers -- must never
    raise. object_delete isn't guaranteed to exist on every MT5 Python
    package build either, same root cause as the OBJ_ARROW_UP issue.
    """
    if not config.DRAW_CHART_MARKERS:
        return
    object_delete = getattr(mt5, "object_delete", None)
    if object_delete is None:
        return  # this build doesn't support it -- nothing to clean up, move on
    try:
        for prefix in ("bot_entry_", "bot_sl_", "bot_tp_"):
            object_delete(symbol, f"{prefix}{ticket}")
    except Exception:
        logger.exception(f"Failed to remove chart markers for ticket {ticket} on {symbol}.")


def modify_position_sltp(ticket: int, symbol: str, sl_price: float, tp_price: float):
    """Modify the SL/TP of an already-open position (used for breakeven shift / trailing stop)."""
    request = {
        "action": mt5.TRADE_ACTION_SLTP,
        "symbol": symbol,
        "position": ticket,
        "sl": sl_price,
        "tp": tp_price,
    }
    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        logger.error(f"Failed to modify SL/TP for ticket {ticket}: {mt5.last_error() if result is None else result.comment}")
        return None
    logger.info(f"Ticket {ticket} ({symbol}): SL/TP updated to SL={sl_price}, TP={tp_price}")
    return result


def close_position(position) -> bool:
    """Close an open position outright (used for the no-overnight-hold rule)."""
    symbol = position.symbol
    info = get_symbol_info(symbol)
    if info is None:
        logger.error(f"Cannot close position {position.ticket}: no symbol info for {symbol}.")
        return False

    close_type = mt5.ORDER_TYPE_SELL if position.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
    price = info.bid if close_type == mt5.ORDER_TYPE_SELL else info.ask

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": position.volume,
        "type": close_type,
        "position": position.ticket,
        "price": price,
        "deviation": 10,
        "magic": config.BOT_MAGIC_NUMBER,
        "comment": "no-overnight-hold close",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": _get_filling_mode(symbol, info),
    }
    result = mt5.order_send(request)
    if result is not None and result.retcode == 10030:
        for fallback_mode in (mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN):
            request["type_filling"] = fallback_mode
            result = mt5.order_send(request)
            if result is not None and result.retcode != 10030:
                _filling_mode_cache[symbol] = fallback_mode
                break
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        logger.error(f"Failed to close ticket {position.ticket}: {mt5.last_error() if result is None else result.comment}")
        return False
    logger.info(f"Closed ticket {position.ticket} ({symbol}) for end-of-day rollover rule.")
    return True


def partial_close_position(position, close_percent: float) -> bool:
    """
    Closes close_percent (0-100) of an open position's volume, leaving the
    rest running. Used by position_manager.py's partial-close feature.
    """
    symbol = position.symbol
    info = get_symbol_info(symbol)
    if info is None:
        logger.error(f"Cannot partial-close position {position.ticket}: no symbol info for {symbol}.")
        return False

    volume_to_close = round((position.volume * close_percent / 100) / (info.volume_step or 0.01)) * (info.volume_step or 0.01)
    volume_to_close = max(info.volume_min, min(position.volume, volume_to_close))
    if volume_to_close <= 0:
        return False

    return _partial_close_volume(position, info, volume_to_close)


def partial_close_to_volume(position, volume_to_close: float) -> bool:
    """
    Closes exactly `volume_to_close` lots of an open position (clamped to the
    broker's volume step/min and the position's remaining volume), leaving the
    rest running. Used by the take-profit ladder so each level banks a fixed
    share of the ORIGINAL position regardless of prior partial closes.
    """
    symbol = position.symbol
    info = get_symbol_info(symbol)
    if info is None:
        logger.error(f"Cannot partial-close position {position.ticket}: no symbol info for {symbol}.")
        return False

    volume_to_close = round((min(volume_to_close, position.volume)) / (info.volume_step or 0.01)) * (info.volume_step or 0.01)
    volume_to_close = max(info.volume_min, min(position.volume, volume_to_close))
    if volume_to_close <= 0:
        return False

    return _partial_close_volume(position, info, volume_to_close)


def _partial_close_volume(position, info, volume_to_close: float) -> bool:
    """Shared worker: send the partial-close deal for a pre-validated volume."""
    close_type = mt5.ORDER_TYPE_SELL if position.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
    price = info.bid if close_type == mt5.ORDER_TYPE_SELL else info.ask

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": position.symbol,
        "volume": volume_to_close,
        "type": close_type,
        "position": position.ticket,
        "price": price,
        "deviation": 10,
        "magic": config.BOT_MAGIC_NUMBER,
        "comment": "partial_close",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": _get_filling_mode(position.symbol, info),
    }
    result = mt5.order_send(request)
    if result is not None and result.retcode == 10030:
        for fallback_mode in (mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN):
            request["type_filling"] = fallback_mode
            result = mt5.order_send(request)
            if result is not None and result.retcode != 10030:
                _filling_mode_cache[position.symbol] = fallback_mode
                break
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        logger.error(f"Partial close failed for ticket {position.ticket}: {mt5.last_error() if result is None else result.comment}")
        return False
    logger.info(f"Partial-closed {volume_to_close} lots of ticket {position.ticket} ({position.symbol}).")
    return True


from datetime import datetime, timezone

def get_closing_deals_since(from_datetime: datetime, magic: int = None):
    """
    Returns all 'position close' deals (DEAL_ENTRY_OUT) recorded since
    from_datetime. Used by trade_tracker.py to detect when a position the
    bot opened has actually closed (hit SL, hit TP, or was closed manually)
    and to read its real realized profit.
    """
    now = datetime.now(timezone.utc)
    # Ensure from_datetime is also timezone-aware for MT5 compatibility
    if from_datetime.tzinfo is None:
        from_datetime = from_datetime.replace(tzinfo=timezone.utc)
    deals = mt5.history_deals_get(from_datetime, now)
    if deals is None:
        return []
    closing = [d for d in deals if d.entry == mt5.DEAL_ENTRY_OUT]
    if magic is not None:
        closing = [d for d in closing if d.magic == magic]
    return closing
