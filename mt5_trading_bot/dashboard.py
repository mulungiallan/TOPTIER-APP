"""
dashboard.py
--------------
Prints a periodic text snapshot of the bot's live status to the console
AND writes the same data as JSON to config.DASHBOARD_SNAPSHOT_FILE, so a
separate process (web_dashboard.py) can display it in a browser without
needing its own MT5 connection. Read-only -- never affects any trading
decision.
"""

import json
import logging
from datetime import datetime

import config
import mt5_connector as mt5c
import trade_tracker as tt
import risk_manager as rm
import trade_frequency as tf

logger = logging.getLogger("dashboard")


def _build_snapshot(approved_combos: dict) -> dict:
    account_info = mt5c.get_account_info()
    if account_info is None:
        return None

    open_positions = [p for p in mt5c.get_open_positions() if p.magic == config.BOT_MAGIC_NUMBER]
    overall_stats = tt.get_live_stats()
    freq_status = tf.get_status() if config.USE_TRADE_FREQUENCY_TARGET else None
    approved_count = sum(1 for v in approved_combos.values() if len(v) >= 1)

    return {
        "timestamp": datetime.now().isoformat(),
        "equity": round(account_info.equity, 2),
        "balance": round(account_info.balance, 2),
        "currency": account_info.currency,
        "open_positions": [
            {
                "symbol": p.symbol,
                "direction": "BUY" if p.type == 0 else "SELL",
                "volume": p.volume,
                "profit": round(p.profit, 2),
            }
            for p in open_positions
        ],
        "max_open_positions": config.MAX_OPEN_POSITIONS,
        "open_risk_pct": round(rm.get_open_portfolio_risk(), 2),
        "portfolio_risk_ceiling_pct": config.PORTFOLIO_MAX_RISK_PCT,
        "overall_stats": overall_stats,
        "freq_status": freq_status,
        "approved_combo_count": approved_count,
        "total_combo_count": len(approved_combos),
    }


def print_dashboard(approved_combos: dict):
    snapshot = _build_snapshot(approved_combos)
    if snapshot is None:
        logger.warning("Dashboard: could not fetch account info.")
        return

    try:
        with open(config.DASHBOARD_SNAPSHOT_FILE, "w") as f:
            json.dump(snapshot, f, indent=2)
    except OSError as e:
        logger.warning(f"Could not write dashboard snapshot file: {e}")

    lines = []
    lines.append("=" * 64)
    lines.append("TRADING BOT DASHBOARD")
    lines.append("=" * 64)
    lines.append(f"Time:              {snapshot['timestamp']}")
    lines.append(f"Equity:            {snapshot['equity']} {snapshot['currency']}")
    lines.append(f"Balance:           {snapshot['balance']} {snapshot['currency']}")
    lines.append(f"Open positions:    {len(snapshot['open_positions'])} / {snapshot['max_open_positions']} max")
    lines.append(f"Open risk:         {snapshot['open_risk_pct']} (ceiling {snapshot['portfolio_risk_ceiling_pct']}% of equity)")
    lines.append("-" * 64)
    overall_stats = snapshot["overall_stats"]
    if overall_stats["trade_count"] > 0:
        lines.append(
            f"All-time:          {overall_stats['trade_count']} trades, "
            f"{overall_stats['wins']}W/{overall_stats['losses']}L, "
            f"win rate {overall_stats['win_rate_pct']}%, profit factor {overall_stats['profit_factor']}, "
            f"P/L {overall_stats['total_profit']}"
        )
    else:
        lines.append("All-time:          no closed trades yet")
    if snapshot["freq_status"]:
        fs = snapshot["freq_status"]
        lines.append(
            f"Today's pace:      {fs['trades_today']} / {fs['target']} target trades, "
            f"relaxation level {fs['relaxation_level']} (effective min votes {fs['effective_min_votes']})"
        )
    lines.append(f"Approved combos:   {snapshot['approved_combo_count']} (symbol, timeframe) combos have at least 1 approved strategy")
    lines.append("-" * 64)
    if snapshot["open_positions"]:
        for pos in snapshot["open_positions"]:
            lines.append(f"  {pos['symbol']:<10} {pos['direction']:<5} {pos['volume']:.2f} lots   P/L: {pos['profit']:.2f}")
    else:
        lines.append("  (no open positions)")
    lines.append("=" * 64)

    print("\n".join(lines))
    logger.info("Dashboard snapshot printed and saved.")
