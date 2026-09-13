"""
Alerts: price or indicator conditions that get evaluated against fresh
market data. `check_alerts()` is meant to be called on a schedule (e.g. a
background job every 1-5 minutes in your app) and returns any alerts that
fired so your app can push a notification.

condition_type:
  'price_above' / 'price_below' -> threshold compared against close price
  'indicator'                   -> threshold compared against any column
                                    produced by indicators.add_all_indicators
                                    (e.g. field='rsi_14', comparator='<')
"""

from __future__ import annotations
from . import db
from . import data_fetcher as dfetch
from . import indicators as ind


class AlertError(ValueError):
    pass


def create_alert(
    market: str,
    symbol: str,
    condition_type: str,
    threshold: float,
    field: str = "close",
    comparator: str = ">",
    user_id: str = "default",
    note: str = "",
) -> dict:
    if condition_type not in ("price_above", "price_below", "indicator"):
        raise AlertError(f"Unknown condition_type '{condition_type}'")
    if comparator not in (">", "<"):
        raise AlertError("comparator must be '>' or '<'")

    # normalize price_above/price_below into the generic indicator form
    if condition_type == "price_above":
        field, comparator = "close", ">"
    elif condition_type == "price_below":
        field, comparator = "close", "<"

    alert_id = db.execute(
        """INSERT INTO alerts (user_id, market, symbol, condition_type, field, comparator, threshold, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (user_id, market, symbol.upper(), condition_type, field, comparator, threshold, note),
    )
    return get_alert(alert_id)


def get_alert(alert_id: int) -> dict | None:
    return db.query_one("SELECT * FROM alerts WHERE id = ?", (alert_id,))


def list_alerts(user_id: str = "default", status: str | None = None) -> list[dict]:
    if status:
        return db.query_all(
            "SELECT * FROM alerts WHERE user_id = ? AND status = ? ORDER BY created_at DESC", (user_id, status)
        )
    return db.query_all("SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC", (user_id,))


def cancel_alert(alert_id: int) -> dict:
    db.execute("UPDATE alerts SET status = 'cancelled' WHERE id = ?", (alert_id,))
    return get_alert(alert_id)


def check_alerts(user_id: str = "default") -> list[dict]:
    """
    Evaluate every active alert for this user against fresh data. Returns
    the list of alerts that fired (and marks them 'triggered' so they don't
    fire repeatedly — call create_alert again if the user wants to re-arm).
    """
    active = list_alerts(user_id=user_id, status="active")
    if not active:
        return []

    triggered = []
    by_symbol: dict[tuple, list[dict]] = {}
    for a in active:
        by_symbol.setdefault((a["market"], a["symbol"]), []).append(a)

    for (market, symbol), alerts_for_symbol in by_symbol.items():
        try:
            raw = dfetch.fetch_data(market=market, symbol=symbol, period="3mo", interval="1d")
            df = ind.add_all_indicators(raw)
            latest = df.iloc[-1]
        except Exception:
            continue

        for a in alerts_for_symbol:
            field = a["field"]
            if field not in latest:
                continue
            value = float(latest[field])
            fired = (value > a["threshold"]) if a["comparator"] == ">" else (value < a["threshold"])
            if fired:
                db.execute(
                    "UPDATE alerts SET status = 'triggered', triggered_at = datetime('now'), triggered_value = ? WHERE id = ?",
                    (value, a["id"]),
                )
                triggered.append(get_alert(a["id"]))

    return triggered
