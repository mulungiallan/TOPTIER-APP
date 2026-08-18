"""
reporter.py
-----------
Sends live bot activity to the TOPTIER app webhook so the web app can show
real performance and track the 50% provider profit share (copy-trading style).

Three kinds of events:
  - trade_opened : one or more trades still open in pending_trades.json - the
                   app mirrors these to PAMM/MAM followers when the connection
                   is a manager's MASTER account.
  - trade_closed : one or more trades that just finished (real P/L) -
                   read from the engine's trade_log.csv.
  - status       : a periodic equity/balance/open-position snapshot from the
                   dashboard_snapshot.json written by dashboard.py.
  - lifecycle    : started / stopped / error.

Every call is best-effort and NEVER raises - a broken webhook URL or network
blip must never halt the trading loop. Webhook URL and service key come from
the instance's generated config.py.
"""

import json
import logging
import os
from datetime import datetime

import config

logger = logging.getLogger("reporter")

_WEBHOOK_URL = getattr(config, "WEBHOOK_URL", "")
_SERVICE_KEY = getattr(config, "BOT_SERVICE_KEY", "")
_INSTANCE_ID = getattr(config, "INSTANCE_ID", "unknown")
_STATE_FILE = "reporter_state.json"


def _state() -> dict:
    if not os.path.exists(_STATE_FILE):
        return {}
    try:
        with open(_STATE_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_state(state: dict):
    try:
        with open(_STATE_FILE, "w") as f:
            json.dump(state, f)
    except OSError:
        pass


def report_event(event: str, payload: dict):
    """Low-level POST. event: started | stopped | error (or any lifecycle value)."""
    if not _WEBHOOK_URL:
        return
    body = json.dumps({
        "instanceId": _INSTANCE_ID,
        "type": "lifecycle",
        "event": event,
        "data": payload,
    }).encode("utf-8")
    _post(body)


def _post(body: bytes, timeout: float = 6.0):
    try:
        import urllib.request
        req = urllib.request.Request(
            _WEBHOOK_URL, data=body, method="POST",
            headers={
                "Content-Type": "application/json",
                "x-bot-service-key": _SERVICE_KEY,
            },
        )
        urllib.request.urlopen(req, timeout=timeout).read()
    except Exception:
        logger.warning("webhook POST failed (will retry next scan): %s", _WEBHOOK_URL, exc_info=True)


def report_closed_trades():
    """Posts any NEW rows from trade_log.csv. Tickets already reported are
    remembered in reporter_state.json so nothing is double-counted and no
    closed trade is ever missed across restarts."""
    if not _WEBHOOK_URL:
        return
    if not os.path.exists(config.TRADE_LOG_FILE):
        return

    import csv
    reported = set(_state().get("reported_tickets", []))
    new_trades = []
    with open(config.TRADE_LOG_FILE, "r", newline="") as f:
        for row in csv.DictReader(f):
            ticket = str(row.get("ticket", "")).strip()
            if not ticket or ticket in reported:
                continue
            try:
                new_trades.append({
                    "ticket": ticket,
                    "symbol": row.get("symbol", ""),
                    "timeframe": row.get("timeframe", ""),
                    "direction": row.get("direction", ""),
                    "lots": float(row.get("lot", 0) or 0),
                    "entryPrice": float(row.get("entry_price", 0) or 0),
                    "closePrice": float(row.get("close_price", 0) or 0),
                    "stopLoss": float(row.get("sl_price", 0) or 0),
                    "takeProfit": float(row.get("tp_price", 0) or 0),
                    "profit": float(row.get("profit", 0) or 0),
                    "result": row.get("result", ""),
                    "openTime": row.get("open_time", ""),
                    "closeTime": row.get("close_time", ""),
                    "riskAmount": float(row.get("risk_amount", 0) or 0) if row.get("risk_amount") else None,
                })
                reported.add(ticket)
            except (ValueError, TypeError):
                continue

    if not new_trades:
        return

    body = json.dumps({
        "instanceId": _INSTANCE_ID,
        "type": "trade_closed",
        "event": "trade_closed",
        "data": {"trades": new_trades},
    }).encode("utf-8")
    _post(body)

    _save_state({**_state(), "reported_tickets": sorted(reported)})
    logger.info("reported %d closed trade(s) to webhook", len(new_trades))


def report_opened_trades():
    """Posts any NEW open trades still in pending_trades.json as trade_opened
    events. The web app uses these to mirror master-account trades to PAMM/MAM
    followers. Tickets already reported stay remembered in reporter_state.json
    (key reported_opened_tickets) so nothing is double-posted across restarts."""
    if not _WEBHOOK_URL:
        return
    if not os.path.exists(config.PENDING_TRADES_FILE):
        return

    state = _state()
    reported = set(state.get("reported_opened_tickets", []))
    new_trades = []
    try:
        with open(config.PENDING_TRADES_FILE, "r") as f:
            pending = json.load(f)
    except (json.JSONDecodeError, OSError):
        return

    for ticket, t in pending.items():
        ticket = str(ticket)
        if ticket in reported:
            continue
        try:
            new_trades.append({
                "ticket": ticket,
                "symbol": t.get("symbol", ""),
                "timeframe": t.get("timeframe", ""),
                "direction": t.get("direction", ""),
                "lots": float(t.get("original_lot", t.get("lot", 0)) or 0),
                "entryPrice": float(t.get("entry_price", 0) or 0),
                "stopLoss": float(t.get("sl_price", 0) or 0),
                "takeProfit": float(t.get("tp_price", 0) or 0),
                "riskAmount": float(t.get("risk_amount", 0) or 0) if t.get("risk_amount") else None,
                "openTime": t.get("open_time", ""),
                "strategies": t.get("strategies_agreed", {}),
            })
            reported.add(ticket)
        except (ValueError, TypeError):
            continue

    if not new_trades:
        return

    body = json.dumps({
        "instanceId": _INSTANCE_ID,
        "type": "trade_opened",
        "event": "trade_opened",
        "data": {"trades": new_trades},
    }).encode("utf-8")
    _post(body)

    _save_state({**state, "reported_opened_tickets": sorted(reported)})
    logger.info("reported %d open trade(s) to webhook", len(new_trades))


def report_status():
    """Posts the latest dashboard snapshot (equity/balance/open positions)."""
    if not _WEBHOOK_URL:
        return
    if not os.path.exists(config.DASHBOARD_SNAPSHOT_FILE):
        return
    try:
        with open(config.DASHBOARD_SNAPSHOT_FILE, "r") as f:
            snapshot = json.load(f)
    except (json.JSONDecodeError, OSError):
        return

    body = json.dumps({
        "instanceId": _INSTANCE_ID,
        "type": "status",
        "event": "status",
        "data": snapshot,
    }).encode("utf-8")
    _post(body)
