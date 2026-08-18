# MT4 Bridge (MetaTrader 4 support)

MetaTrader 4 ships no Python API, so MT4 accounts are driven through a small
Expert Advisor that runs inside the user's MT4 terminal and executes commands
the bot service sends it. The EA is a *bridge only* — all strategy, risk, and
backtest logic still runs in the Python engine (`mt5_connector` interface).

## Architecture

```
Python bot service                    MT4 terminal (user's machine / VPS)
┌────────────────────────┐   files   ┌───────────────────────────────┐
│ mt4_connector.py       │ tb_cmd.cmd │  ToptierBridge.mq4 (on a chart)│
│ (engine's mt5_connector│ ─────────► │  polls cmd file every poll ms  │
│  shim) writes cmd file │ tb_resp.cmd│  executes: RATES/ORDER/...     │
│ polls resp file        │ ◄───────── │  writes response file          │
└────────────────────────┘           └───────────────────────────────┘
```

Files used (both in the terminal's `MQL4\Files\` folder):
- `tb_cmd.cmd`  — one line: `CMD|<id>|<command>|<args…>`
- `tb_resp.cmd` — one line: `OK|<id>|<data…>` or `ERR|<id>|<message>`

A unique `<id>` correlates each request/response. The Python connector
(`mt4_connector.py`) implements the exact `mt5_connector.py` interface, so the
rest of the trading engine is platform-agnostic.

## Commands supported

`PING`, `INFO` (account), `SYMBOL`, `SPREAD`, `RATES` (last N candles),
`ORDER` (market), `MODIFY` (SL/TP), `CLOSE` (full or partial),
`POSITIONS`, `DEALS` (closing deals since epoch — feeds the trade tracker).

## Setup

1. Open the user's MT4 terminal (the account must be logged in).
2. Copy `ToptierBridge.mq4` into `MQL4\Experts\ToptierBridge\`.
3. In MetaEditor: Compile (F7) — no errors expected on modern MT4 builds.
4. Drag the EA onto any chart (it drives the whole terminal, so one chart is
   enough). Enable **"Allow Algorithmic Trading"** (the AutoTrading button)
   or the EA cannot place orders.
5. Tell the bot service where the terminal's Files folder is. Set
   `MT4_BRIDGE_DIR` in the instance config to
   `<MT4 install>\MQL4\Files\` (the instance workspace generates this path
   automatically; override if MT4 is installed in a non-default location).
6. Start the bot from the app. The Python connector waits (up to
   `MT4_BRIDGE_TIMEOUT_SECONDS`) for the EA to respond.

## Caveats

- **One instance per MT4 terminal.** The bridge filenames are fixed
  (`tb_cmd.cmd` / `tb_resp.cmd`), so a second instance on the same terminal
  would race. If you run several MT4 accounts on one machine, use one MT4
  terminal (install dir) per account — the same as MT5.
- Keep the EA attached while the bot runs; detaching stops command processing.
- `ORDER` uses a market order with the requested SL/TP in price units. The
  engine already computes these from ATR; broker minimum-distance rules may
  widen them (the Python side handles the retry logic exactly like MT5).
- The bridge is best-effort: if the EA is unreachable, orders fail loudly in
  the instance log instead of trading silently.
