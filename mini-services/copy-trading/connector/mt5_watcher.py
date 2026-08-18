"""
Layer 1 — Signal capture.

Runs on the machine where YOUR MetaTrader 5 terminal is logged in (the account
that is already copying trades from your friend). Polls for new/changed
positions and forwards each one to the backend as a normalized signal.

NOTE: The official `MetaTrader5` Python package only works on Windows, because
it talks to a locally running MT5 terminal over a native bridge. If your
terminal runs on Linux/Mac via Wine, run this script under the same Wine
Python environment.

Usage:
    python mt5_watcher.py
"""

import time
import logging
from logging.handlers import RotatingFileHandler
from dataclasses import dataclass, asdict
from typing import Optional

import requests
import MetaTrader5 as mt5
from dotenv import dotenv_values

log = logging.getLogger("mt5_watcher")
log.setLevel(logging.INFO)
_fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
_console = logging.StreamHandler()
_console.setFormatter(_fmt)
_file = RotatingFileHandler("mt5_watcher.log", maxBytes=2_000_000, backupCount=3)
_file.setFormatter(_fmt)
log.addHandler(_console)
log.addHandler(_file)

config = dotenv_values(".env")

MT5_LOGIN = int(config.get("MT5_LOGIN", "0"))
MT5_PASSWORD = config.get("MT5_PASSWORD", "")
MT5_SERVER = config.get("MT5_SERVER", "")
BACKEND_URL = config.get("BACKEND_URL", "http://localhost:8000")
API_KEY = config.get("PROVIDER_API_KEY", "")
POLL_SECONDS = float(config.get("POLL_SECONDS", "1.0"))


@dataclass
class TradeSignal:
    ticket: int
    symbol: str
    direction: str          # "buy" or "sell"
    volume: float
    price_open: float
    sl: float
    tp: float
    time_open: int
    status: str             # "opened" or "closed"


def connect() -> None:
    if not mt5.initialize(login=MT5_LOGIN, password=MT5_PASSWORD, server=MT5_SERVER):
        raise RuntimeError(f"MT5 initialize() failed: {mt5.last_error()}")
    log.info("Connected to MT5 account %s on %s", MT5_LOGIN, MT5_SERVER)


def get_open_tickets() -> dict:
    positions = mt5.positions_get()
    if positions is None:
        return {}
    result = {}
    for p in positions:
        result[p.ticket] = TradeSignal(
            ticket=p.ticket,
            symbol=p.symbol,
            direction="buy" if p.type == mt5.ORDER_TYPE_BUY else "sell",
            volume=p.volume,
            price_open=p.price_open,
            sl=p.sl,
            tp=p.tp,
            time_open=p.time,
            status="opened",
        )
    return result


def send_signal(signal: TradeSignal) -> None:
    payload = asdict(signal)
    try:
        resp = requests.post(
            f"{BACKEND_URL}/signals",
            json=payload,
            headers={"X-API-Key": API_KEY},
            timeout=5,
        )
        if resp.status_code >= 300:
            log.warning("Backend rejected signal %s: %s", signal.ticket, resp.text)
        else:
            log.info("Sent %s signal for ticket %s (%s %s %s)",
                      signal.status, signal.ticket, signal.direction, signal.volume, signal.symbol)
    except requests.RequestException as e:
        log.error("Failed to reach backend: %s", e)


def watch() -> None:
    connect()
    known: dict[int, TradeSignal] = get_open_tickets()
    log.info("Starting with %d open position(s) already tracked (not re-sent).", len(known))

    while True:
        try:
            current = get_open_tickets()

            # New trades opened since last poll
            for ticket, sig in current.items():
                if ticket not in known:
                    send_signal(sig)

            # Trades that were open before but are now gone -> closed
            for ticket, sig in known.items():
                if ticket not in current:
                    closed_sig = TradeSignal(**{**asdict(sig), "status": "closed"})
                    send_signal(closed_sig)

            known = current
        except Exception as e:
            log.exception("Error during poll cycle: %s", e)

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    watch()
