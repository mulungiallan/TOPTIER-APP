"""
FastAPI service exposing:
  GET /signals   -> latest signal per strategy + consensus, as JSON
  GET /backtest  -> performance stats for one strategy or the consensus
  GET /chart     -> interactive HTML chart with signal overlays

Run with:
    uvicorn trading_signals.api:app --reload --port 8000

Example:
    GET /signals?market=crypto&symbol=BTC/USDT&interval=1h
    GET /signals?market=stock&symbol=AAPL&period=6mo&interval=1d
    GET /signals?market=forex&symbol=EURUSD&period=6mo&interval=1d
    GET /backtest?market=stock&symbol=AAPL&strategy=trend_following
    GET /chart?market=stock&symbol=AAPL&strategy=consensus
"""

from __future__ import annotations
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import pandas as pd

from . import data_fetcher as dfetch
from . import indicators as ind
from . import strategies as strat
from . import backtester as bt
from . import charting
from . import watchlist as wl
from . import orders as ord_mod
from . import alerts as alert_mod
from . import risk as risk_mod
from . import portfolio as pf_mod
from . import news as news_mod
from . import cash_wallet as cash_mod
from . import crypto_wallet as crypto_mod
from . import ledger as ledger_mod
from . import notifications as notif_mod

ALERTS_CHECK_INTERVAL = int(os.environ.get("ALERTS_CHECK_INTERVAL_SECONDS", "180"))
ALERTS_LOGGER = logging.getLogger("trading_signals")


async def _run_alert_cycle() -> None:
    """Evaluate active alerts for every user and push any new notifications to
    that user's connected WebSocket clients. Errors are logged, never thrown,
    so a single bad feed can't take down the scheduler."""
    users = alert_mod.list_active_users()
    if not users:
        return
    for uid in users:
        try:
            fired = alert_mod.check_alerts(user_id=uid)
            if fired:
                for n in notif_mod.get_pending_notifications(uid):
                    await ws_manager.send_to_user(uid, n)
        except asyncio.CancelledError:
            raise
        except Exception:
            ALERTS_LOGGER.exception("Alert cycle failed for user %s", uid)


async def _alert_scheduler() -> None:
    while True:
        try:
            await asyncio.sleep(ALERTS_CHECK_INTERVAL)
            await _run_alert_cycle()
        except asyncio.CancelledError:
            break
        except Exception:
            ALERTS_LOGGER.exception("Alert scheduler error")


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(_alert_scheduler())
    try:
        yield
    finally:
        task.cancel()

app = FastAPI(title="Trading Signals API", version="0.3.1", lifespan=lifespan)


class ConnectionManager:
    """
    Minimal in-memory WebSocket connection registry, keyed by user_id. Fine
    for a single-process deployment; if you scale to multiple backend
    instances, replace this with a shared pub/sub (Redis, etc.) so a
    notification fired on one instance reaches a client connected to another.
    """

    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        self._connections.setdefault(user_id, []).append(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket):
        conns = self._connections.get(user_id, [])
        if websocket in conns:
            conns.remove(websocket)

    async def send_to_user(self, user_id: str, message: dict):
        for ws in list(self._connections.get(user_id, [])):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(user_id, ws)


ws_manager = ConnectionManager()


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------
class WatchlistCreate(BaseModel):
    name: str
    user_id: str = "default"


class WatchlistItemAdd(BaseModel):
    market: str
    symbol: str
    tags: str = ""


class OrderCreate(BaseModel):
    market: str
    symbol: str
    side: str  # 'buy' | 'sell'
    order_type: str  # 'market'|'limit'|'stop'|'stop_limit'|'trailing_stop'
    quantity: float
    limit_price: float | None = None
    stop_price: float | None = None
    trail_amount: float | None = None
    oco_with: int | None = None
    user_id: str = "default"
    note: str = ""


