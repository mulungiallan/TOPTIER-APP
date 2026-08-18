"""
Layer 2 — backend.

Endpoints:
  POST /signals              - provider connector posts new trade events here
  GET  /signals/pending       - subscriber polls for signals not yet delivered to them
  GET  /signals/open_lookup   - subscriber looks up their local ticket for a provider
                                 ticket, to know what to close when a "closed" signal arrives
  POST /signals/confirm       - subscriber confirms execution (open or close),
                                 reports realized P/L on closes for the kill-switch
  GET  /health

Auth: API keys are hashed (SHA-256) before storage and compared as hashes —
see backend/auth.py. Still a bearer-token scheme, not OAuth; fine for a
small trusted group, not a substitute for real auth at real scale.
"""

import os
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Depends, Header, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_
from sqlalchemy.exc import IntegrityError

from database import Base, engine, get_db
import models
import schemas
import rules
from auth import hash_key

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("backend")

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Copy Trading Relay Backend")

PROVIDER_API_KEY_HASH = hash_key(os.environ.get("PROVIDER_API_KEY", "replace_with_a_long_random_string"))


def require_provider(x_api_key: str = Header(...)):
    if hash_key(x_api_key) != PROVIDER_API_KEY_HASH:
        raise HTTPException(status_code=401, detail="Invalid provider API key")


def require_subscriber(x_api_key: str = Header(...), db: Session = Depends(get_db)) -> models.Subscriber:
    sub = db.query(models.Subscriber).filter(models.Subscriber.api_key_hash == hash_key(x_api_key)).first()
    if not sub or not sub.active:
        raise HTTPException(status_code=401, detail="Invalid or inactive subscriber API key")
    return sub


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _reset_loss_counter_if_new_day(sub: models.Subscriber, db: Session):
    today = _today_utc()
    if sub.loss_reset_date != today:
        sub.daily_loss_used = 0.0
        sub.loss_reset_date = today
        db.add(sub)
        db.commit()


def _kill_switch_tripped(sub: models.Subscriber) -> bool:
    if sub.daily_loss_limit and sub.daily_loss_limit > 0:
        return sub.daily_loss_used >= sub.daily_loss_limit
    return False


@app.post("/signals", response_model=schemas.SignalOut)
def receive_signal(
    signal_in: schemas.SignalIn,
    db: Session = Depends(get_db),
    _=Depends(require_provider),
):
    approved, reason = rules.evaluate(signal_in)

    signal = models.Signal(
        **signal_in.model_dump(),
        approved=approved,
        rejection_reason=reason,
    )
    db.add(signal)
    db.commit()
    db.refresh(signal)
    log.info("Signal %s %s %s %s -> approved=%s%s",
              signal.id, signal.status, signal.direction, signal.symbol,
              approved, f" ({reason})" if reason else "")
    return signal


@app.get("/signals/pending", response_model=list[schemas.SignalOut])
def get_pending_signals(
    db: Session = Depends(get_db),
    subscriber: models.Subscriber = Depends(require_subscriber),
):
    """Approved signals matching this subscriber's symbol filter that
    haven't been delivered to them yet. Blocked entirely if the subscriber's
    daily loss kill-switch has tripped or concurrent trade cap is reached
    (closes still go through separately via open_lookup)."""
    _reset_loss_counter_if_new_day(subscriber, db)

    if _kill_switch_tripped(subscriber):
        log.warning("Subscriber %s daily loss limit reached, withholding new signals", subscriber.id)
        return []

    # Rule #2: Check concurrent trade cap
    if subscriber.current_concurrent_count >= subscriber.max_concurrent_trades:
        log.warning("Subscriber %s concurrent trade cap %d reached, withholding new open signals",
                     subscriber.id, subscriber.max_concurrent_trades)
        return []

    # Rule #5: Check hard stop
    if subscriber.hard_stop_active:
        log.warning("Subscriber %s hard stop active, withholding new signals", subscriber.id)
        return []

    already_delivered_ids = [
        row.signal_id
        for row in db.query(models.RelayedTrade.signal_id)
        .filter(models.RelayedTrade.subscriber_id == subscriber.id)
        .all()
    ]

    filters = [models.Signal.approved == True]  # noqa: E712
    if already_delivered_ids:
        filters.append(~models.Signal.id.in_(already_delivered_ids))

    query = db.query(models.Signal).filter(and_(*filters))

    whitelist = {s.strip() for s in subscriber.symbol_whitelist.split(",") if s.strip()}
    results = []
    for sig in query.order_by(models.Signal.id.asc()).all():
        if whitelist and sig.symbol not in whitelist:
            continue
        results.append(sig)
        db.add(models.RelayedTrade(signal_id=sig.id, subscriber_id=subscriber.id))

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    return results


