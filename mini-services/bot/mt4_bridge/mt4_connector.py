"""
mt4_connector.py
----------------
Python side of the MT4 bridge. MetaTrader 4 has no official Python API, so
this module talks to the ToptierBridge.mq4 Expert Advisor that runs inside the
user's MT4 terminal via a simple, robust FILE-based protocol:

  tb_cmd.cmd    Python -> EA   one command line   CMD|<id>|<cmd>|<args...>
  tb_resp.cmd   EA -> Python   one response line  OK|<id>|<data...> | ERR|<id>|<message>

The EA polls for tb_cmd.cmd every EA_POLL_MS, executes, writes tb_resp.cmd and
deletes tb_cmd.cmd. Python polls tb_resp.cmd until it sees the matching <id>
(timeout via MT4_BRIDGE_TIMEOUT_SECONDS). This avoids MQL4's socket
limitations (EA can only connect out) and needs no open inbound ports.

This module mirrors the exact interface of mt5_connector.py so the trading
engine can use it unchanged (the runner installs it as `mt5_connector.py` in
the instance workspace). All prices/dates behave like the MT5 connector so the
rest of the engine needs no platform-specific branches.
"""

import json
import logging
import os
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import config

logger = logging.getLogger("mt4_connector")

_TIMEFRAME_MINUTES = {
    "M1": 1, "M5": 5, "M15": 15, "M30": 30,
    "H1": 60, "H4": 240, "D1": 1440,
}

# Mirror of mt5_connector.TIMEFRAME_MAP keys (used by backtest_filter etc.)
TIMEFRAME_MAP = {k: v for k, v in _TIMEFRAME_MINUTES.items()}

# Order type constants that the engine compares against position.type
ORDER_TYPE_BUY = 0
ORDER_TYPE_SELL = 1
# Deal entry constants
DEAL_ENTRY_OUT = 1

_CMD_FILE = "tb_cmd.cmd"
_RESP_FILE = "tb_resp.cmd"


def _bridge_dir() -> str:
    return getattr(config, "MT4_BRIDGE_DIR", "") or "mt4_bridge"


def _poll_ms() -> int:
    return int(getattr(config, "MT4_BRIDGE_POLL_MS", "500"))


def _timeout_seconds() -> int:
    return int(getattr(config, "MT4_BRIDGE_TIMEOUT_SECONDS", "30"))


def _send(cmd: str, *args, timeout: int = None) -> list:
    """Send one command and wait for its response. Returns the parsed response
    fields (list of strings), or raises RuntimeError on timeout/error."""
    d = _bridge_dir()
    os.makedirs(d, exist_ok=True)
    cmd_path = os.path.join(d, _CMD_FILE)
    resp_path = os.path.join(d, _RESP_FILE)

    cmd_id = f"{int(time.time() * 1000)}"
    line = "|".join(["CMD", cmd_id, cmd] + [str(a) for a in args])

    # Clear any stale response from a previous command.
    if os.path.exists(resp_path):
        try:
            os.remove(resp_path)
        except OSError:
            pass

    # Write the command file (atomic-ish: write temp then rename).
    tmp = cmd_path + ".tmp"
    with open(tmp, "w") as f:
        f.write(line + "\n")
    os.replace(tmp, cmd_path)

    deadline = time.time() + (timeout or _timeout_seconds())
    while time.time() < deadline:
        if os.path.exists(resp_path):
            try:
                with open(resp_path, "r") as f:
                    resp_line = f.read().strip()
                os.remove(resp_path)
            except OSError:
                time.sleep(_poll_ms() / 1000.0)
                continue

            parts = resp_line.split("|")
            if len(parts) >= 3 and parts[1] == cmd_id:
                if parts[0] == "OK":
                    return parts[2:]
                raise RuntimeError("MT4 bridge error: " + "|".join(parts[2:]))
            # Response for a different id - stale, keep waiting.

        time.sleep(_poll_ms() / 1000.0)

    raise RuntimeError(f"MT4 bridge timeout waiting for response to '{cmd}' (is ToptierBridge.mq4 running on a chart?)")


