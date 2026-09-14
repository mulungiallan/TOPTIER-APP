# Trading Signals Engine

A Python package that fetches market data (stocks, forex, crypto), computes
technical indicators, generates signals from 10 strategy families, backtests
them, and produces interactive charts — all exposed via a FastAPI JSON layer
you can embed in your app.

## Install

```bash
pip install -r requirements.txt
```

## Strategies implemented

| # | Strategy | Function |
|---|----------|----------|
| 1 | Trend following (MA crossover) | `strategies.trend_following` |
| 2 | Mean reversion (Bollinger + RSI) | `strategies.mean_reversion` |
| 3 | Momentum (rate of change) | `strategies.momentum` |
| 4 | Swing trading (EMA cross + RSI band) | `strategies.swing_trading` |
| 5 | Scalping (fast EMA cross + vol filter) | `strategies.scalping` |
| 6 | Statistical arbitrage (z-score proxy) | `strategies.stat_arbitrage` |
| 7 | Market making bias (fair-value deviation) | `strategies.market_making_bias` |
| 8 | Pairs trading (two-asset spread) | `strategies.pairs_trading` |
| 9 | Breakout (N-period high/low) | `strategies.breakout` |
| 10 | Carry trade (rate differential, FX) | `strategies.carry_trade` |

Strategies 1–7 and 9 share a single-asset interface and are run together by
`strategies.run_all_strategies()`, which also returns a `composite` (sum of
signals) and `consensus` (majority-vote -1/0/1) column. Pairs trading and
carry trade need extra inputs (a second asset, and interest rates
respectively) so call them directly.

## Quick start (CLI)

```bash
python -m trading_signals.main --market stock --symbol AAPL --period 1y --interval 1d
python -m trading_signals.main --market crypto --symbol BTC/USDT --interval 1h
python -m trading_signals.main --market forex --symbol EURUSD --period 1y --interval 1d
```

This prints the latest signal from every strategy, backtests the consensus
signal, and saves an interactive chart to `chart.html`.

## Quick start (API — for embedding in your app)

```bash
uvicorn trading_signals.api:app --reload --port 8000
```

Then:

```
GET /signals?market=stock&symbol=AAPL&period=6mo&interval=1d
GET /backtest?market=crypto&symbol=BTC/USDT&strategy=trend_following&interval=1h
GET /chart?market=forex&symbol=EURUSD&strategy=consensus
```

`/signals` returns JSON like:

```json
{
  "market": "stock",
  "symbol": "AAPL",
  "interval": "1d",
  "latest_price": 227.43,
  "as_of": "2026-09-09 00:00:00",
  "signals": {
    "trend_following": 1,
    "mean_reversion": 0,
    "momentum": 1,
    "swing_trading": 1,
    "scalping": -1,
    "stat_arbitrage": 0,
    "market_making_bias": 0,
    "breakout": 1,
    "composite": 3,
    "consensus": 1
  }
}
```

Your app can poll this endpoint, or call the Python functions directly if
it's also Python-based (see `main.py` for the pattern).

## App backend modules (portfolio, orders, alerts, risk, watchlists, news)

Six modules extend the signal engine into a full trading-app backend. Each
is a plain Python module you can call directly, and each is also wired into
the FastAPI layer in `api.py`. All state (orders, trades, alerts,
watchlists, risk settings) persists in a local SQLite file
(`trading_app.db`, path configurable via the `TRADING_APP_DB` env var) so
data survives restarts. Swap `db.get_connection()` for Postgres/MySQL later
without touching the other modules — they only call `db.execute()` /
`db.query_all()` / `db.query_one()`.

### Orders (`orders.py`) — paper trading engine
Supports market, limit, stop, stop-limit, trailing-stop, and OCO (one-cancels-other)
orders. **This simulates fills against fetched market data — it does not
place real broker orders.** To go live, replace `_execute_fill()`'s internals
with a call to your broker/exchange API; every other function (order
creation, OCO linking, trailing-stop tracking) is unchanged.
```
POST   /orders                     create an order
GET    /orders                     list orders (filter by status)
POST   /orders/{id}/cancel         cancel an open order
POST   /orders/check-pending       evaluate open limit/stop/trailing orders — call this on a schedule
```

### Portfolio & P&L (`portfolio.py`)
Builds positions and realized P&L directly from filled trades using FIFO
lot matching (the default method most brokers use). Unrealized P&L is
computed by marking open positions to the latest fetched price.
```
GET /portfolio/summary        positions + unrealized/realized/total P&L
GET /portfolio/positions      just open positions with avg cost
GET /portfolio/realized-pnl   closed-lot history with per-lot P&L
GET /portfolio/trades         raw trade/fill history
```

