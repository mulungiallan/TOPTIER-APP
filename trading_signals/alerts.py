"""
Alert engine: price, indicator, take-profit, stop-loss, and strategy-signal
alerts, each with a sound + vibration setting (default or custom). Call
check_alerts() on a schedule (every 1-5 min for price/indicator, or tighter
for TP/SL if your app supports it) — anything that fires gets queued as a
notification via notifications.enqueue_notification() for your client app
to pick up and actually play/vibrate.

condition_type:
  'price_above' / 'price_below' -> close price vs threshold
  'indicator'                    -> any field from indicators.add_all_indicators
                                     (e.g. field='rsi_14', comparator='<', threshold=30)
  'take_profit' / 'stop_loss'    -> convenience wrappers around price_above/below,
                                     tagged with category so notifications read
                                     "Take profit hit" instead of a generic price alert
  'signal'                       -> fires when a strategy's signal (from
                                     strategies.run_all_strategies) equals a
                                     target value, e.g. consensus flips to -1
"""

from __future__ import annotations
from . import db
from . import data_fetcher as dfetch
from . import indicators as ind
from . import strategies as strat
from . import notifications as notif


class AlertError(ValueError):
    pass


# ---------------------------------------------------------------------------
# Creation
# ---------------------------------------------------------------------------
def create_alert(
    market: str,
    symbol: str,
    condition_type: str,
    threshold: float,
    field: str = "close",
    comparator: str = ">",
    user_id: str = "default",
    note: str = "",
    sound: str = "default",
    vibration: str = "default",
    linked_order_id: int | None = None,
) -> dict:
    if condition_type not in ("price_above", "price_below", "indicator", "take_profit", "stop_loss", "signal"):
        raise AlertError(f"Unknown condition_type '{condition_type}'")
    if comparator not in (">", "<"):
        raise AlertError("comparator must be '>' or '<'")

    category = "price"
    if condition_type == "price_above":
        field, comparator, category = "close", ">", "price"
    elif condition_type == "price_below":
        field, comparator, category = "close", "<", "price"
    elif condition_type == "take_profit":
        field, category = "close", "take_profit"
    elif condition_type == "stop_loss":
        field, category = "close", "stop_loss"
    elif condition_type == "indicator":
        category = "indicator"
    elif condition_type == "signal":
        category = "signal"

    alert_id = db.execute(
        """INSERT INTO alerts
           (user_id, market, symbol, condition_type, field, comparator, threshold,
            category, sound, vibration, linked_order_id, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (user_id, market, symbol.upper(), condition_type, field, comparator, threshold,
         category, sound, vibration, linked_order_id, note),
    )
    return get_alert(alert_id)


def create_tp_sl_alert(
    market: str,
    symbol: str,
    side: str,
    entry_price: float,
    take_profit_price: float | None = None,
    stop_loss_price: float | None = None,
    user_id: str = "default",
    sound: str = "default",
    vibration: str = "default",
    linked_order_id: int | None = None,
) -> list[dict]:
    """
    Convenience: creates matching TP and/or SL alerts for a position in one
    call, with the correct comparator direction inferred from side.
      side='buy'  -> TP fires when price rises to take_profit_price,
                      SL fires when price falls to stop_loss_price
      side='sell' (short) -> directions are reversed
    """
    if side not in ("buy", "sell"):
        raise AlertError("side must be 'buy' or 'sell'")

    created = []
    if take_profit_price is not None:
        comparator = ">" if side == "buy" else "<"
        alert_id = db.execute(
            """INSERT INTO alerts
               (user_id, market, symbol, condition_type, field, comparator, threshold,
                category, sound, vibration, linked_order_id, note)
               VALUES (?, ?, ?, 'take_profit', 'close', ?, ?, 'take_profit', ?, ?, ?, ?)""",
            (user_id, market, symbol.upper(), comparator, take_profit_price, sound, vibration,
             linked_order_id, f"TP for {side} entry @ {entry_price}"),
        )
        created.append(get_alert(alert_id))

    if stop_loss_price is not None:
        comparator = "<" if side == "buy" else ">"
        alert_id = db.execute(
            """INSERT INTO alerts
               (user_id, market, symbol, condition_type, field, comparator, threshold,
                category, sound, vibration, linked_order_id, note)
               VALUES (?, ?, ?, 'stop_loss', 'close', ?, ?, 'stop_loss', ?, ?, ?, ?)""",
            (user_id, market, symbol.upper(), comparator, stop_loss_price, sound, vibration,
             linked_order_id, f"SL for {side} entry @ {entry_price}"),
        )
        created.append(get_alert(alert_id))

    return created


def create_signal_alert(
    market: str,
    symbol: str,
    strategy_name: str,
    target_value: int,
    user_id: str = "default",
    sound: str = "default",
    vibration: str = "default",
    note: str = "",
) -> dict:
    """
    Fires when the named strategy's latest signal equals target_value
    (typically 1 = bullish, -1 = bearish, 0 = flat). strategy_name must be
    one of strategies.SINGLE_ASSET_STRATEGIES keys, or 'consensus'/'composite'.
    """
    valid_names = set(strat.SINGLE_ASSET_STRATEGIES.keys()) | {"consensus", "composite"}
    if strategy_name not in valid_names:
        raise AlertError(f"Unknown strategy_name '{strategy_name}'. Options: {sorted(valid_names)}")

    alert_id = db.execute(
        """INSERT INTO alerts
           (user_id, market, symbol, condition_type, field, comparator, threshold,
            category, sound, vibration, note)
           VALUES (?, ?, ?, 'signal', ?, '>', ?, 'signal', ?, ?, ?)""",
        # comparator '>' is a placeholder; signal checks use exact match, not > /<.
        # threshold stores target_value - 0.5 so _evaluate_one can recover the
        # exact integer target without ambiguity (see reverse calc below).
        (user_id, market, symbol.upper(), strategy_name, target_value - 0.5, sound, vibration, note),
    )
    return get_alert(alert_id)


# ---------------------------------------------------------------------------
# Reads / lifecycle
# ---------------------------------------------------------------------------
def get_alert(alert_id: int) -> dict | None:
    return db.query_one("SELECT * FROM alerts WHERE id = ?", (alert_id,))


def list_alerts(user_id: str = "default", status: str | None = None, category: str | None = None) -> list[dict]:
    query = "SELECT * FROM alerts WHERE user_id = ?"
    params: list = [user_id]
    if status:
        query += " AND status = ?"
        params.append(status)
    if category:
        query += " AND category = ?"
        params.append(category)
    query += " ORDER BY created_at DESC"
    return db.query_all(query, params)


def list_active_users() -> list[str]:
    """Every user_id that currently has at least one active alert. Used by the
    background scheduler to know which users to evaluate."""
    rows = db.query_all("SELECT DISTINCT user_id FROM alerts WHERE status = 'active'")
    return [row["user_id"] for row in rows]


def cancel_alert(alert_id: int) -> dict:
    db.execute("UPDATE alerts SET status = 'cancelled' WHERE id = ?", (alert_id,))
    return get_alert(alert_id)


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
_CATEGORY_TITLES = {
    "price": "Price alert",
    "indicator": "Indicator alert",
    "take_profit": "Take profit hit \U0001F7E2",
    "stop_loss": "Stop loss hit \U0001F534",
    "signal": "Signal alert",
}
_CATEGORY_PRIORITY = {
    "price": "normal",
    "indicator": "normal",
    "take_profit": "high",
    "stop_loss": "high",
    "signal": "high",
}


def check_alerts(user_id: str = "default") -> list[dict]:
    """
    Evaluate every active alert for this user against fresh data. Anything
    that fires: (1) is marked 'triggered', (2) gets a notification queued
    via notifications.enqueue_notification() using the alert's own
    sound/vibration settings, category-appropriate title, and priority.
    Returns the list of alerts that fired.
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
            latest_price = float(df["close"].iloc[-1])
        except Exception:
            continue

        signal_cache: dict[str, int] = {}

        for a in alerts_for_symbol:
            fired, value = _evaluate_one(a, df, signal_cache)
            if not fired:
                continue

            db.execute(
                "UPDATE alerts SET status = 'triggered', triggered_at = datetime('now'), triggered_value = ? WHERE id = ?",
                (value, a["id"]),
            )
            updated = get_alert(a["id"])
            triggered.append(updated)

            title = _CATEGORY_TITLES.get(a["category"], "Alert")
            body = _format_body(a, value, latest_price)
            notif.enqueue_notification(
                user_id=user_id,
                title=f"{title}: {symbol}",
                body=body,
                alert_id=a["id"],
                sound=a["sound"],
                vibration=a["vibration"],
                priority=_CATEGORY_PRIORITY.get(a["category"], "normal"),
                payload={"market": market, "symbol": symbol, "category": a["category"],
                         "triggered_value": value, "alert_id": a["id"], "linked_order_id": a["linked_order_id"]},
            )

    return triggered


def _evaluate_one(alert: dict, df, signal_cache: dict) -> tuple[bool, float | None]:
    if alert["condition_type"] == "signal":
        strategy_name = alert["field"]
        target_value = round(alert["threshold"] + 0.5)  # reverse the -0.5 encoding from create_signal_alert
        if strategy_name not in signal_cache:
            if strategy_name in ("consensus", "composite"):
                signals = strat.run_all_strategies(df)
                signal_cache_val = int(signals[strategy_name].iloc[-1])
            else:
                fn = strat.SINGLE_ASSET_STRATEGIES[strategy_name]
                signal_cache_val = int(fn(df).iloc[-1])
            signal_cache[strategy_name] = signal_cache_val
        current_value = signal_cache[strategy_name]
        return (current_value == target_value), current_value

    field = alert["field"]
    if field not in df.columns:
        return False, None
    value = float(df[field].iloc[-1])
    fired = (value > alert["threshold"]) if alert["comparator"] == ">" else (value < alert["threshold"])
    return fired, value


def _format_body(alert: dict, value: float | None, latest_price: float) -> str:
    symbol = alert["symbol"]
    if alert["category"] == "take_profit":
        return f"{symbol} hit your take-profit level at {value:.4f}."
    if alert["category"] == "stop_loss":
        return f"{symbol} hit your stop-loss level at {value:.4f}."
    if alert["category"] == "signal":
        direction = {1: "bullish", -1: "bearish", 0: "flat"}.get(int(value), str(value))
        return f"{symbol} {alert['field']} signal turned {direction} (price {latest_price:.4f})."
    if alert["category"] == "indicator":
        return f"{symbol} {alert['field']} is now {value:.4f} ({alert['comparator']} {alert['threshold']})."
    return f"{symbol} price is now {value:.4f} ({alert['comparator']} {alert['threshold']})."
