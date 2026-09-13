"""
Order management.

This module owns the order lifecycle (open -> filled/cancelled/rejected) and
a fill *simulator* for paper trading — it does NOT place real orders with a
broker/exchange. To go live, replace `_execute_fill()` with a call to your
broker/exchange's order API (e.g. Alpaca, IBKR, ccxt's create_order); every
other function (order creation, OCO linking, trailing-stop tracking) stays
the same since it only depends on `_execute_fill` for the actual trade.

Supported order types:
  market        - fills immediately at current price
  limit         - fills when price crosses the limit in the favorable direction
  stop          - becomes a market order once price crosses the stop level
  stop_limit    - becomes a limit order once price crosses the stop level
  trailing_stop - stop level trails price by a fixed amount, fills on reversal
  OCO           - pass oco_group_id to link two orders; filling one cancels the other
"""

from __future__ import annotations
import uuid
from . import db
from . import data_fetcher as dfetch


class OrderError(ValueError):
    pass


def _latest_price(market: str, symbol: str) -> float:
    df = dfetch.fetch_data(market=market, symbol=symbol, period="5d", interval="1d")
    return float(df["close"].iloc[-1])


def place_order(
    market: str,
    symbol: str,
    side: str,
    order_type: str,
    quantity: float,
    limit_price: float | None = None,
    stop_price: float | None = None,
    trail_amount: float | None = None,
    oco_with: int | None = None,
    user_id: str = "default",
    note: str = "",
) -> dict:
    """
    Create an order. If oco_with is given (an existing open order id), the two
    orders are linked as an OCO pair (filling/cancelling one cancels the other).
    Returns the created order; for 'market' orders this also attempts an
    immediate fill against the latest fetched price.
    """
    side = side.lower()
    order_type = order_type.lower()
    if side not in ("buy", "sell"):
        raise OrderError("side must be 'buy' or 'sell'")
    if order_type not in ("market", "limit", "stop", "stop_limit", "trailing_stop"):
        raise OrderError(f"Unknown order_type '{order_type}'")
    if order_type == "limit" and limit_price is None:
        raise OrderError("limit orders require limit_price")
    if order_type in ("stop", "stop_limit") and stop_price is None:
        raise OrderError("stop/stop_limit orders require stop_price")
    if order_type == "stop_limit" and limit_price is None:
        raise OrderError("stop_limit orders require both stop_price and limit_price")
    if order_type == "trailing_stop" and trail_amount is None:
        raise OrderError("trailing_stop orders require trail_amount")
    if quantity <= 0:
        raise OrderError("quantity must be positive")

    oco_group_id = None
    if oco_with is not None:
        existing = db.query_one("SELECT * FROM orders WHERE id = ?", (oco_with,))
        if not existing:
            raise OrderError(f"oco_with order id {oco_with} not found")
        oco_group_id = existing["oco_group_id"] or str(uuid.uuid4())
        if not existing["oco_group_id"]:
            db.execute("UPDATE orders SET oco_group_id = ? WHERE id = ?", (oco_group_id, oco_with))

    # trailing stop tracks price via stop_price, initialized relative to current price
    initial_stop = stop_price
    if order_type == "trailing_stop":
        px = _latest_price(market, symbol)
        initial_stop = px - trail_amount if side == "sell" else px + trail_amount

    order_id = db.execute(
        """INSERT INTO orders
           (user_id, market, symbol, side, order_type, quantity, limit_price,
            stop_price, trail_amount, oco_group_id, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            user_id, market, symbol.upper(), side, order_type, quantity,
            limit_price, initial_stop, trail_amount, oco_group_id, note,
        ),
    )

    if order_type == "market":
        _fill_order(order_id, _latest_price(market, symbol))

    return get_order(order_id)


def get_order(order_id: int) -> dict | None:
    return db.query_one("SELECT * FROM orders WHERE id = ?", (order_id,))


def list_orders(user_id: str = "default", status: str | None = None) -> list[dict]:
    if status:
        return db.query_all(
            "SELECT * FROM orders WHERE user_id = ? AND status = ? ORDER BY created_at DESC",
            (user_id, status),
        )
    return db.query_all("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC", (user_id,))


def cancel_order(order_id: int) -> dict:
    order = get_order(order_id)
    if not order:
        raise OrderError(f"Order {order_id} not found")
    if order["status"] != "open":
        raise OrderError(f"Order {order_id} is not open (status={order['status']})")
    db.execute("UPDATE orders SET status = 'cancelled' WHERE id = ?", (order_id,))
    return get_order(order_id)


def _fill_order(order_id: int, price: float, fee_bps: float = 5.0) -> None:
    order = get_order(order_id)
    if not order or order["status"] != "open":
        return
    fee = price * order["quantity"] * (fee_bps / 10000.0)

    db.execute(
        "UPDATE orders SET status = 'filled', filled_price = ?, filled_at = datetime('now'), fee = ? WHERE id = ?",
        (price, fee, order_id),
    )
    db.execute(
        """INSERT INTO trades (user_id, order_id, market, symbol, side, quantity, price, fee)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (order["user_id"], order_id, order["market"], order["symbol"], order["side"],
         order["quantity"], price, fee),
    )

    # OCO: cancel the sibling order
    if order["oco_group_id"]:
        siblings = db.query_all(
            "SELECT * FROM orders WHERE oco_group_id = ? AND id != ? AND status = 'open'",
            (order["oco_group_id"], order_id),
        )
        for sib in siblings:
            db.execute("UPDATE orders SET status = 'cancelled' WHERE id = ?", (sib["id"],))