def _price_float(s: str) -> float:
    return float(s)


# ---------------------------------------------------------------------------
# Position / deal objects (SimpleNamespace to emulate MT5 namedtuples)
# ---------------------------------------------------------------------------


def _position_from_fields(fields: list) -> SimpleNamespace:
    # ticket,symbol,type,lots,entry,sl,tp,profit,open_time,comment,magic
    p = SimpleNamespace()
    p.ticket = int(fields[0])
    p.symbol = fields[1]
    p.type = int(fields[2])
    p.volume = float(fields[3])
    p.price_open = float(fields[4])
    p.sl = _price_float(fields[5])
    p.tp = _price_float(fields[6])
    p.profit = float(fields[7])
    p.time = int(fields[8])
    p.comment = fields[9] if len(fields) > 9 else ""
    p.magic = int(fields[10]) if len(fields) > 10 else 0
    return p


def _deal_from_fields(fields: list) -> SimpleNamespace:
    # ticket,position_id,entry,profit,price,time,magic,symbol
    d = SimpleNamespace()
    d.ticket = int(fields[0])
    d.position_id = int(fields[1])
    d.entry = int(fields[2])
    d.profit = float(fields[3])
    d.price = float(fields[4])
    d.time = int(fields[5])
    d.magic = int(fields[6])
    d.symbol = fields[7] if len(fields) > 7 else ""
    return d


# ---------------------------------------------------------------------------
# Public interface (mirrors mt5_connector.py)
# ---------------------------------------------------------------------------


def connect() -> bool:
    d = _bridge_dir()
    try:
        os.makedirs(d, exist_ok=True)
        # Best-effort reachability probe; some setups only have the EA attach
        # after the terminal finishes loading, so a failed probe is non-fatal.
        try:
            _send("PING", timeout=8)
        except RuntimeError as e:
            logger.warning("MT4 bridge not reachable yet: %s", e)
            return True  # engine still starts; orders will surface real errors
        return True
    except OSError as e:
        logger.error("MT4 bridge dir unusable: %s", e)
        return False


def shutdown():
    # File bridge needs no teardown.
    return


def get_account_info():
    try:
        fields = _send("INFO")
    except RuntimeError as e:
        logger.error("get_account_info failed: %s", e)
        return None
    # login,balance,equity,currency,server,leverage
    acc = SimpleNamespace()
    acc.login = int(fields[0])
    acc.balance = float(fields[1])
    acc.equity = float(fields[2])
    acc.currency = fields[3]
    acc.server = fields[4]
    acc.leverage = int(fields[5])
    return acc


def get_open_positions(symbol: str = None):
    try:
        fields = _send("POSITIONS")
    except RuntimeError as e:
        logger.error("get_open_positions failed: %s", e)
        return ()
    positions = []
    for row in fields:
        parts = row.split(",")
        if len(parts) < 9:
            continue
        p = _position_from_fields(parts)
        if symbol and p.symbol != symbol:
            continue
        positions.append(p)
    return tuple(positions)


def position_exists(ticket: int) -> bool:
    return any(p.ticket == ticket for p in get_open_positions())


def get_position_by_ticket(ticket: int):
    for p in get_open_positions():
        if p.ticket == ticket:
            return p
    return None


def get_rates_dataframe(symbol: str, timeframe: str, n_bars: int):
    import pandas as pd
    tf_min = _TIMEFRAME_MINUTES.get(timeframe)
    if tf_min is None:
        raise ValueError(f"Unknown timeframe '{timeframe}'")

    try:
        fields = _send("RATES", symbol, tf_min, n_bars)
    except RuntimeError as e:
        logger.warning("get_rates_dataframe(%s %s) failed: %s", symbol, timeframe, e)
        return pd.DataFrame()

    rows = []
    for row in fields:
        cols = row.split(",")
        if len(cols) < 6:
            continue
        try:
            rows.append({
                "time": pd.to_datetime(int(cols[0]), unit="s"),
                "open": float(cols[1]),
                "high": float(cols[2]),
                "low": float(cols[3]),
                "close": float(cols[4]),
                "volume": int(float(cols[5])),
            })
        except ValueError:
            continue
    return pd.DataFrame(rows)