class AlertCreate(BaseModel):
    market: str
    symbol: str
    condition_type: str  # 'price_above'|'price_below'|'indicator'|'take_profit'|'stop_loss'|'signal'
    threshold: float
    field: str = "close"
    comparator: str = ">"
    user_id: str = "default"
    note: str = ""
    sound: str = "default"
    vibration: str = "default"
    linked_order_id: int | None = None


class TpSlAlertCreate(BaseModel):
    market: str
    symbol: str
    side: str  # 'buy' | 'sell'
    entry_price: float
    take_profit_price: float | None = None
    stop_loss_price: float | None = None
    user_id: str = "default"
    sound: str = "default"
    vibration: str = "default"
    linked_order_id: int | None = None


class SignalAlertCreate(BaseModel):
    market: str
    symbol: str
    strategy_name: str
    target_value: int
    user_id: str = "default"
    sound: str = "default"
    vibration: str = "default"
    note: str = ""


class RiskSettingsUpdate(BaseModel):
    user_id: str = "default"
    max_daily_loss_pct: float | None = None
    max_position_pct: float | None = None
    default_risk_per_trade_pct: float | None = None
    account_equity: float | None = None


class PositionSizeRequest(BaseModel):
    entry_price: float
    stop_price: float
    user_id: str = "default"
    risk_pct_override: float | None = None
    account_equity_override: float | None = None


class CashDepositRequest(BaseModel):
    user_id: str
    amount: float
    currency: str = "USD"
    source_ref: str = ""


class CashWithdrawRequest(BaseModel):
    user_id: str
    amount: float
    currency: str = "USD"
    destination_ref: str = ""


class CryptoWithdrawRequest(BaseModel):
    user_id: str
    asset: str
    amount: float
    destination_address: str


def _load(market: str, symbol: str, period: str, interval: str) -> pd.DataFrame:
    try:
        raw = dfetch.fetch_data(market=market, symbol=symbol, period=period, interval=interval)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ind.add_all_indicators(raw)


@app.get("/signals")
def get_signals(
    market: str = Query(..., description="stock | forex | crypto"),
    symbol: str = Query(..., description="e.g. AAPL, EURUSD, BTC/USDT"),
    period: str = Query("6mo", description="yfinance period, ignored for crypto"),
    interval: str = Query("1d", description="bar interval / ccxt timeframe"),
):
    df = _load(market, symbol, period, interval)
    signals = strat.run_all_strategies(df)
    latest = signals.iloc[-1].to_dict()
    latest_price = float(df["close"].iloc[-1])
    return {
        "market": market,
        "symbol": symbol,
        "interval": interval,
        "latest_price": latest_price,
        "as_of": str(df.index[-1]),
        "signals": latest,
    }


@app.get("/backtest")
def get_backtest(
    market: str = Query(...),
    symbol: str = Query(...),
    strategy: str = Query("consensus", description="strategy name or 'consensus'"),
    period: str = Query("6mo"),
    interval: str = Query("1d"),
    fee_bps: float = Query(5.0),
):
    df = _load(market, symbol, period, interval)
    signals = strat.run_all_strategies(df)
    if strategy not in signals.columns:
        raise HTTPException(status_code=400, detail=f"Unknown strategy '{strategy}'. Options: {list(signals.columns)}")
    result = bt.backtest_signal(df["close"], signals[strategy], fee_bps=fee_bps)
    summary = bt.performance_summary(result)
    return {"market": market, "symbol": symbol, "strategy": strategy, "performance": summary}


@app.get("/chart", response_class=HTMLResponse)
def get_chart(
    market: str = Query(...),
    symbol: str = Query(...),
    strategy: str = Query("consensus"),
    period: str = Query("6mo"),
    interval: str = Query("1d"),
):
    df = _load(market, symbol, period, interval)
    signals = strat.run_all_strategies(df)
    if strategy not in signals.columns:
        raise HTTPException(status_code=400, detail=f"Unknown strategy '{strategy}'. Options: {list(signals.columns)}")
    fig = charting.plot_signals(df, signals[strategy], title=f"{symbol} — {strategy}")
    return HTMLResponse(content=fig.to_html(include_plotlyjs="cdn"))


