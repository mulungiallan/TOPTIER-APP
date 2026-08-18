from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class SignalIn(BaseModel):
    ticket: int
    symbol: str
    direction: str
    volume: float
    price_open: float
    sl: float = 0.0
    tp: float = 0.0
    time_open: int
    status: str
    provider_equity: Optional[float] = None  # Rule #1: provider's equity for risk calc


class SignalOut(BaseModel):
    id: int
    ticket: int
    symbol: str
    direction: str
    volume: float
    price_open: float
    sl: float
    tp: float
    time_open: int
    status: str
    approved: bool
    rejection_reason: Optional[str] = None
    received_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class OpenLookupOut(BaseModel):
    signal_id: int
    local_ticket: Optional[int] = None
    found: bool


class ExecutionConfirm(BaseModel):
    signal_id: int
    executed: bool
    local_ticket: Optional[int] = None
    realized_pl: Optional[float] = None
    # Rule #1: Risk metrics from subscriber execution
    computed_lots: Optional[float] = None
    provider_risk_pct: Optional[float] = None
    actual_risk_pct: Optional[float] = None


class SubscriberConfig(BaseModel):
    """Configuration for subscriber risk management settings."""
    name: str
    equity_usd: float = 10000.0
    lot_multiplier: float = 1.0
    max_lot_size: float = 1.0
    symbol_whitelist: str = ""
    daily_loss_limit: float = 0.0
    # Rule #1
    max_risk_per_trade_pct: float = 2.0
    # Rule #2
    max_concurrent_trades: int = 20
    # Rule #3
    max_symbol_exposure_pct: float = 20.0
    max_asset_class_exposure_pct: float = 40.0
    # Rule #4
    weekend_crypto_cap_pct: float = 50.0
    news_blackout_minutes: int = 30
    # Rule #5
    drawdown_soft_pause_pct: float = 8.0
    account_wide_hard_stop_pct: float = 15.0
