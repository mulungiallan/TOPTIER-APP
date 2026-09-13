"""
Risk management tools:
  - position sizing calculator (fixed-fractional, % risk per trade)
  - portfolio exposure summary (concentration by symbol/market)
  - daily loss circuit breaker (halts new trades once a loss limit is hit)

Settings are per-user and persisted in risk_settings; defaults are set the
first time get_settings() is called for a user.
"""

from __future__ import annotations
from datetime import datetime, timedelta
from . import db
from . import portfolio


DEFAULTS = {
    "max_daily_loss_pct": 3.0,
    "max_position_pct": 20.0,
    "default_risk_per_trade_pct": 1.0,
    "account_equity": 10000.0,
}


def get_settings(user_id: str = "default") -> dict:
    row = db.query_one("SELECT * FROM risk_settings WHERE user_id = ?", (user_id,))
    if row:
        return row
    db.execute(
        """INSERT INTO risk_settings (user_id, max_daily_loss_pct, max_position_pct,
           default_risk_per_trade_pct, account_equity) VALUES (?, ?, ?, ?, ?)""",
        (
            user_id,
            DEFAULTS["max_daily_loss_pct"],
            DEFAULTS["max_position_pct"],
            DEFAULTS["default_risk_per_trade_pct"],
            DEFAULTS["account_equity"],
        ),
    )
    return db.query_one("SELECT * FROM risk_settings WHERE user_id = ?", (user_id,))


def update_settings(user_id: str = "default", **kwargs) -> dict:
    get_settings(user_id)  # ensure row exists
    allowed = {"max_daily_loss_pct", "max_position_pct", "default_risk_per_trade_pct", "account_equity"}
    fields = {k: v for k, v in kwargs.items() if k in allowed}
    if not fields:
        return get_settings(user_id)
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    db.execute(f"UPDATE risk_settings SET {set_clause} WHERE user_id = ?", (*fields.values(), user_id))
    return get_settings(user_id)


def position_size(
    entry_price: float,
    stop_price: float,
    user_id: str = "default",
    risk_pct_override: float | None = None,
    account_equity_override: float | None = None,
) -> dict:
    """
    % risk-based position sizing: risk a fixed % of account equity on the
    distance between entry and stop. This is the standard "risk-based"
    sizing method (as opposed to sizing by a fixed dollar amount or a fixed
    number of shares).
    """
    settings = get_settings(user_id)
    equity = account_equity_override if account_equity_override is not None else settings["account_equity"]
    risk_pct = risk_pct_override if risk_pct_override is not None else settings["default_risk_per_trade_pct"]

    risk_amount = equity * (risk_pct / 100.0)
    per_unit_risk = abs(entry_price - stop_price)
    if per_unit_risk <= 0:
        raise ValueError("entry_price and stop_price must differ")

    quantity = risk_amount / per_unit_risk
    position_value = quantity * entry_price
    position_pct_of_equity = (position_value / equity) * 100 if equity else 0.0

    max_position_pct = settings["max_position_pct"]
    capped = position_pct_of_equity > max_position_pct
    if capped:
        max_position_value = equity * (max_position_pct / 100.0)
        quantity = max_position_value / entry_price
        position_value = quantity * entry_price
        position_pct_of_equity = max_position_pct

    return {
        "quantity": round(quantity, 6),
        "position_value": round(position_value, 2),
        "position_pct_of_equity": round(position_pct_of_equity, 2),
        "risk_amount": round(risk_amount, 2),
        "risk_pct_used": risk_pct,
        "per_unit_risk": round(per_unit_risk, 6),
        "capped_by_max_position_pct": capped,
    }


def exposure_summary(user_id: str = "default") -> dict:
    """Portfolio concentration: exposure by symbol and by market as % of total market value."""
    snap = portfolio.get_portfolio_summary(user_id)
    total = snap["total_market_value"]
    by_symbol = []
    by_market: dict[str, float] = {}

    for pos in snap["positions"]:
        mv = pos.get("market_value") or 0.0
        pct = (mv / total * 100) if total else 0.0
        by_symbol.append({"symbol": pos["symbol"], "market": pos["market"], "market_value": mv, "pct_of_portfolio": round(pct, 2)})
        by_market[pos["market"]] = by_market.get(pos["market"], 0.0) + mv

    by_market_pct = {k: round((v / total * 100) if total else 0.0, 2) for k, v in by_market.items()}
    by_symbol.sort(key=lambda x: x["pct_of_portfolio"], reverse=True)

    settings = get_settings(user_id)
    over_limit = [s for s in by_symbol if s["pct_of_portfolio"] > settings["max_position_pct"]]

    return {
        "total_market_value": total,
        "by_symbol": by_symbol,
        "by_market_pct": by_market_pct,
        "positions_over_max_pct": over_limit,
        "max_position_pct_limit": settings["max_position_pct"],
    }


def check_circuit_breaker(user_id: str = "default") -> dict:
    """
    Checks today's realized + unrealized P&L against max_daily_loss_pct.
    If breached, halts trading until the next UTC day (trading_halted_until
    is set and can be checked before allowing new orders in your app).
    """
    settings = get_settings(user_id)

    if settings["trading_halted_until"]:
        halted_until = datetime.fromisoformat(settings["trading_halted_until"])
        if datetime.utcnow() < halted_until:
            return {"halted": True, "reason": "circuit breaker active", "halted_until": settings["trading_halted_until"]}
        else:
            db.execute("UPDATE risk_settings SET trading_halted_until = NULL WHERE user_id = ?", (user_id,))

    today = datetime.utcnow().date().isoformat()
    todays_trades = db.query_all(
        "SELECT * FROM trades WHERE user_id = ? AND date(executed_at) = ?", (user_id, today)
    )
    # realized P&L today, approximated via portfolio's FIFO engine restricted to today's closes
    all_realized = portfolio.get_realized_pnl(user_id)
    today_realized = sum(r["realized_pnl"] for r in all_realized if r["closed_at"][:10] == today)

    snap = portfolio.get_portfolio_summary(user_id)
    today_pnl = today_realized + snap["total_unrealized_pnl"]
    equity = settings["account_equity"]
    loss_pct = (today_pnl / equity * 100) if equity else 0.0

    breached = loss_pct <= -abs(settings["max_daily_loss_pct"])
    if breached:
        halt_until = (datetime.utcnow() + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        db.execute(
            "UPDATE risk_settings SET trading_halted_until = ? WHERE user_id = ?",
            (halt_until.isoformat(), user_id),
        )
        return {"halted": True, "reason": "daily loss limit breached", "today_pnl": round(today_pnl, 2), "loss_pct": round(loss_pct, 2)}

    return {"halted": False, "today_pnl": round(today_pnl, 2), "loss_pct": round(loss_pct, 2), "limit_pct": settings["max_daily_loss_pct"]}
