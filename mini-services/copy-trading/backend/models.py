from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey, UniqueConstraint
)
from sqlalchemy.orm import relationship
from datetime import datetime, timezone

from database import Base


class Signal(Base):
    """A trade event captured from your (provider) MT5 account."""
    __tablename__ = "signals"

    id = Column(Integer, primary_key=True)
    ticket = Column(Integer, nullable=False, index=True)
    symbol = Column(String, nullable=False)
    direction = Column(String, nullable=False)  # buy / sell
    volume = Column(Float, nullable=False)
    price_open = Column(Float, nullable=False)
    sl = Column(Float, default=0.0)
    tp = Column(Float, default=0.0)
    time_open = Column(Integer, nullable=False)
    status = Column(String, nullable=False)  # opened / closed
    approved = Column(Boolean, default=False)
    rejection_reason = Column(String, nullable=True)
    received_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Subscriber(Base):
    """A person whose account will have signals copied into it.

    Extended with risk management fields from the feature specification:
      - Rule #1: Risk-normalized sizing params (max_risk_per_trade_pct)
      - Rule #2: Concurrent trade cap (max_concurrent_trades)
      - Rule #3: Exposure caps (max_symbol_exposure_pct, max_asset_class_exposure_pct)
      - Rule #4: Time-based rules (weekend_crypto_cap_pct, news_blackout_minutes)
      - Rule #5: Drawdown circuit breakers (drawdown_soft_pause_pct, account_wide_hard_stop_pct)
    """
    __tablename__ = "subscribers"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    api_key_hash = Column(String, nullable=False, unique=True, index=True)
    active = Column(Boolean, default=True)
    lot_multiplier = Column(Float, default=1.0)
    max_lot_size = Column(Float, default=1.0)
    symbol_whitelist = Column(String, default="")

    # Kill-switch: daily loss limit
    daily_loss_limit = Column(Float, default=0.0)
    daily_loss_used = Column(Float, default=0.0)
    loss_reset_date = Column(String, default="")

    # Rule #1: Risk-normalized sizing
    equity_usd = Column(Float, default=0.0)  # subscriber's account equity
    max_risk_per_trade_pct = Column(Float, default=2.0)

    # Rule #2: Per-provider concurrent trade cap
    max_concurrent_trades = Column(Integer, default=20)
    current_concurrent_count = Column(Integer, default=0)

    # Rule #3: Exposure caps
    max_symbol_exposure_pct = Column(Float, default=20.0)
    max_asset_class_exposure_pct = Column(Float, default=40.0)

    # Rule #4: Time-based rules
    weekend_crypto_cap_pct = Column(Float, default=50.0)
    news_blackout_minutes = Column(Integer, default=30)

    # Rule #5: Drawdown circuit breakers
    drawdown_soft_pause_pct = Column(Float, default=8.0)
    account_wide_hard_stop_pct = Column(Float, default=15.0)
    current_drawdown_pct = Column(Float, default=0.0)
    hard_stop_active = Column(Boolean, default=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    relayed_trades = relationship("RelayedTrade", back_populates="subscriber")
    risk_events = relationship("RiskEvent", back_populates="subscriber")


class RelayedTrade(Base):
    """Record of a signal having been delivered to a specific subscriber."""
    __tablename__ = "relayed_trades"
    __table_args__ = (UniqueConstraint("signal_id", "subscriber_id", name="uq_signal_subscriber"),)

    id = Column(Integer, primary_key=True)
    signal_id = Column(Integer, ForeignKey("signals.id"), nullable=False)
    subscriber_id = Column(Integer, ForeignKey("subscribers.id"), nullable=False)
    delivered_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    executed = Column(Boolean, default=False)
    local_ticket = Column(Integer, nullable=True)
    realized_pl = Column(Float, nullable=True)

    # Rule #1: Track risk metrics at copy time
    computed_lots = Column(Float, nullable=True)      # the lots actually opened
    provider_risk_pct = Column(Float, nullable=True)   # provider's risk % at copy time
    actual_risk_pct = Column(Float, nullable=True)     # actual risk % after sizing

    subscriber = relationship("Subscriber", back_populates="relayed_trades")


class RiskEvent(Base):
    """Rule #5: Drawdown and circuit breaker event log.

    Tracks per-provider soft pauses, account-wide hard stops, and resumes
    for audit trail and automatic recovery.
    """
    __tablename__ = "risk_events"

    id = Column(Integer, primary_key=True)
    subscriber_id = Column(Integer, ForeignKey("subscribers.id"), nullable=True)
    event_type = Column(String, nullable=False)
    # provider_soft_pause | provider_resume | account_hard_stop | account_resume
    symbol = Column(String, nullable=True)
    drawdown_pct = Column(Float, default=0.0)
    threshold_pct = Column(Float, default=0.0)
    details = Column(String, nullable=True)  # JSON metadata
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    subscriber = relationship("Subscriber", back_populates="risk_events")
