"""
trade_tracker.py
-------------------
Tracks the bot's REAL, live trading performance -- not a backtest, not an
estimate. Every trade the bot opens gets remembered (in PENDING_TRADES_FILE).
Every scan, it checks MT5's closed-deal history for any of those trades
that have since closed (hit SL, hit TP, or were closed some other way),
records the actual realized profit/loss to TRADE_LOG_FILE, and updates a
running win rate / profit factor you can check at any time.

This is the honest answer to "what's the win rate of this bot": there
isn't one number that's true forever, because it depends on real trades
it actually takes. This module is what produces that number, continuously,
from the bot's own real results.
"""

import json
import csv
import os
import logging
from datetime import datetime, timezone

import config
import mt5_connector as mt5c

logger = logging.getLogger("trade_tracker")


# ----------------------------------------------------------------------
# Pending trades: trades the bot has opened but hasn't yet seen close.
# Stored as JSON so the bot remembers them across restarts.
# ----------------------------------------------------------------------

def _load_pending() -> dict:
    if not os.path.exists(config.PENDING_TRADES_FILE):
        return {}
    try:
        with open(config.PENDING_TRADES_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        logger.warning("Pending trades file was unreadable, starting fresh.")
        return {}


def _save_pending(pending: dict):
    with open(config.PENDING_TRADES_FILE, "w") as f:
        json.dump(pending, f, indent=2)


def record_new_trade(ticket: int, symbol: str, timeframe: str, direction: str,
                      lot: float, entry_price: float, sl_price: float, tp_price: float,
                      strategies_agreed: dict, risk_amount: float):
    """Call this right after a successful order_send, to start tracking it."""
    pending = _load_pending()
    pending[str(ticket)] = {
        "symbol": symbol,
        "timeframe": timeframe,
        "direction": direction,
        "lot": lot,
        "original_lot": lot,              # never changes -- used to compute the partial-close volume
        "entry_price": entry_price,
        "original_sl_price": sl_price,   # never changes -- used to compute "1R" for breakeven/trailing
        "sl_price": sl_price,            # current SL, gets updated by position_manager.py over time
        "tp_price": tp_price,
        "breakeven_applied": False,
        "partial_closed": False,
        "tp_levels_hit": [],            # which take-profit ladder levels have already banked their share
        "realized_profit_so_far": 0.0,   # accumulates profit from any partial closes before the final close
        "processed_deal_tickets": [],     # deal IDs already counted, so partial closes aren't double-counted
        "strategies_agreed": strategies_agreed,
        "risk_amount": risk_amount,
        "open_time": datetime.now(timezone.utc).isoformat(),
    }
    _save_pending(pending)
    logger.info(f"Now tracking ticket {ticket} ({symbol} {timeframe} {direction}) for live performance stats.")


def get_pending_trade(ticket: int) -> dict:
    """Returns the tracked metadata for one open ticket, or None if not tracked."""
    pending = _load_pending()
    return pending.get(str(ticket))


def get_open_pending_trades() -> dict:
    """Public accessor for every trade currently tracked as open. Keys are ticket strings."""
    return _load_pending()


def update_pending_trade(ticket: int, **fields):
    """Update one or more fields (e.g. sl_price, breakeven_applied) for a tracked open ticket."""
    pending = _load_pending()
    key = str(ticket)
    if key not in pending:
        return
    pending[key].update(fields)
    _save_pending(pending)


# ----------------------------------------------------------------------
# Closed trade log: append-only CSV, one row per trade that actually closed.
# ----------------------------------------------------------------------

_CSV_HEADERS = [
    "ticket", "symbol", "timeframe", "direction", "lot",
    "entry_price", "sl_price", "tp_price", "close_price",
    "open_time", "close_time", "profit", "result",
    "strategies_agreed", "risk_amount",
]


def _ensure_csv_header():
    if not os.path.exists(config.TRADE_LOG_FILE):
        with open(config.TRADE_LOG_FILE, "w", newline="") as f:
            csv.writer(f).writerow(_CSV_HEADERS)


def _append_closed_trade(row: dict):
    _ensure_csv_header()
    with open(config.TRADE_LOG_FILE, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=_CSV_HEADERS)
        writer.writerow(row)


def check_closed_trades():
    """
    Call this every scan. Looks up real closed-deal history from MT5,
    matches it against trades the bot is still tracking as pending, and
    for any that have FULLY closed: logs the real total profit/loss, removes
    the chart markers, and drops it from the pending file.

    Handles partial closes correctly: a partial close also generates a
    closing deal, but the position still exists afterward. This function
    only finalizes a trade once MT5 confirms the position no longer
    exists -- until then, it just accumulates the realized profit from
    each partial close (without double-counting deals already processed
    in a previous scan) and keeps tracking the trade as open.
    """
    pending = _load_pending()
    if not pending:
        return

    earliest_open = min(
        datetime.fromisoformat(t["open_time"]) for t in pending.values()
    )
    closing_deals = mt5c.get_closing_deals_since(earliest_open, magic=config.BOT_MAGIC_NUMBER)

    if not closing_deals:
        return

    closed_by_position = {}
    for deal in closing_deals:
        closed_by_position.setdefault(deal.position_id, []).append(deal)

    still_pending = {}
    for ticket_str, trade in pending.items():
        try:
            ticket = int(ticket_str)
            deals_for_this = closed_by_position.get(ticket, [])
            already_processed = set(trade.get("processed_deal_tickets", []))
            new_deals = [d for d in deals_for_this if d.ticket not in already_processed]

            if not new_deals:
                still_pending[ticket_str] = trade
                continue

            new_profit = sum(d.profit for d in new_deals)
            trade["processed_deal_tickets"] = list(already_processed | {d.ticket for d in new_deals})
            trade["realized_profit_so_far"] = trade.get("realized_profit_so_far", 0.0) + new_profit

            if mt5c.position_exists(ticket):
                # Partial close: keep tracking, update remaining lot size, don't finalize yet.
                pos = mt5c.get_position_by_ticket(ticket)
                if pos:
                    trade["lot"] = pos.volume
                still_pending[ticket_str] = trade
                logger.info(
                    f"Ticket {ticket} ({trade['symbol']}): partial close realized {new_profit:.2f}, "
                    f"{trade['lot']} lots still open."
                )
                continue

            # Position no longer exists -- this was the final close.
            total_profit = trade["realized_profit_so_far"]
            close_price = new_deals[-1].price
            close_time = datetime.fromtimestamp(new_deals[-1].time, tz=timezone.utc).isoformat()
            result = "WIN" if total_profit > 0 else ("LOSS" if total_profit < 0 else "BREAKEVEN")

            _append_closed_trade({
                "ticket": ticket,
                "symbol": trade["symbol"],
                "timeframe": trade["timeframe"],
                "direction": trade["direction"],
                "lot": trade.get("original_lot", trade["lot"]),
                "entry_price": trade["entry_price"],
                "sl_price": trade["sl_price"],
                "tp_price": trade["tp_price"],
                "close_price": close_price,
                "open_time": trade["open_time"],
                "close_time": close_time,
                "profit": round(total_profit, 2),
                "result": result,
                "strategies_agreed": json.dumps(trade["strategies_agreed"]),
                "risk_amount": trade["risk_amount"],
            })

            mt5c.remove_trade_markers(ticket, trade["symbol"])
            logger.info(
                f"Trade closed: ticket {ticket} {trade['symbol']} {trade['timeframe']} "
                f"{trade['direction']} -> {result} (total profit={total_profit:.2f})"
            )
        except Exception:
            # Never let one ticket's processing failure abort the whole scan -- that would
            # block position management and new-trade evaluation for everything else too.
            # Keep it in still_pending so we retry it next scan rather than silently lose it.
            logger.exception(f"Error processing closed-trade check for ticket {ticket_str}, will retry next scan.")
            still_pending[ticket_str] = trade

    _save_pending(still_pending)


# ----------------------------------------------------------------------
# Live stats: read back the closed-trade log and compute real performance.
# ----------------------------------------------------------------------

def get_live_stats(symbol: str = None, timeframe: str = None) -> dict:
    """
    Returns real performance computed from actually-closed trades:
    {trade_count, wins, losses, win_rate_pct, profit_factor, total_profit, avg_profit}
    Optionally filter to one symbol and/or timeframe.
    Returns trade_count=0 stats if no trades have closed yet -- there is no
    win rate to report until the bot has actually closed real trades.
    """
    if not os.path.exists(config.TRADE_LOG_FILE):
        return {"trade_count": 0, "wins": 0, "losses": 0, "win_rate_pct": None,
                "profit_factor": None, "total_profit": 0.0, "avg_profit": None}

    rows = []
    with open(config.TRADE_LOG_FILE, "r", newline="") as f:
        for row in csv.DictReader(f):
            if symbol and row["symbol"] != symbol:
                continue
            if timeframe and row["timeframe"] != timeframe:
                continue
            rows.append(row)

    if not rows:
        return {"trade_count": 0, "wins": 0, "losses": 0, "win_rate_pct": None,
                "profit_factor": None, "total_profit": 0.0, "avg_profit": None}

    profits = [float(r["profit"]) for r in rows]
    wins = [p for p in profits if p > 0]
    losses = [p for p in profits if p < 0]

    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    win_rate = len(wins) / len(rows) * 100
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (float("inf") if gross_profit > 0 else 0.0)

    return {
        "trade_count": len(rows),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": round(win_rate, 1),
        "profit_factor": round(profit_factor, 2) if profit_factor != float("inf") else profit_factor,
        "total_profit": round(sum(profits), 2),
        "avg_profit": round(sum(profits) / len(profits), 2),
    }


def log_stats_summary():
    """Logs an overall live-performance summary plus a per-symbol breakdown."""
    overall = get_live_stats()
    if overall["trade_count"] == 0:
        logger.info("LIVE STATS: no trades have closed yet. Nothing to report until real trades complete.")
        return

    logger.info(
        f"LIVE STATS (real closed trades): {overall['trade_count']} trades, "
        f"{overall['wins']}W/{overall['losses']}L, win rate {overall['win_rate_pct']}%, "
        f"profit factor {overall['profit_factor']}, total P/L {overall['total_profit']}"
    )

    for symbol in config.SYMBOLS:
        s = get_live_stats(symbol=symbol)
        if s["trade_count"] > 0:
            logger.info(
                f"  {symbol}: {s['trade_count']} trades, win rate {s['win_rate_pct']}%, "
                f"profit factor {s['profit_factor']}, P/L {s['total_profit']}"
            )


def get_recent_results(n: int) -> list:
    """Returns the result ('WIN'/'LOSS'/'BREAKEVEN') of the last n closed trades, oldest to newest. Used by the consecutive-loss limiter."""
    if not os.path.exists(config.TRADE_LOG_FILE):
        return []
    rows = []
    with open(config.TRADE_LOG_FILE, "r", newline="") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return [r["result"] for r in rows[-n:]]
