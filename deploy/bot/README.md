# TOPTIER Bot Service — Windows VPS deploy

This folder deploys the **auto-trading bot service** that the app controls from
inside the web UI. Users only ever see the app; the service runs on a Windows
server next to the MetaTrader 5/4 terminals.

## Fastest path: `bootstrap-vps.ps1`

On a **fresh Windows VPS** use the bootstrap script rather than the steps below.
It takes a bare Windows Server to a self-healing trading server in one run, and
is safe to re-run (every step is idempotent).

```powershell
# As Administrator on the new box
cd C:\path\to\app
Set-ExecutionPolicy -Scope Process Bypass -Force

# First pass — service only. Do this BEFORE logging into Cloudflare.
.\deploy\bot\bootstrap-vps.ps1 -ServiceKey "<the-app-s-BOT_SERVICE_KEY>" -SkipTunnel

# Then, once, interactively (opens a browser to authorise):
& 'C:\Cloudflare\cloudflared.exe' tunnel login
& 'C:\Cloudflare\cloudflared.exe' tunnel create toptier

# Second pass — adds the named tunnel as a service, DNS route, watchdog.
.\deploy\bot\bootstrap-vps.ps1 -ServiceKey "<key>" `
    -TunnelName toptier -Hostname bot.toptier.app
```

It performs: preflight (admin, Python, disk, clock) → pip deps → `ToptierBot`
service via NSSM (auto-start + crash restart) → `cloudflared` **as a service**
→ 5-minute watchdog task → verification that the service, the tunnel and a
*running engine* all answer. Exits non-zero if any step failed.

Two notes on why the tunnel is a service and not a quick tunnel: a quick tunnel
(`cloudflared tunnel --url`) hands out a **random hostname that changes on every
restart**, so the app's `BOT_SERVICE_URL` silently points at a dead host. It is
fine for a first test and unusable for unattended running.

## Manual install (existing server)

<details>
<summary>Step-by-step, if you'd rather not run the bootstrap</summary>

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

## Running 24/7

Three separate things must survive a reboot. All three are required; missing
any one leaves the bot silently stopped.

| Piece | What happens without it |
|-------|--------------------------|
| `-InstallService` (NSSM) | The service does not start with Windows. Needs an **elevated** PowerShell. |
| Named Cloudflare tunnel | `BOT_SERVICE_URL` breaks. A quick tunnel (`--url`) gets a **new random hostname on every restart**, so Railway keeps pointing at a dead host. |
| Engine autostart | The service comes back but **no engine starts** — nothing trades until someone clicks Start. On by default; per-instance opt-out is `settings.autostart = false`, global kill switch is `BOT_AUTOSTART=0`. |

The service is registered to **restart on unexpected exit** (NSSM
`AppExit Default Restart`, 10s delay, 15s throttle), so a crash or a bad
deploy recovers on its own instead of leaving a dead service registered.

A quick tunnel is fine for a first test. For unattended use, point a *named*
tunnel at port 8765 and set `BOT_SERVICE_URL` to its stable hostname:

```yaml
# cloudflared config.yml -- alongside the existing app ingress rule
ingress:
  - hostname: bot.toptier.app
    service: http://localhost:8765
  - hostname: app.toptier.app
    service: https://localhost:3000
  - service: http_status:404
```

Note `C:\Cloudflare\toptier.json` (the tunnel credentials file) must exist;
without it the named tunnel cannot start and only quick tunnels work.

## Verify

```powershell
# service is up
curl.exe http://127.0.0.1:8765/api/health

# an engine actually started (not just the service)
curl.exe http://127.0.0.1:8765/api/instances -H "x-bot-service-key: $env:BOT_SERVICE_KEY"
```

The second call is the one that catches the "service up, bot idle" failure —
every instance should report `"status": "running"` with a pid.

## Capacity (important for a worldwide service)

Every running bot needs its own **logged-in MetaTrader terminal** — that, not
CPU or RAM, is the real limit. Measured on a live instance:

| Per bot | RAM |
|---------|-----|
| Engine (peak, during warm-up) | ~110 MB |
| MT5 terminal (idle) | ~25 MB, up to ~150 MB when busy |
| Control service | ~15 MB, **shared** across all bots |

So a 4 vCPU / 8 GB box runs **20+ bots** on memory alone, and comfortably holds
the 2–3 most setups start with. The practical ceiling is how many MT5 terminals
you keep logged in.

CPU only matters during startup: the warm-up sweep is single-threaded, so N bots
starting at once use N cores for ~90 minutes. After that the sweep is cached and
restarts are instant. A 4 vCPU box starts ~4 bots at a time without slowdown.

If you ever run client money, prefer one VPS per account: a single box outage
then affects one account rather than all of them.