### Alerts (`alerts.py`)
Price alerts (`price_above`/`price_below`) or indicator alerts (any column
from `indicators.add_all_indicators`, e.g. `field=rsi_14, comparator=<,
threshold=30`). Alerts fire once then move to `triggered` status.
```
POST /alerts             create an alert
GET  /alerts             list alerts (filter by status)
POST /alerts/{id}/cancel cancel an alert
POST /alerts/check       evaluate all active alerts — call this on a schedule (1-5 min)
```

### Risk management (`risk.py`)
Percent-risk position sizing, portfolio concentration/exposure, and a daily
loss circuit breaker that halts new trades once a configurable daily loss
% is breached (resets the next UTC day).
```
GET  /risk/settings          current per-user risk settings
PUT  /risk/settings          update settings (equity, max daily loss %, etc.)
POST /risk/position-size     {entry_price, stop_price} -> suggested quantity
GET  /risk/exposure          concentration by symbol/market
GET  /risk/circuit-breaker   check before allowing a new order; halted=True blocks trading
```

### Watchlists (`watchlist.py`)
```
POST   /watchlists                    create a watchlist
GET    /watchlists                    list all watchlists
GET    /watchlists/{id}               get one with its items
POST   /watchlists/{id}/items         add a symbol (with optional tags)
DELETE /watchlists/{id}/items         remove a symbol
DELETE /watchlists/{id}               delete a watchlist
```

### News & calendars (`news.py`)
Stock/forex news via `yfinance` (no key needed); crypto news via
CryptoCompare's public API (no key needed). Economic and earnings
calendars use Finnhub's free tier — set `FINNHUB_API_KEY` to enable them;
without it, these endpoints return a clear note instead of failing.
```
GET /news                       ?market=stock&symbol=AAPL
GET /calendar/economic          ?days_ahead=7
GET /calendar/earnings          ?symbol=AAPL (or omit for broad calendar, needs API key)
```

### Multi-user note
Every function takes a `user_id` (default `"default"`). If your app has
multiple users, pass their real user id through from your auth layer —
all data (orders, alerts, watchlists, risk settings) is already scoped by it.

### Wallets (`ledger.py`, `cash_wallet.py`, `crypto_wallet.py`, `payment_provider.py`, `custody_provider.py`)

Both wallets sit on top of a shared **double-entry ledger** (`ledger.py`) —
the same accounting pattern banks and exchanges use, where every movement
is two entries (a debit and a credit) that must sum to zero. This makes it
structurally impossible for a bug to silently create or destroy money;
`post_transaction()` refuses anything that doesn't balance, and
`verify_books_balance()` is a sanity check you can run on a schedule.

**Neither wallet moves real value on its own.** Actual settlement is
delegated to a provider:
- `payment_provider.py` — fiat movement via a licensed processor (Stripe, Plaid + bank partner, Dwolla). Ships with `MockPaymentProvider` for development.
- `custody_provider.py` — crypto movement via a specialized custodian (Fireblocks, BitGo, Coinbase Custody, Anchorage). Ships with `MockCustodyProvider`. **This app's code never generates or stores a private key** — that boundary is intentional; see the module's docstring for why.

```
GET  /wallet/cash/balance             ?user_id=...&currency=USD
POST /wallet/cash/deposit             pulls funds via payment provider, credits ledger
POST /wallet/cash/withdraw            debits ledger, pushes payout via payment provider
GET  /wallet/cash/transactions        ledger history for a user's cash account

GET  /wallet/crypto/balance           ?user_id=...&asset=BTC
POST /wallet/crypto/deposit-address   get/create a deposit address for a user+asset
POST /wallet/crypto/withdraw          debits ledger, asks custody provider to send on-chain
GET  /wallet/crypto/transactions      ledger history for a user's crypto account

GET  /wallet/ledger/verify            books-balance sanity check — run on a schedule
```

**Before this ever touches real money:**
1. Talk to a fintech/regulatory lawyer about money transmitter licensing and KYC/AML obligations for your jurisdiction(s) — this is very likely required for a custodial wallet, and the answer depends heavily on where your users are.
2. Replace `MockPaymentProvider` with a real processor integration, tested in their sandbox first.
3. Replace `MockCustodyProvider` with a real custody provider integration. Do not attempt to build your own private-key storage.
4. `credit_confirmed_deposit()` must only be called from a verified webhook handler (with signature verification) — never from user-facing code — and only after the provider considers the deposit final (enough confirmations).
5. Add a withdrawal review policy (limits, delays, manual review above a threshold) before going live — on-chain and most fiat rails are irreversible once sent.