def check_and_fill_pending(user_id: str = "default") -> list[dict]:
    """
    Poll this periodically (e.g. every minute via a scheduler/cron in your app)
    to evaluate open limit/stop/trailing-stop orders against current prices and
    fill or update them as needed. Returns the list of orders that changed.
    """
    changed = []
    open_orders = list_orders(user_id=user_id, status="open")
    # group by (market, symbol) to minimize data fetches
    symbols = {(o["market"], o["symbol"]) for o in open_orders}
    prices = {}
    for market, symbol in symbols:
        try:
            prices[(market, symbol)] = _latest_price(market, symbol)
        except Exception:
            continue

    for order in open_orders:
        key = (order["market"], order["symbol"])
        if key not in prices:
            continue
        price = prices[key]
        side = order["side"]
        otype = order["order_type"]

        if otype == "limit":
            if (side == "buy" and price <= order["limit_price"]) or (
                side == "sell" and price >= order["limit_price"]
            ):
                _fill_order(order["id"], order["limit_price"])
                changed.append(get_order(order["id"]))

        elif otype == "stop":
            if (side == "buy" and price >= order["stop_price"]) or (
                side == "sell" and price <= order["stop_price"]
            ):
                _fill_order(order["id"], price)
                changed.append(get_order(order["id"]))

        elif otype == "stop_limit":
            triggered = (side == "buy" and price >= order["stop_price"]) or (
                side == "sell" and price <= order["stop_price"]
            )
            if triggered and (
                (side == "buy" and price <= order["limit_price"])
                or (side == "sell" and price >= order["limit_price"])
            ):
                _fill_order(order["id"], order["limit_price"])
                changed.append(get_order(order["id"]))

        elif otype == "trailing_stop":
            new_stop = order["stop_price"]
            if side == "sell":
                candidate = price - order["trail_amount"]
                new_stop = max(order["stop_price"], candidate)
                if price <= order["stop_price"]:
                    _fill_order(order["id"], price)
                    changed.append(get_order(order["id"]))
                    continue
            else:  # buy-side trailing stop (trails downward moves)
                candidate = price + order["trail_amount"]
                new_stop = min(order["stop_price"], candidate)
                if price >= order["stop_price"]:
                    _fill_order(order["id"], price)
                    changed.append(get_order(order["id"]))
                    continue
            if new_stop != order["stop_price"]:
                db.execute("UPDATE orders SET stop_price = ? WHERE id = ?", (new_stop, order["id"]))

    return changed
