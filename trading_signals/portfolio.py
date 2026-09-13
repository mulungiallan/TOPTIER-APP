"""
Portfolio tracking built entirely from the `trades` table (filled orders).
Uses FIFO lot matching for realized P&L / tax-lot reporting, which is the
default accounting method most retail brokers use unless the user elects
otherwise (LIFO/specific-lot).
"""

from __future__ import annotations
from collections import defaultdict, deque
from . import db
from . import data_fetcher as dfetch


def _fifo_positions_and_realized(trades: list[dict]) -> tuple[dict, list[dict]]:
    """
    Walk trades in chronological order, matching sells against the oldest
    open buy lots (and vice versa for short positions). Returns:
      open_lots: {(market, symbol): deque of {quantity, price, opened_at}}
      realized:  list of closed-lot records with realized P&L
    """
    open_lots: dict[tuple, deque] = defaultdict(deque)
    realized = []

    for t in sorted(trades, key=lambda x: x["executed_at"]):
        key = (t["market"], t["symbol"])
        qty = t["quantity"]
        price = t["price"]
        fee = t["fee"] or 0.0
        lots = open_lots[key]

        is_opening = (not lots or lots[0]["side"] == t["side"])

        if is_opening:
            lots.append({"side": t["side"], "quantity": qty, "price": price, "opened_at": t["executed_at"]})
            continue

        # closing against existing opposite-side lots (FIFO)
        remaining = qty
        while remaining > 1e-12 and lots:
            lot = lots[0]
            matched_qty = min(lot["quantity"], remaining)
            if lot["side"] == "buy":
                pnl = (price - lot["price"]) * matched_qty
            else:  # short lot being covered by a buy
                pnl = (lot["price"] - price) * matched_qty
            realized.append(
                {
                    "market": t["market"],
                    "symbol": t["symbol"],
                    "quantity": matched_qty,
                    "open_price": lot["price"],
                    "close_price": price,
                    "opened_at": lot["opened_at"],
                    "closed_at": t["executed_at"],
                    "realized_pnl": round(pnl - fee * (matched_qty / qty), 4),
                }
            )
            lot["quantity"] -= matched_qty
            remaining -= matched_qty
            if lot["quantity"] <= 1e-12:
                lots.popleft()

        if remaining > 1e-12:
            # flipped position: remaining opens a new lot on the other side
            lots.append({"side": t["side"], "quantity": remaining, "price": price, "opened_at": t["executed_at"]})

    return open_lots, realized


def get_positions(user_id: str = "default") -> list[dict]:
    """Current open positions with average cost basis, aggregated per symbol."""
    trades = db.query_all("SELECT * FROM trades WHERE user_id = ? ORDER BY executed_at", (user_id,))
    open_lots, _ = _fifo_positions_and_realized(trades)

    positions = []
    for (market, symbol), lots in open_lots.items():
        total_qty_buy = sum(l["quantity"] for l in lots if l["side"] == "buy")
        total_qty_sell = sum(l["quantity"] for l in lots if l["side"] == "sell")
        net_qty = total_qty_buy - total_qty_sell
        if abs(net_qty) < 1e-9:
            continue
        relevant = [l for l in lots if l["side"] == ("buy" if net_qty > 0 else "sell")]
        total_qty = sum(l["quantity"] for l in relevant)
        avg_price = sum(l["quantity"] * l["price"] for l in relevant) / total_qty if total_qty else 0.0
        positions.append(
            {
                "market": market,
                "symbol": symbol,
                "net_quantity": round(net_qty, 8),
                "direction": "long" if net_qty > 0 else "short",
                "avg_cost": round(avg_price, 6),
            }
        )
    return positions


def get_realized_pnl(user_id: str = "default") -> list[dict]:
    trades = db.query_all("SELECT * FROM trades WHERE user_id = ? ORDER BY executed_at", (user_id,))
    _, realized = _fifo_positions_and_realized(trades)
    return realized


def get_portfolio_summary(user_id: str = "default") -> dict:
    """
    Full snapshot: open positions with live mark-to-market unrealized P&L,
    total realized P&L to date, and combined totals.
    """
    positions = get_positions(user_id)
    realized = get_realized_pnl(user_id)
    total_realized = round(sum(r["realized_pnl"] for r in realized), 2)

    enriched_positions = []
    total_unrealized = 0.0
    total_market_value = 0.0
    for pos in positions:
        try:
            df = dfetch.fetch_data(market=pos["market"], symbol=pos["symbol"], period="5d", interval="1d")
            last_price = float(df["close"].iloc[-1])
        except Exception:
            last_price = None

        entry = dict(pos)
        if last_price is not None:
            market_value = last_price * pos["net_quantity"]
            cost_value = pos["avg_cost"] * pos["net_quantity"]
            unrealized = market_value - cost_value
            entry["last_price"] = round(last_price, 6)
            entry["market_value"] = round(market_value, 2)
            entry["unrealized_pnl"] = round(unrealized, 2)
            entry["unrealized_pnl_pct"] = round((unrealized / abs(cost_value)) * 100, 2) if cost_value else 0.0
            total_unrealized += unrealized
            total_market_value += market_value
        else:
            entry["last_price"] = None
            entry["market_value"] = None
            entry["unrealized_pnl"] = None
            entry["unrealized_pnl_pct"] = None

        enriched_positions.append(entry)

    return {
        "positions": enriched_positions,
        "total_market_value": round(total_market_value, 2),
        "total_unrealized_pnl": round(total_unrealized, 2),
        "total_realized_pnl": total_realized,
        "total_pnl": round(total_unrealized + total_realized, 2),
        "num_open_positions": len(enriched_positions),
        "num_closed_lots": len(realized),
    }


def get_trade_history(user_id: str = "default", limit: int = 100) -> list[dict]:
    return db.query_all(
        "SELECT * FROM trades WHERE user_id = ? ORDER BY executed_at DESC LIMIT ?", (user_id, limit)
    )
