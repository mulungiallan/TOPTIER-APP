# Copy Trading Relay System

Relays trades from your MetaTrader account (already copying your friend) into your
own backend, applies your own risk rules, then fans them out to subscriber accounts.

```
Friend's MT account
      |  (MT4/MT5 built-in Signals or a trade copier tool — not built here)
      v
Your MT account  ---(connector/mt5_watcher.py)--->  Backend API (backend/)
                                                          |
                                                          |  your rules applied here
                                                          v
                                        Subscriber clients (subscriber/subscriber_client.py)
                                                          |
                                                          v
                                              Each subscriber's own MT account
```

## Components

- **connector/mt5_watcher.py** — runs next to YOUR MetaTrader terminal. Polls your
  open positions and POSTs new trade events (open AND close) to the backend, with
  rotating file logging. This is Layer 1.

- **backend/** — FastAPI service. This is Layer 2.
  - `main.py` — the API: receive signals, serve pending signals to subscribers,
    look up a subscriber's local ticket when closing, confirm execution, and
    report expected-open tickets for reconciliation.
  - `models.py` — DB schema: signals, subscribers, relayed trades (with local
    ticket + realized P/L tracking).
  - `rules.py` — YOUR risk rules (symbol blacklist, max volume, etc). Close
    signals always bypass these rules — a subscriber must always be able to
    exit a position you've already exited yourself.
  - `auth.py` — API keys are hashed (SHA-256) before storage; plaintext is
    shown once at creation and never stored.
  - `add_subscriber.py` — CLI to register a subscriber, including an optional
    daily loss limit, and print their one-time API key.

- **subscriber/** — runs next to a SUBSCRIBER's MetaTrader terminal. This is Layer 3.
  - `subscriber_client.py` — polls for approved signals, opens new trades scaled
    to that subscriber's lot multiplier/max, and closes the matching position
    when a close signal arrives (matched via the backend's open-ticket lookup).
    Reports realized P/L back to the backend on every close.
  - `reconcile.py` — run periodically (e.g. cron every 15 min) to diff what the
    backend expects to be open against what's actually open in MT5, and flag
    drift for manual review. Does not auto-correct anything.

## Daily loss kill-switch

Set `--daily-loss-limit` when creating a subscriber (in account currency). Once
their realized losses for the day reach that amount, the backend stops handing
them new "opened" signals until the next UTC day — closes are still always
delivered, so they're never stuck unable to exit.

## Setup

```bash
pip install -r requirements.txt
```

1. Run the backend somewhere reachable by both you and subscribers:
   ```bash
   cd backend
   export PROVIDER_API_KEY=some_long_random_string
   export DATABASE_URL=sqlite:///./copytrading.db   # swap for Postgres before real use
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```
2. Register each subscriber and give them their one-time API key:
   ```bash
   cd backend
   python add_subscriber.py "Jane Doe" --lot-multiplier 0.5 --max-lot 0.5 \
       --symbols EURUSD,GBPUSD --daily-loss-limit 200
   ```
3. Copy `connector/.env.example` to `connector/.env`, fill in your MT5 login and
   the backend URL/`PROVIDER_API_KEY`, then run it on the machine where YOUR MT5
   terminal is logged in (Windows, or Wine/a VPS — the MT5 Python package needs
   a real MT5 terminal running locally):
   ```bash
   cd connector && python mt5_watcher.py
   ```
4. Each subscriber copies `subscriber/.env.example` to `subscriber/.env`, fills
   in their own MT5 login and the API key you gave them, then runs:
   ```bash
   cd subscriber && python subscriber_client.py
   ```
   Optionally schedule `subscriber/reconcile.py` every 15 minutes to catch drift.

## Before you open this to real subscribers

Running a service where other people's live accounts execute trades based on
signals you relay is regulated activity in most countries (e.g. acting as a signal
provider / commodity trading advisor / investment adviser), even if you never hold
their funds. This code is a technical starting point, not a compliance solution —
check your local financial regulator's requirements before onboarding real users,
and read the disclaimers in `backend/rules.py` and `subscriber/subscriber_client.py`.

This is also a v1 scaffold, not a finished production system. See "Hardening
checklist" at the bottom of this file before running it with real money.

## Hardening checklist

- [x] API keys are hashed (SHA-256) before storage — see `backend/auth.py`
- [x] Idempotency: `signal_id` + `subscriber_id` unique constraint in `models.py`
      prevents a signal being executed twice for the same subscriber
- [x] Per-subscriber daily loss kill-switch (`--daily-loss-limit`)
- [x] Close-trade propagation: closing a position in your account closes the
      matching position in every subscriber's account
- [x] Rotating file logging on the connector and subscriber client
- [x] Reconciliation script to detect drift between backend and actual MT5 state
- [ ] TLS — run the backend behind HTTPS (e.g. Caddy/nginx reverse proxy), never
      plain HTTP for API keys or trade data. Not code — a deployment step.
- [ ] Move `DATABASE_URL` from SQLite to Postgres before real concurrent
      subscriber load (SQLite serializes writes and will bottleneck).
- [ ] Real auth beyond bearer API keys (e.g. OAuth, key rotation, per-key
      rate limiting) if this grows past a small trusted group.
- [ ] Alerting (e.g. push a Slack/Telegram message) when a trade relay fails,
      rather than only logging it — logs don't wake you up.
- [ ] Legal review for your jurisdiction before accepting real subscribers.
