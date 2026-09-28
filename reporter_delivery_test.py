"""Verifies reporter.py never marks a trade delivered when the app rejected it.

Simulates the real outage: the app is unreachable, so _post fails. The ticket
must NOT be written to reporter_state.json, and must be re-sent on the next
scan once the app is reachable again.
"""
import csv
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "mt5_trading_bot"))

WORK = tempfile.mkdtemp(prefix="reporter-test-")

# Minimal stand-ins for the engine's config module.
import types

config = types.ModuleType("config")
config.WEBHOOK_URL = "https://example.invalid/api/bot/webhook"
config.BOT_SERVICE_KEY = "test-key"
config.INSTANCE_ID = "inst_test"
config.TRADE_LOG_FILE = os.path.join(WORK, "trade_log.csv")
config.PENDING_TRADES_FILE = os.path.join(WORK, "pending_trades.json")
config.DASHBOARD_SNAPSHOT_FILE = os.path.join(WORK, "dashboard_snapshot.json")
sys.modules["config"] = config

with open(config.TRADE_LOG_FILE, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["ticket", "symbol", "timeframe", "direction", "lot",
                                      "entry_price", "close_price", "sl_price", "tp_price",
                                      "profit", "result", "open_time", "close_time", "risk_amount"])
    w.writeheader()
    w.writerow({"ticket": "555", "symbol": "EURUSD", "timeframe": "M15", "direction": "BUY",
                "lot": "0.1", "entry_price": "1.0850", "close_price": "1.0900", "sl_price": "1.0800",
                "tp_price": "1.0950", "profit": "50.0", "result": "WIN",
                "open_time": "2026-09-28T10:00:00", "close_time": "2026-09-28T11:00:00",
                "risk_amount": "20.0"})

os.chdir(WORK)  # reporter_state.json is written relative to cwd
import reporter

failures = []


def check(label, cond):
    print(("PASS  " if cond else "FAIL  ") + label)
    if not cond:
        failures.append(label)


# Keep the genuine _post around before any monkeypatching so the network-level
# checks below exercise the real implementation.
real_post = reporter._post

# --- 1. app unreachable: nothing may be marked delivered -------------------
reporter._post = lambda body, timeout=6.0: False
reporter.report_closed_trades()

state = reporter._state()
check("failed POST does NOT mark the ticket as reported", not state.get("reported_tickets"))

# --- 2. app back up: the same trade is delivered and only then remembered ---
posted = []


def ok_post(body, timeout=6.0):
    posted.append(json.loads(body))
    return True


reporter._post = ok_post
reporter.report_closed_trades()

check("trade re-sent once the app is reachable", len(posted) == 1)
if posted:
    trades = posted[0]["data"]["trades"]
    check("re-sent payload carries the trade", len(trades) == 1 and trades[0]["ticket"] == "555")
    check("re-sent payload keeps the profit", abs(float(trades[0]["profit"]) - 50.0) < 1e-9)
check("ticket marked reported only after a 200", reporter._state().get("reported_tickets") == ["555"])

# --- 3. no duplicate sends once acknowledged -------------------------------
posted.clear()
reporter.report_closed_trades()
check("already-delivered ticket is not re-sent", len(posted) == 0)

# --- 4. _post() reports failure truthfully on a network error --------------
import urllib.request


def boom(*a, **k):
    raise OSError("simulated connection refused")


_real_urlopen = urllib.request.urlopen
urllib.request.urlopen = boom
try:
    check("_post returns False when the network fails", real_post(b"{}") is False)
finally:
    urllib.request.urlopen = _real_urlopen

# --- 5. _post() returns True on a 200 -------------------------------------
class _Resp:
    status = 200

    def read(self):
        return b"{}"

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


urllib.request.urlopen = lambda *a, **k: _Resp()
try:
    check("_post returns True on HTTP 200", real_post(b"{}") is True)
finally:
    urllib.request.urlopen = _real_urlopen

# --- 6. _post() returns False on a 5xx (must not count as delivered) -------
class _Resp500(_Resp):
    status = 503


urllib.request.urlopen = lambda *a, **k: _Resp500()
try:
    check("_post returns False on HTTP 503", real_post(b"{}") is False)
finally:
    urllib.request.urlopen = _real_urlopen

# --- 7. independent full outage -> recovery cycle -------------------------
# Reset delivered-state so this cycle starts from a genuinely pending trade.
reporter._save_state({})
check("starting from an empty delivered-state",
      not reporter._state().get("reported_tickets"))

reporter._post = lambda body, timeout=6.0: False
reporter.report_closed_trades()
check("outage: trade stays unacknowledged",
      "555" not in reporter._state().get("reported_tickets", []))

# Simulate several failed scans while the app is still down.
for _ in range(3):
    reporter.report_closed_trades()
check("still unacknowledged after repeated failed scans",
      "555" not in reporter._state().get("reported_tickets", []))

posted.clear()
reporter._post = ok_post
reporter.report_closed_trades()
check("recovery: the backlogged trade is delivered exactly once", len(posted) == 1)
if posted:
    check("recovery: delivered trade is the right one",
          posted[0]["data"]["trades"][0]["ticket"] == "555")
check("recovery: marked reported only after the 200",
      reporter._state().get("reported_tickets") == ["555"])

print()
if failures:
    print(f"{len(failures)} FAILED: " + ", ".join(failures))
    sys.exit(1)
print("all reporter delivery-guarantee checks passed")