@app.get("/signals/open_lookup", response_model=schemas.OpenLookupOut)
def open_lookup(
    provider_ticket: int,
    db: Session = Depends(get_db),
    subscriber: models.Subscriber = Depends(require_subscriber),
):
    """Used by the subscriber client when it receives a 'closed' signal: it
    needs to know which of ITS OWN tickets corresponds to the original
    provider ticket, so it knows what to close.

    Finds the most recent 'opened' Signal with this provider ticket, then
    the RelayedTrade recording what local ticket this subscriber opened
    for it.
    """
    open_signal = (
        db.query(models.Signal)
        .filter(models.Signal.ticket == provider_ticket, models.Signal.status == "opened")
        .order_by(models.Signal.id.desc())
        .first()
    )
    if not open_signal:
        return schemas.OpenLookupOut(signal_id=-1, local_ticket=None, found=False)

    relay = (
        db.query(models.RelayedTrade)
        .filter(
            models.RelayedTrade.signal_id == open_signal.id,
            models.RelayedTrade.subscriber_id == subscriber.id,
        )
        .first()
    )
    if not relay or relay.local_ticket is None:
        return schemas.OpenLookupOut(signal_id=open_signal.id, local_ticket=None, found=False)

    return schemas.OpenLookupOut(signal_id=open_signal.id, local_ticket=relay.local_ticket, found=True)


@app.post("/signals/confirm")
def confirm_execution(
    confirm: schemas.ExecutionConfirm,
    db: Session = Depends(get_db),
    subscriber: models.Subscriber = Depends(require_subscriber),
):
    relay = (
        db.query(models.RelayedTrade)
        .filter(
            models.RelayedTrade.signal_id == confirm.signal_id,
            models.RelayedTrade.subscriber_id == subscriber.id,
        )
        .first()
    )
    if not relay:
        raise HTTPException(status_code=404, detail="No matching relayed trade found")

    relay.executed = confirm.executed
    if confirm.local_ticket is not None:
        relay.local_ticket = confirm.local_ticket
    if confirm.realized_pl is not None:
        relay.realized_pl = confirm.realized_pl
        _reset_loss_counter_if_new_day(subscriber, db)
        if confirm.realized_pl < 0:
            subscriber.daily_loss_used += abs(confirm.realized_pl)
            db.add(subscriber)
            log.info("Subscriber %s daily loss now %.2f (limit %.2f)",
                      subscriber.id, subscriber.daily_loss_used, subscriber.daily_loss_limit)

    # Rule #1: Store risk metrics
    if confirm.computed_lots is not None:
        relay.computed_lots = confirm.computed_lots
    if confirm.provider_risk_pct is not None:
        relay.provider_risk_pct = confirm.provider_risk_pct
    if confirm.actual_risk_pct is not None:
        relay.actual_risk_pct = confirm.actual_risk_pct

    # Rule #2: Update concurrent trade count
    if confirm.executed:
        if confirm.local_ticket is not None and confirm.computed_lots is not None:
            # This was an open — increment count
            subscriber.current_concurrent_count += 1
        db.add(subscriber)

    db.add(relay)
    db.commit()
    return {"ok": True, "kill_switch_tripped": _kill_switch_tripped(subscriber)}


@app.get("/signals/expected_open")
def expected_open_tickets(
    db: Session = Depends(get_db),
    subscriber: models.Subscriber = Depends(require_subscriber),
):
    """Local MT5 tickets the backend believes are still open for this
    subscriber: executed=true, local_ticket set, and no later 'closed'
    signal for the same provider ticket has been confirmed executed.
    Used by subscriber/reconcile.py to detect drift."""
    relays = (
        db.query(models.RelayedTrade)
        .join(models.Signal, models.RelayedTrade.signal_id == models.Signal.id)
        .filter(
            models.RelayedTrade.subscriber_id == subscriber.id,
            models.RelayedTrade.executed == True,  # noqa: E712
            models.RelayedTrade.local_ticket.isnot(None),
            models.Signal.status == "opened",
        )
        .all()
    )

    expected = []
    for relay in relays:
        open_signal = db.get(models.Signal, relay.signal_id)
        closing_signal = (
            db.query(models.Signal)
            .filter(models.Signal.ticket == open_signal.ticket, models.Signal.status == "closed")
            .first()
        )
        if closing_signal is None:
            # No close event exists yet at all -> still open from the
            # provider's side, so it should still be open here too.
            expected.append(relay.local_ticket)
            continue

        close_relay = (
            db.query(models.RelayedTrade)
            .filter(
                models.RelayedTrade.signal_id == closing_signal.id,
                models.RelayedTrade.subscriber_id == subscriber.id,
                models.RelayedTrade.executed == True,  # noqa: E712
            )
            .first()
        )
        if close_relay is None:
            # A close signal exists but this subscriber hasn't confirmed
            # executing it yet -> from the backend's point of view it
            # should still be open.
            expected.append(relay.local_ticket)

    return {"expected_open_local_tickets": expected}


@app.get("/health")
def health():
    return {"status": "ok"}