### Alerts, TP/SL & signal notifications with sound + vibration (`alerts.py`, `notifications.py`)

**Important boundary:** this backend detects when a condition is met and
queues a notification describing what should happen — it cannot make a
phone vibrate or play a sound itself. That final step happens in your
client app using the device's own APIs. `client_demo.html` (included) is a
working reference showing exactly that handoff in a browser; port the same
logic into React Native (`expo-notifications` + `expo-av` or
`react-native-sound`) or Flutter (`flutter_local_notifications` +
`vibration` package) for a real mobile app.

**Alert types**, each created with a `sound` and `vibration` setting
(`"default"`, `"silent"`, or a custom sound filename / comma-separated
millisecond vibration pattern like `"200,100,200"`):
- `price_above` / `price_below` — plain price alerts
- `indicator` — any column from `indicators.add_all_indicators` (e.g. RSI crossing 30)
- `take_profit` / `stop_loss` — created together via `create_tp_sl_alert()`, which infers the correct direction from the position's side
- `signal` — fires when a strategy's signal (or `consensus`) flips to a target value, via `create_signal_alert()`

```
POST /alerts              generic alert (price/indicator)
POST /alerts/tp-sl         {market, symbol, side, entry_price, take_profit_price?, stop_loss_price?}
POST /alerts/signal        {market, symbol, strategy_name, target_value}
GET  /alerts               list (filter by status/category)
POST /alerts/{id}/cancel
POST /alerts/check         evaluate all active alerts — call on a schedule (1-5 min); fires push + queues notifications
```

**Delivery — two options, use either or both:**
```
GET  /notifications/pending          poll for anything not yet delivered
POST /notifications/{id}/ack         call after showing it + playing sound/vibration
WS   /ws/notifications/{user_id}     real-time push — recommended over polling for a "real" alert system
```
On WebSocket connect, any notifications queued while the client was offline
are flushed immediately, then new ones stream in as `/alerts/check` fires
them. The connection manager in `api.py` is in-memory and single-process;
if you scale to multiple backend instances, swap it for a shared pub/sub
(Redis, etc.) so a notification fired on one instance reaches a client
connected to another.

**Try the reference client:** open `client_demo.html` in a browser, point
it at your running API (`uvicorn trading_signals.api:app --port 8000`),
click Connect, then trigger an alert (e.g. via `/alerts/check` once a
price condition is met) — you'll see it arrive, play a sound, and vibrate
(on a device that supports the Vibration API; most desktop browsers don't,
but phones do). "Simulate incoming alert" previews the behavior with zero
backend required.

## Data sources

- **Stocks**: `yfinance` (free, delayed data — fine for signals, not for
  latency-sensitive execution)
- **Forex**: `yfinance` using tickers like `EURUSD=X`
- **Crypto**: `ccxt`, default exchange `binance` (swap `exchange_id` for
  others it supports)

## Important caveats — read before connecting real money

**On the order engine specifically:** `orders.py` is a paper-trading
simulator. It fills orders against prices it fetches (not a live order
book), which means no partial fills, no slippage beyond the flat fee
assumption, and no guarantee a real exchange would have filled at that
price. Treat every fill from this module as a simulation until you've
wired `_execute_fill()` to a real broker/exchange API and tested it in
that broker's sandbox environment first.

**On the circuit breaker:** `check_circuit_breaker()` only *reports* a halt
state — your app's order-placement code must actually check it and block
the request. It doesn't intercept calls to `orders.place_order()` on its
own.


- **This is a signal/backtesting toolkit, not a guarantee of profit.**
  Every strategy here is a simplified, well-known template; real edge comes
  from tuning parameters to your specific asset/timeframe and from careful
  risk management, not from the strategy list itself.
- **Backtests are optimistic by default.** The included backtester assumes
  fills at the next bar's price with a flat fee — no slippage curve, no
  partial fills, no market-impact model. Live results will differ, often
  worse, especially for scalping/market-making at low fee assumptions.
- **Free data has gaps.** `yfinance` can silently return partial or stale
  data; always validate before trusting a signal, especially intraday.
- **Nothing here is financial advice.** Test extensively in a paper-trading
  or sandboxed environment before wiring signals to live order execution.
