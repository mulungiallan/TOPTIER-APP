"""Runs bot.main() end-to-end against a FAKE MetaTrader5 module (no terminal needed).

    python smoke_check.py

Checks the loop wiring: signal -> sizing -> guard gate -> order -> position tracking -> flatten.
It does NOT prove anything about MT5 quirks or profitability; test on a demo account for that.
"""
import json
import os
import sys
import tempfile
import time
import types
from datetime import datetime, timedelta, timezone

import numpy as np

import backtest
from strategy import StrategyParams, compute_indicators, signal_at

# ---- build a bar window whose last CLOSED bar triggers a signal ---------------------------------
df = backtest.synthetic()
sp = StrategyParams()
cols = ["open", "high", "low", "close"]
arr = df[cols].to_numpy(float)
WIN = 1500
pick = None
for i in range(2000, len(df) - 2):
    w = arr[i - WIN + 1:i + 1]
    ind = compute_indicators(w[:, 0], w[:, 1], w[:, 2], w[:, 3], sp)
    d, a = signal_at(ind, WIN - 1, sp)
    if d:
        pick = i
        break
assert pick, "no signal found in synthetic data"
win = arr[pick - WIN + 1:pick + 2]                     # +1 = the still-forming bar (bot drops it)
rates = np.zeros(len(win), dtype=[("time", "i8"), ("open", "f8"), ("high", "f8"), ("low", "f8"),
                                  ("close", "f8"), ("tick_volume", "i8")])
rates["time"] = np.arange(len(win)) * 900 + 1_700_000_000
for k, c in enumerate(cols):
    rates[c] = win[:, k]
last_close = float(win[-2, 3])

# ---- fake MetaTrader5 -------------------------------------------------------------------------
M = types.ModuleType("MetaTrader5")
M.TIMEFRAME_M15, M.ORDER_TYPE_BUY, M.ORDER_TYPE_SELL = 15, 0, 1
M.TRADE_ACTION_DEAL, M.ORDER_TIME_GTC = 1, 0
M.ORDER_FILLING_IOC, M.ORDER_FILLING_FOK, M.ORDER_FILLING_RETURN = 1, 0, 2
M.TRADE_RETCODE_DONE, M.TRADE_RETCODE_REQUOTE, M.TRADE_RETCODE_PRICE_CHANGED, M.TRADE_RETCODE_PRICE_OFF = 10009, 10004, 10020, 10021
STATE = {"positions": [], "orders": [], "closed": [], "next": 1000}
NT = lambda **k: types.SimpleNamespace(**k)  # noqa: E731

M.initialize = lambda **k: True
M.shutdown = lambda: None
M.last_error = lambda: (0, "ok")
M.symbol_select = lambda s, f: True
M.account_info = lambda: NT(login=1, balance=100000.0, equity=100000.0 + sum(p.profit for p in STATE["positions"]), currency="USD")
M.positions_get = lambda: list(STATE["positions"])
M.history_deals_get = lambda a, b: []
M.copy_rates_from_pos = lambda s, tf, pos, n: rates.copy()
M.symbol_info = lambda s: NT(trade_tick_size=0.00001, trade_tick_value=1.0, volume_min=0.01,
                             volume_max=100.0, volume_step=0.01, filling_mode=2)
M.symbol_info_tick = lambda s: NT(bid=last_close, ask=last_close + 0.00010, time=int(time.time()) + 3 * 3600)


def order_send(req):
    if "position" in req:                              # close
        STATE["positions"] = [p for p in STATE["positions"] if p.ticket != req["position"]]
        STATE["closed"].append(req)
    else:
        STATE["next"] += 1
        STATE["orders"].append(req)
        STATE["positions"].append(NT(ticket=STATE["next"], symbol=req["symbol"], type=req["type"],
                                     volume=req["volume"], profit=0.0, swap=0.0,
                                     time=int(time.time()) + 3 * 3600))
    return NT(retcode=M.TRADE_RETCODE_DONE, order=STATE["next"])


M.order_send = order_send
sys.modules["MetaTrader5"] = M

# ---- run the bot for a few loops -------------------------------------------------------------
tmp = tempfile.mkdtemp()
os.chdir(tmp)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ev = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
open("cal.csv", "w").write(f"time_utc,currency,impact,title\n{ev},USD,High,Far-away event\n")
json.dump({"mt5": {"server_utc_offset_hours": 3.0}, "symbols": ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"],
           "news": {"calendar_file": "cal.csv"}}, open("config.json", "w"))

import bot  # noqa: E402

calls = {"n": 0}


def fake_sleep(_):
    calls["n"] += 1
    if calls["n"] == 2:                                # both trades go against us: -400 each
        for p in STATE["positions"]:
            p.profit = -400.0
    if calls["n"] >= 5:
        raise KeyboardInterrupt


bot.time.sleep = fake_sleep
sys.argv = ["bot.py", "--model", "zero", "--phase", "master", "--size", "100000"]
bot.main()

now = datetime.now(timezone.utc)
in_session = now.weekday() < 5 and 7 * 60 <= now.hour * 60 + now.minute < 16 * 60 + 30
print("\n=== RESULT ===")
print("orders sent:", len(STATE["orders"]), "| positions:", len(STATE["positions"]))
for o in STATE["orders"]:
    print("  ", o["symbol"], "BUY" if o["type"] == 0 else "SELL", o["volume"], "lots  SL", round(o["sl"], 5), "TP", round(o["tp"], 5))
if in_session:
    assert len(STATE["orders"]) == 2, "expected exactly max_positions=2 orders (others blocked, no re-entry)"
    assert all(o["sl"] and o["tp"] for o in STATE["orders"]), "every order must carry SL and TP"
    assert len(STATE["closed"]) == 2 and not STATE["positions"], "open-risk breach must flatten everything"
    print("PASS: 2 orders w/ SL+TP, max_positions respected, auto-flatten at floating -800, no re-entry after halt")
else:
    assert len(STATE["orders"]) == 0, "must not trade outside the session window"
    print("PASS: outside session window -> no orders (correct gating)")
