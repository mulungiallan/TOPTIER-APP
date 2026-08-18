"""
Reconciliation check — run this periodically (e.g. via cron every 15 min,
or a Windows scheduled task) next to a subscriber's MT5 terminal.

Compares the set of local MT5 tickets the backend believes should still be
open for this subscriber (from GET /signals/expected_open) against what is
actually open in their MT5 account (tagged with this system's magic
number). Flags two kinds of drift:

  - MISSING: backend expects it open, but it's not open in MT5
             (e.g. a close was manually done, or a close signal failed
             silently on a previous run)
  - ORPHAN:  it's open in MT5 with our tag, but the backend doesn't expect
             it (e.g. a duplicate open, or a confirm call that failed to
             reach the backend after the trade executed)

This does NOT auto-correct anything — only reports. Auto-closing or
auto-opening positions from a reconciliation diff is risky (a transient
network blip could cause a "fix" for something that wasn't actually
broken), so a human should review anything flagged here.

Usage:
    python reconcile.py
"""

import logging
import requests
import MetaTrader5 as mt5
from dotenv import dotenv_values

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("reconcile")

config = dotenv_values(".env")
MT5_LOGIN = int(config.get("MT5_LOGIN", "0"))
MT5_PASSWORD = config.get("MT5_PASSWORD", "")
MT5_SERVER = config.get("MT5_SERVER", "")
BACKEND_URL = config.get("BACKEND_URL", "http://localhost:8000")
API_KEY = config.get("SUBSCRIBER_API_KEY", "")
COPY_TRADE_MAGIC = 900001


def main():
    if not mt5.initialize(login=MT5_LOGIN, password=MT5_PASSWORD, server=MT5_SERVER):
        raise RuntimeError(f"MT5 initialize() failed: {mt5.last_error()}")

    positions = mt5.positions_get()
    actual_open = {p.ticket for p in positions if p.magic == COPY_TRADE_MAGIC}

    try:
        resp = requests.get(
            f"{BACKEND_URL}/signals/expected_open",
            headers={"X-API-Key": API_KEY},
            timeout=5,
        )
        resp.raise_for_status()
        expected_open = set(resp.json().get("expected_open_local_tickets", []))
    except requests.RequestException as e:
        log.error("Could not reach backend for reconciliation: %s", e)
        return

    missing = expected_open - actual_open  # backend thinks open, MT5 doesn't have
    orphans = actual_open - expected_open  # open in MT5, backend doesn't expect

    if not missing and not orphans:
        log.info("Reconciliation OK — %d position(s) match backend expectations.", len(actual_open))
        return

    if missing:
        log.warning("MISSING: backend expects these tickets open but they are NOT in MT5: %s", sorted(missing))
    if orphans:
        log.warning("ORPHAN: these tickets are open in MT5 (tagged as copy trades) "
                     "but the backend does NOT expect them open: %s", sorted(orphans))
    log.warning("Review these manually — no automatic action was taken.")


if __name__ == "__main__":
    main()
