# TOPTIER Trading Bot Service

Server-side control plane that runs the MT5/MT4 trading bot for linked user
accounts. Each account gets its own isolated bot instance (a subprocess with
its own generated `config.py`, logs, and trade log), so one server can trade
for many users without them sharing state.

```
mini-services/bot/
├── server.py          FastAPI control plane (subprocess manager)
├── runner.py          per-instance entrypoint: writes config, launches engine
├── instance_util.py   workspace + config.py generation helpers
├── settings.py        env-driven service configuration
├── mt4_bridge/        MT4 support (ToptierBridge.mq4 EA + file bridge client)
└── data/instances/    runtime state per account (never committed)
```

The trading engine itself lives in `../../(mt5_trading_bot)/`. The service
reuses it unchanged; per-account settings are injected by placing a generated
`config.py` at the front of `sys.path` (see `instance_util.write_config`).

## Requirements

- Windows (MT5 Python API only works alongside a running MT5 terminal).
- Python 3.9+ with the ENGINE dependencies installed:
  ```
  pip install -r ../../mt5_trading_bot/requirements.txt
  pip install -r requirements.txt
  ```
- One MetaTrader 5 terminal per **running** MT5 instance (the terminal must be
  installed and logged in on the server). Each MT5 instance uses its own
  terminal window/install directory — configure `MT5_PATH` per account.
- MT4 accounts: see `mt4_bridge/README.md` (needs the ToptierBridge.mq4 EA
  attached to a chart and `MT4_BRIDGE_DIR` pointed at the terminal's
  `MQL4\Files\` folder).

## Run

```
set BOT_SERVICE_KEY=change-me-shared-secret
set BOT_SERVICE_PORT=8765
uvicorn server:app --host 0.0.0.0 --port 8765
```

Environment variables (see `settings.py`):

| Variable            | Meaning                                            | Default          |
|---------------------|----------------------------------------------------|------------------|
| `BOT_SERVICE_KEY`   | Shared secret the app sends on every request (**required**) | —        |
| `BOT_SERVICE_HOST`  | Bind address                                       | `127.0.0.1`      |
| `BOT_SERVICE_PORT`  | Bind port                                          | `8765`           |
| `BOT_PYTHON`        | Python interpreter that launches instances (must have `MetaTrader5`) | `python` |
| `BOT_ENGINE_DIR`    | Path to the trading engine folder                  | `<repo>/mt5_trading_bot` |
| `BOT_DATA_DIR`      | Runtime instance data                              | `./data`         |

## API

All endpoints require the header `x-bot-service-key: <BOT_SERVICE_KEY>`.

| Method   | Path                            | Purpose                                  |
|----------|---------------------------------|------------------------------------------|
| GET      | `/api/health`                   | liveness                                 |
| GET      | `/api/instances`                | list instances + status                  |
| POST     | `/api/instances`                | create + start an instance               |
| GET      | `/api/instances/{id}`           | live status of one instance              |
| POST     | `/api/instances/{id}/start`     | (re)start an instance                    |
| POST     | `/api/instances/{id}/stop`      | stop gracefully (CTRL_BREAK → engine shutdown) |
| DELETE   | `/api/instances/{id}`           | stop + delete the workspace              |
| GET      | `/api/instances/{id}/logs`      | tail instance log (`?tail=200`)          |

Instance body (`POST /api/instances`):

```json
{
  "instanceId": "<prisma BotInstance.id>",
  "platform": "mt5",
  "login": "123456",
  "password": "…",
  "server": "ICMarketsSC-Demo",
  "terminalPath": "C:/Program Files/MT5/terminal64.exe",
  "webhookUrl": "https://app.example.com/api/bot/webhook",
  "serviceKey": "<same shared key the app checks>",
  "settings": { "MAX_RISK_PCT_PER_TRADE": 2.0, "SYMBOLS": ["EURUSD", "GBPUSD"] }
}
```

## How the app wires in

1. User links an MT5/MT4 account → `BotConnection` (password encrypted at rest).
2. User presses Start → app calls `POST /api/instances` with the spec above.
3. The instance reports closed trades + equity snapshots to the app's
   `/api/bot/webhook` (header `x-bot-service-key`), which stores them as
   `BotTrade` and updates the 50% profit share.
4. The app polls `GET /api/instances/{id}` (or reads the stored `lastSnapshot`)
   to render the dashboard.

## Security notes

- Broker passwords are only ever decrypted in the Next.js app, transferred to
  this service over HTTPS at instance-start, and written to the local
  `config.py`. Never log them.
- Restrict `BOT_SERVICE_PORT` to the app server / VPN. Do not expose it to the
  public internet without TLS + firewall rules.
- Each instance runs as a child of the service; kill the service to stop all
  instances (open positions keep their broker-side SL/TP).
