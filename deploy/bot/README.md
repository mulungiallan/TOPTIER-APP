# TOPTIER Bot Service — Windows VPS deploy

This folder deploys the **auto-trading bot service** that the app controls from
inside the web UI. Users only ever see the app; the service runs on a Windows
server next to the MetaTrader 5/4 terminals.

## What gets deployed

```
deploy/bot/install.ps1     one-command installer (run as Administrator)
mt5_trading_bot/           the trading engine (traded unchanged, config injected)
mini-services/bot/         FastAPI control plane (spawns one bot per account)
```

## Requirements on the server

- Windows Server 2019/2022 (or Windows 10/11)
- Python 3.9+ on PATH (`python --version`)
- MetaTrader 5 installed and **logged in** to the broker account. The engine
  connects through the running terminal, so leave it open.
  - MT4 accounts additionally need the `ToptierBridge.mq4` EA attached to a
    chart — see `mini-services/bot/mt4_bridge/README.md`.
- One MetaTrader terminal per **running** bot instance (each instance uses its
  own terminal via `terminalPath`).

## Install

Run PowerShell **as Administrator**:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1 -ServiceKey "the-same-long-secret-as-the-app" -Port 8765 -InstallService
```

Arguments:

| Flag | Meaning | Default |
|------|---------|---------|
| `-ServiceKey` | Shared secret — **must match the app's `BOT_SERVICE_KEY`** | (required) |
| `-Port` | Service bind port | `8765` |
| `-InstallService` | Register as a Windows service via NSSM | off |
| `-PythonPath` | Python.exe with the `MetaTrader5` package | `python` |
| `-NoService` | Start in the foreground instead | (use alone) |

The installer:
1. installs engine + service pip dependencies,
2. writes `mini-services/bot/.env` (service settings),
3. with `-InstallService`, registers a **ToptierBot** service through NSSM
   (downloaded to `C:\ToptierTools\nssm.exe` if absent) and starts it,
4. otherwise prints the exact `uvicorn` command to run manually.

## Verify

```powershell
curl.exe http://127.0.0.1:8765/api/health
```

Expect `{"status":"ok","service":"toptier-bot",...}`.

## App side

In the app's `.env`:

```
BOT_SERVICE_URL=http://127.0.0.1:8765        # same box, or http://<windows-vps-ip>:8765
BOT_SERVICE_KEY=<the-same-long-secret>       # MUST be identical on both sides
BOT_CREDENTIALS_SECRET=<long random secret>  # never change after first use
```

Then inside the app: Trading Bot → Link MT5/MT4 → Start. The app spawns the
bot on the server and shows live status, logs, trades and profit share — all
in the UI.

## Capacity (important for a worldwide service)

Every running bot needs its own logged-in MetaTrader terminal (~300MB+ RAM
each). Plan roughly **20–30 concurrent bots per 16GB RAM VPS** and scale out
by adding servers — the app already isolates instances per account, so adding
another Windows VPS just means pointing some users' instances at it.