def get_symbol_info(symbol: str):
    try:
        fields = _send("SYMBOL", symbol)
    except RuntimeError as e:
        logger.error("get_symbol_info(%s) failed: %s", symbol, e)
        return None
    # point,digits,volume_min,volume_step,spread,bid,ask
    info = SimpleNamespace()
    info.point = float(fields[0])
    info.digits = int(fields[1])
    info.volume_min = float(fields[2])
    info.volume_step = float(fields[3])
    info.spread = float(fields[4])
    info.bid = float(fields[5])
    info.ask = float(fields[6])
    info.visible = True
    info.filling_mode = 0  # MT4 doesn't report filling modes; send_order handles RETRY
    return info


def get_spread_pips(symbol: str) -> float:
    try:
        fields = _send("SPREAD", symbol)
        return float(fields[0])
    except (RuntimeError, ValueError, IndexError) as e:
        logger.warning("get_spread_pips(%s) failed: %s", symbol, e)
        return float("inf")


def send_order(symbol: str, direction: str, lot: float, sl_price: float, tp_price: float, comment: str = "auto-bot"):
    # MT4 needs an expiry or comment-free market order; send comment + magic.
    magic = getattr(config, "BOT_MAGIC_NUMBER", 0)
    try:
        fields = _send("ORDER", symbol, direction, lot, sl_price, tp_price, comment, magic)
    except RuntimeError as e:
        logger.error("send_order(%s %s) failed: %s", direction, symbol, e)
        return None, sl_price, tp_price
    # ticket,price
    result = SimpleNamespace()
    result.order = int(fields[0])
    result.price = float(fields[1])
    result.retcode = 10009  # TRADE_RETCODE_DONE
    result.comment = "MT4 order placed"
    return result, sl_price, tp_price


def draw_trade_markers(symbol: str, direction: str, entry_price: float, sl_price: float,
                       tp_price: float, ticket: int):
    # Optional - the EA can draw markers; out of scope for the bridge. Best-effort no-op.
    return


def remove_trade_markers(ticket: int, symbol: str):
    return


def modify_position_sltp(ticket: int, symbol: str, sl_price: float, tp_price: float):
    try:
        _send("MODIFY", ticket, sl_price, tp_price)
        logger.info("Ticket %s (%s): SL/TP updated to SL=%s, TP=%s", ticket, symbol, sl_price, tp_price)
        return SimpleNamespace(retcode=10009)
    except RuntimeError as e:
        logger.error("modify_position_sltp(%s) failed: %s", ticket, e)
        return None


def close_position(position) -> bool:
    try:
        fields = _send("CLOSE", position.ticket, position.symbol)
        return True
    except RuntimeError as e:
        logger.error("close_position(%s) failed: %s", position.ticket, e)
        return False


def partial_close_position(position, close_percent: float) -> bool:
    try:
        volume_to_close = round((position.volume * close_percent / 100.0) / 0.01) * 0.01
        volume_to_close = max(0.01, min(position.volume, volume_to_close))
        _send("CLOSE", position.ticket, position.symbol, volume_to_close)
        return True
    except RuntimeError as e:
        logger.error("partial_close_position(%s) failed: %s", position.ticket, e)
        return False


def get_closing_deals_since(from_datetime: datetime, magic: int = None):
    since = int(from_datetime.timestamp())
    try:
        fields = _send("DEALS", since)
    except RuntimeError as e:
        logger.warning("get_closing_deals_since failed: %s", e)
        return []
    deals = []
    for row in fields:
        parts = row.split(",")
        if len(parts) < 8:
            continue
        d = _deal_from_fields(parts)
        if magic is not None and d.magic != magic:
            continue
        deals.append(d)
    return deals