# ---------------------------------------------------------------------------
# Watchlists
# ---------------------------------------------------------------------------
@app.post("/watchlists")
def create_watchlist(body: WatchlistCreate):
    try:
        return wl.create_watchlist(body.name, user_id=body.user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/watchlists")
def list_watchlists(user_id: str = Query("default")):
    return wl.list_watchlists(user_id=user_id)


@app.get("/watchlists/{watchlist_id}")
def get_watchlist(watchlist_id: int):
    result = wl.get_watchlist(watchlist_id)
    if not result:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return result


@app.post("/watchlists/{watchlist_id}/items")
def add_watchlist_item(watchlist_id: int, body: WatchlistItemAdd):
    return wl.add_symbol(watchlist_id, body.market, body.symbol, tags=body.tags)


@app.delete("/watchlists/{watchlist_id}/items")
def remove_watchlist_item(watchlist_id: int, market: str, symbol: str):
    return wl.remove_symbol(watchlist_id, market, symbol)


@app.delete("/watchlists/{watchlist_id}")
def delete_watchlist(watchlist_id: int):
    wl.delete_watchlist(watchlist_id)
    return {"deleted": watchlist_id}


# ---------------------------------------------------------------------------
# Orders (paper-trading engine — see orders.py docstring to go live)
# ---------------------------------------------------------------------------
@app.post("/orders")
def create_order(body: OrderCreate):
    try:
        return ord_mod.place_order(
            market=body.market, symbol=body.symbol, side=body.side, order_type=body.order_type,
            quantity=body.quantity, limit_price=body.limit_price, stop_price=body.stop_price,
            trail_amount=body.trail_amount, oco_with=body.oco_with, user_id=body.user_id, note=body.note,
        )
    except ord_mod.OrderError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/orders")
def list_orders(user_id: str = Query("default"), status: str | None = Query(None)):
    return ord_mod.list_orders(user_id=user_id, status=status)


@app.post("/orders/{order_id}/cancel")
def cancel_order(order_id: int):
    try:
        return ord_mod.cancel_order(order_id)
    except ord_mod.OrderError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/orders/check-pending")
def check_pending_orders(user_id: str = Query("default")):
    """Call this on a schedule (e.g. every minute) to evaluate open limit/stop/trailing orders."""
    return ord_mod.check_and_fill_pending(user_id=user_id)


# ---------------------------------------------------------------------------
# Alerts (price / indicator / take-profit / stop-loss / signal), each with
# a sound + vibration setting. See alerts.py and notifications.py docstrings
# — this backend queues notifications; your client app plays the sound and
# triggers the vibration using the device's own APIs.
# ---------------------------------------------------------------------------
@app.post("/alerts")
def create_alert(body: AlertCreate):
    try:
        return alert_mod.create_alert(
            market=body.market, symbol=body.symbol, condition_type=body.condition_type,
            threshold=body.threshold, field=body.field, comparator=body.comparator,
            user_id=body.user_id, note=body.note, sound=body.sound, vibration=body.vibration,
            linked_order_id=body.linked_order_id,
        )
    except alert_mod.AlertError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/alerts/tp-sl")
def create_tp_sl_alert(body: TpSlAlertCreate):
    """Create matching take-profit and/or stop-loss alerts for a position in one call."""
    try:
        return alert_mod.create_tp_sl_alert(
            market=body.market, symbol=body.symbol, side=body.side, entry_price=body.entry_price,
            take_profit_price=body.take_profit_price, stop_loss_price=body.stop_loss_price,
            user_id=body.user_id, sound=body.sound, vibration=body.vibration,
            linked_order_id=body.linked_order_id,
        )
    except alert_mod.AlertError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/alerts/signal")
def create_signal_alert(body: SignalAlertCreate):
    """Create an alert that fires when a strategy's signal (or 'consensus') equals target_value."""
    try:
        return alert_mod.create_signal_alert(
            market=body.market, symbol=body.symbol, strategy_name=body.strategy_name,
            target_value=body.target_value, user_id=body.user_id, sound=body.sound,
            vibration=body.vibration, note=body.note,
        )
    except alert_mod.AlertError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/alerts")
def list_alerts(user_id: str = Query("default"), status: str | None = Query(None), category: str | None = Query(None)):
    return alert_mod.list_alerts(user_id=user_id, status=status, category=category)


@app.post("/alerts/{alert_id}/cancel")
def cancel_alert(alert_id: int):
    return alert_mod.cancel_alert(alert_id)


@app.post("/alerts/check")
async def check_alerts(user_id: str = Query("default")):
    """
    Call this on a schedule (e.g. every 1-5 minutes via a cron/scheduler in
    your app) to evaluate active alerts. Anything that fires is queued as a
    notification AND pushed immediately over the WebSocket channel to any
    connected client for that user_id.
    """
    fired = alert_mod.check_alerts(user_id=user_id)
    if fired:
        pending = notif_mod.get_pending_notifications(user_id)
        for n in pending:
            await ws_manager.send_to_user(user_id, n)
    return fired


# ---------------------------------------------------------------------------
# Notifications: poll these endpoints, or use the WebSocket channel below for
# real-time push instead of polling. Either way, call ack once your app has
# shown the notification and triggered sound/vibration.
# ---------------------------------------------------------------------------
@app.get("/notifications/pending")
def get_pending_notifications(user_id: str = Query("default")):
    return notif_mod.get_pending_notifications(user_id)


@app.post("/notifications/{notification_id}/ack")
def ack_notification(notification_id: int):
    return notif_mod.mark_delivered(notification_id)


@app.get("/notifications/history")
def get_notification_history(user_id: str = Query("default"), limit: int = Query(100)):
    return notif_mod.get_notification_history(user_id, limit)


@app.websocket("/ws/notifications/{user_id}")
async def notifications_websocket(websocket: WebSocket, user_id: str):
    """
    Real-time push channel. On connect, immediately flushes any notifications
    queued while the client was offline, then streams new ones as
    /alerts/check fires them. On receiving a message, your client should:
      1. Parse the JSON (title, body, sound, vibration, priority, payload)
      2. Show a local notification / in-app banner
      3. Play `sound` and trigger `vibration` using the platform's own APIs
      4. POST /notifications/{id}/ack
    """
    await ws_manager.connect(user_id, websocket)
    try:
        for n in notif_mod.get_pending_notifications(user_id):
            await websocket.send_json(n)
        while True:
            await websocket.receive_text()  # keep-alive; client pings are ignored
    except WebSocketDisconnect:
        ws_manager.disconnect(user_id, websocket)


# ---------------------------------------------------------------------------
# Risk management
# ---------------------------------------------------------------------------
@app.get("/risk/settings")
def get_risk_settings(user_id: str = Query("default")):
    return risk_mod.get_settings(user_id=user_id)


@app.put("/risk/settings")
def update_risk_settings(body: RiskSettingsUpdate):
    fields = body.model_dump(exclude={"user_id"}, exclude_none=True)
    return risk_mod.update_settings(user_id=body.user_id, **fields)


@app.post("/risk/position-size")
def calc_position_size(body: PositionSizeRequest):
    try:
        return risk_mod.position_size(
            entry_price=body.entry_price, stop_price=body.stop_price, user_id=body.user_id,
            risk_pct_override=body.risk_pct_override, account_equity_override=body.account_equity_override,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/risk/exposure")
def get_exposure(user_id: str = Query("default")):
    return risk_mod.exposure_summary(user_id=user_id)


@app.get("/risk/circuit-breaker")
def get_circuit_breaker(user_id: str = Query("default")):
    """Check this before allowing a new order; if halted=True, block trade placement in your UI."""
    return risk_mod.check_circuit_breaker(user_id=user_id)


# ---------------------------------------------------------------------------
# Portfolio & P&L
# ---------------------------------------------------------------------------
@app.get("/portfolio/summary")
def get_portfolio_summary(user_id: str = Query("default")):
    return pf_mod.get_portfolio_summary(user_id=user_id)


@app.get("/portfolio/positions")
def get_positions(user_id: str = Query("default")):
    return pf_mod.get_positions(user_id=user_id)


@app.get("/portfolio/realized-pnl")
def get_realized_pnl(user_id: str = Query("default")):
    return pf_mod.get_realized_pnl(user_id=user_id)


@app.get("/portfolio/trades")
def get_trade_history(user_id: str = Query("default"), limit: int = Query(100)):
    return pf_mod.get_trade_history(user_id=user_id, limit=limit)


# ---------------------------------------------------------------------------
# News & economic calendar
# ---------------------------------------------------------------------------
@app.get("/news")
def get_news(market: str = Query(...), symbol: str = Query(...), limit: int = Query(10)):
    try:
        return news_mod.get_news(market=market, symbol=symbol, limit=limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/calendar/economic")
def get_economic_calendar(days_ahead: int = Query(7)):
    return news_mod.get_economic_calendar(days_ahead=days_ahead)


@app.get("/calendar/earnings")
def get_earnings_calendar(symbol: str | None = Query(None), days_ahead: int = Query(30)):
    return news_mod.get_earnings_calendar(symbol=symbol, days_ahead=days_ahead)


# ---------------------------------------------------------------------------
# Cash wallet (fiat) — see cash_wallet.py / payment_provider.py docstrings.
# Currently backed by MockPaymentProvider; swap in a real processor before
# handling real money.
# ---------------------------------------------------------------------------
@app.get("/wallet/cash/balance")
def get_cash_balance(user_id: str = Query(...), currency: str = Query("USD")):
    return {"user_id": user_id, "currency": currency, "balance": cash_mod.get_cash_balance(user_id, currency)}


@app.post("/wallet/cash/deposit")
def deposit_cash(body: CashDepositRequest):
    try:
        return cash_mod.deposit(body.user_id, body.amount, currency=body.currency, source_ref=body.source_ref)
    except cash_mod.WalletError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/wallet/cash/withdraw")
def withdraw_cash(body: CashWithdrawRequest):
    try:
        return cash_mod.withdraw(body.user_id, body.amount, currency=body.currency, destination_ref=body.destination_ref)
    except cash_mod.WalletError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/wallet/cash/transactions")
def get_cash_transactions(user_id: str = Query(...), currency: str = Query("USD"), limit: int = Query(100)):
    return cash_mod.get_transaction_history(user_id, currency, limit)


# ---------------------------------------------------------------------------
# Crypto wallet — see crypto_wallet.py / custody_provider.py docstrings.
# Currently backed by MockCustodyProvider; this app's code never handles a
# private key. Swap in a real custody provider (Fireblocks/BitGo/etc.)
# before handling real crypto.
# ---------------------------------------------------------------------------
@app.get("/wallet/crypto/balance")
def get_crypto_balance(user_id: str = Query(...), asset: str = Query(...)):
    return {"user_id": user_id, "asset": asset, "balance": crypto_mod.get_crypto_balance(user_id, asset)}


@app.post("/wallet/crypto/deposit-address")
def get_deposit_address(user_id: str = Query(...), asset: str = Query(...)):
    return crypto_mod.get_or_create_deposit_address(user_id, asset)


@app.post("/wallet/crypto/withdraw")
def withdraw_crypto(body: CryptoWithdrawRequest):
    try:
        return crypto_mod.withdraw(body.user_id, body.asset, body.amount, body.destination_address)
    except crypto_mod.WalletError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/wallet/crypto/transactions")
def get_crypto_transactions(user_id: str = Query(...), asset: str = Query(...), limit: int = Query(100)):
    return crypto_mod.get_transaction_history(user_id, asset, limit)


@app.get("/wallet/ledger/verify")
def verify_ledger():
    """Books-balance sanity check. Run this on a schedule; unbalanced=True means stop and investigate."""
    return ledger_mod.verify_books_balance()


@app.get("/health")
def health():
    return {"status": "ok"}
