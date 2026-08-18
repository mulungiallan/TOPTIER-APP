"""
main.py
--------
Entry point. Run this with `python main.py`.

Startup:
  1. Connect to MT5.
  2. Backtest every (symbol, timeframe, strategy) combo on history. Only
     combos that demonstrated a positive track record are "approved" for
     live trading. This is the "only profitable ones" filter, based on
     backtested history, not a promise about the future.

     Honest cost disclosure: with a broad symbol/timeframe/strategy
     universe (see config.SYMBOLS / config.TIMEFRAMES), this can mean
     hundreds of combos to backtest, which takes real wall-clock time on
     startup and on every periodic re-validation. This is NOT instant.
  3. Rank every symbol's current volatility and cache it.

Two loops run concurrently, on different cadences:
  - The MAIN loop (config.SCAN_INTERVAL_SECONDS): for each symbol, for
    each of its approved timeframes, intersects three independent
    filters -- backtest-approved strategies, volatility-bucket-matched
    strategies, and session-matched strategies -- and only strategies
    that clear ALL THREE get to vote. If enough agree (after any soft
    trade-frequency relaxation), size and place a trade with
    confidence-scaled, portfolio-budget-bounded risk.
  - The MICRO-SCALP loop (config.MICRO_SCALP_SCAN_INTERVAL_SECONDS, much
    faster) only runs if config.USE_MICRO_SCALPING is True. It looks for
    tick-confirmed bursts on EXTREME-volatility symbols, gated by
    REQUIRE_NON_EXPERIMENTAL_AGREEMENT so it can never trade alone.

Every scan, regardless of loop: check for closed trades (update real
win-rate stats), manage open positions (partial close, breakeven,
trailing), and force-close anything still open past rollover time.

Trading is paused (no NEW entries; existing positions still managed)
whenever: the daily loss kill switch trips, the daily profit target is
hit, the consecutive-loss limiter is active, the portfolio risk budget
is full, max position count is hit, or it's outside trading hours.

Stop the bot any time with Ctrl+C -- it shuts down the MT5 connection
cleanly and does NOT close your open positions (those stay managed by
their own SL/TP on the broker's side).
"""

import time
import logging
import sys

import config
import mt5_connector as mt5c
import risk_manager as rm
import backtest_filter as bf
import trade_tracker as tt
import position_manager as pm
import news_filter as nf
import volatility_screener as vs
import session_manager as sm
import trade_frequency as tf
import micro_scalping as ms
import high_vol_branch as hvb
import dashboard
import reporter
from signal_combiner import get_combined_signal

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(config.LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("main")

# Populated at startup (and periodically refreshed) by run_backtest_filter().
# Keys are (symbol, timeframe) tuples, values are lists of approved strategy names.
approved_combos = {}
_scan_counter = 0


def run_backtest_filter():
    global approved_combos
    combo_count = len(config.SYMBOLS) * len(config.TIMEFRAMES) * len(bf.STRATEGY_FUNCS)
    logger.info(
        f"Running historical performance backtest across {combo_count} (symbol, timeframe, strategy) "
        f"combos -- this can take a while with a broad universe, please be patient..."
    )
    combo_results = bf.evaluate_all_combos()
    approved_combos = bf.approved_strategies_for(combo_results)

    any_approved = any(len(v) >= config.MIN_VOTES_TO_TRADE for v in approved_combos.values())
    if not any_approved:
        logger.warning(
            "No (symbol, timeframe) combo currently has enough approved strategies to "
            "reach MIN_VOTES_TO_TRADE. The bot will run but won't place trades on the main "
            "loop until a combo qualifies (try loosening MIN_WIN_RATE_PCT/MIN_PROFIT_FACTOR, "
            "or wait for the next re-validation / trade-frequency relaxation)."
        )


def symbol_has_open_position(symbol: str) -> bool:
    return len(mt5c.get_open_positions(symbol)) > 0


def _build_voting_pool(symbol: str, timeframe: str) -> list:
    """
    Intersects backtest-approved, volatility-matched, and session-matched
    strategy lists for this exact (symbol, timeframe). If an intersection
    comes back empty, falls back to the looser list and logs it, rather
    than silently over-constraining the bot into never trading anything.
    """
    backtest_approved = approved_combos.get((symbol, timeframe), [])
    if not backtest_approved:
        return []

    vol_allowed = set(vs.get_allowed_strategies_for_symbol(symbol))
    vol_intersected = [s for s in backtest_approved if s in vol_allowed]
    pool = vol_intersected if vol_intersected else backtest_approved
    if not vol_intersected:
        logger.debug(f"{symbol} {timeframe}: volatility filter would empty the pool, falling back to backtest-approved only.")

    session_allowed = sm.get_allowed_strategies_for_session()
    if session_allowed is not None:
        session_intersected = [s for s in pool if s in session_allowed]
        if session_intersected:
            pool = session_intersected
        else:
            logger.debug(f"{symbol} {timeframe}: session filter would empty the pool, falling back to volatility-matched list.")

    if config.USE_AI_STRATEGY:
        pool = pool + ["ai_strategy"]

    return pool


def run_one_scan():
    tt.check_closed_trades()
    reporter.report_closed_trades()
    reporter.report_opened_trades()
    pm.manage_open_positions()
    pm.close_positions_for_rollover()

    account_info = mt5c.get_account_info()
    if account_info is None:
        logger.error("Could not fetch account info this scan, skipping.")
        return

    if rm.kill_switch_triggered(account_info):
        return
    if rm.daily_profit_target_hit(account_info):
        return
    if rm.consecutive_loss_pause_active():
        return
    if rm.too_many_open_positions(account_info):
        logger.info("Max open positions reached for this account tier, skipping new entries this scan.")
        return
    if not pm.is_within_trading_hours():
        return

    effective_min_votes = tf.get_effective_min_votes()

    # Track which symbols already have (or just got) an open position this scan
    open_position_symbols = {
        p.symbol for p in mt5c.get_open_positions()
        if p.magic == config.BOT_MAGIC_NUMBER
    }

    # ---------------------------------------------------------------
    # PASS 1: HIGH-VOLATILITY BRANCH (primary focus)
    # Scanned first, more aggressive risk sizing, requires fewer votes
    # ---------------------------------------------------------------
    if config.HIGH_VOL_SCAN_FIRST:
        hv_plans = hvb.scan_high_vol_symbols(approved_combos, account_info, open_position_symbols)
        for plan in hv_plans:
            if rm.too_many_open_positions(account_info):
                break
            logger.info(
                f"[HIGH-VOL] Placing {plan['direction']} {plan['lot']} lots on {plan['symbol']} "
                f"({plan['timeframe']}) | SL={plan['sl_price']} TP={plan['tp_price']} | "
                f"risking ~{plan['risk_amount']} ({plan['risk_pct_used']}% of equity) | "
                f"votes: {plan['votes']}"
            )
            order_result, actual_sl, actual_tp = mt5c.send_order(
                symbol=plan["symbol"], direction=plan["direction"],
                lot=plan["lot"], sl_price=plan["sl_price"], tp_price=plan["tp_price"],
            )
            if order_result is not None and getattr(order_result, "order", None):
                mt5c.draw_trade_markers(
                    symbol=plan["symbol"], direction=plan["direction"],
                    entry_price=order_result.price, sl_price=actual_sl,
                    tp_price=actual_tp, ticket=order_result.order,
                )
                tt.record_new_trade(
                    ticket=order_result.order, symbol=plan["symbol"],
                    timeframe=plan["timeframe"], direction=plan["direction"],
                    lot=plan["lot"], entry_price=order_result.price,
                    sl_price=actual_sl, tp_price=actual_tp,
                    strategies_agreed=plan["votes"], risk_amount=plan["risk_amount"],
                )

    # ---------------------------------------------------------------
    # PASS 2: LOW-VOLATILITY BRANCH (secondary, standard forex)
    # Skips any symbol already claimed by the high-vol pass above
    # ---------------------------------------------------------------
    for symbol in config.LOW_VOL_SYMBOLS:
        if symbol in open_position_symbols:
            continue

        if rm.too_many_open_positions(account_info):
            logger.info("Max open positions reached for this account tier, skipping remaining low-vol symbols this scan.")
            break

        if rm.spread_too_wide(symbol):
            continue

        if nf.is_news_blackout(symbol):
            logger.info(f"{symbol}: skipping new entries, inside news blackout window.")
            continue

        for timeframe in config.TIMEFRAMES:
            voting_pool = _build_voting_pool(symbol, timeframe)
            non_experimental_in_pool = [s for s in voting_pool if s not in config.EXPERIMENTAL_STRATEGIES]
            if len(non_experimental_in_pool) < 1:
                continue  # nothing backtest-approved is even eligible to vote here

            df = mt5c.get_rates_dataframe(symbol, timeframe, config.BARS_TO_FETCH)
            if df.empty:
                continue

            result = get_combined_signal(df, allowed_strategies=voting_pool, min_votes_override=effective_min_votes)
            logger.info(f"{symbol} {timeframe}: votes={result['votes']} -> {result['direction']}")

            if result["direction"] == "HOLD":
                continue

            atr_mult, rr = bf.STRATEGY_RISK_PARAMS.get(
                next((s for s in result["votes"] if result["votes"][s] == result["direction"] and s not in config.EXPERIMENTAL_STRATEGIES), "trend_following"),
                (config.ATR_SL_MULTIPLIER, config.REWARD_RISK_RATIO),
            )

            plan = rm.calculate_trade_plan(
                symbol, result["direction"], df, account_info,
                confidence_ratio=result["confidence_ratio"],
                atr_sl_multiplier=atr_mult,
                reward_risk_ratio=rr,
            )
            if plan is None:
                continue

            logger.info(
                f"Placing {plan['direction']} {plan['lot']} lots on {symbol} ({timeframe}) | "
                f"SL={plan['sl_price']} TP={plan['tp_price']} | risking ~{plan['risk_amount']} "
                f"({plan['risk_pct_used']}% of equity, confidence {result['confidence_ratio']:.2f}) | "
                f"votes: {result['votes']}"
            )
            order_result, actual_sl, actual_tp = mt5c.send_order(
                symbol=symbol, direction=plan["direction"], lot=plan["lot"],
                sl_price=plan["sl_price"], tp_price=plan["tp_price"],
            )

            if order_result is not None and getattr(order_result, "order", None):
                # Record/track using actual_sl/actual_tp, NOT plan's original values -- send_order
                # may have widened the stops and retried (e.g. on a broker minimum-distance
                # rejection), and tracking the stale plan values here would corrupt the
                # breakeven/trailing R-multiple math downstream in position_manager.py.
                mt5c.draw_trade_markers(
                    symbol=symbol, direction=plan["direction"], entry_price=order_result.price,
                    sl_price=actual_sl, tp_price=actual_tp, ticket=order_result.order,
                )
                tt.record_new_trade(
                    ticket=order_result.order, symbol=symbol, timeframe=timeframe,
                    direction=plan["direction"], lot=plan["lot"], entry_price=order_result.price,
                    sl_price=actual_sl, tp_price=actual_tp,
                    strategies_agreed=result["votes"], risk_amount=plan["risk_amount"],
                )

            open_position_symbols.add(symbol)
            break  # symbol now has an open position, move to the next symbol


def main():
    global _scan_counter

    logger.info("Starting trading bot...")
    if not mt5c.connect():
        logger.error("Failed to connect to MT5. Check config.py credentials and that the terminal is installed.")
        sys.exit(1)

    run_backtest_filter()
    vs.refresh_rankings()

    logger.info(
        f"Bot is live. Main loop re-scans every {config.SCAN_INTERVAL_SECONDS}s. "
        + (f"Micro-scalp loop runs every {config.MICRO_SCALP_SCAN_INTERVAL_SECONDS}s." if config.USE_MICRO_SCALPING else "Micro-scalping is OFF.")
    )

    tick_seconds = config.MICRO_SCALP_SCAN_INTERVAL_SECONDS if config.USE_MICRO_SCALPING else config.SCAN_INTERVAL_SECONDS
    ticks_per_full_scan = max(1, round(config.SCAN_INTERVAL_SECONDS / tick_seconds))
    tick_counter = 0

    try:
        while True:
            try:
                if config.USE_MICRO_SCALPING:
                    ms.run_micro_scalp_scan(approved_combos)
                    ms.close_expired_micro_scalps()

                if tick_counter % ticks_per_full_scan == 0:
                    run_one_scan()
                    _scan_counter += 1

                    if config.USE_TRADE_FREQUENCY_TARGET and _scan_counter % config.RELAXATION_CHECK_EVERY_N_SCANS == 0:
                        tf.update_relaxation_level()

                    if _scan_counter % config.VOLATILITY_REFRESH_EVERY_N_SCANS == 0:
                        vs.refresh_rankings()

                    if config.STATS_SUMMARY_EVERY_N_SCANS and _scan_counter % config.STATS_SUMMARY_EVERY_N_SCANS == 0:
                        tt.log_stats_summary()
                        if config.USE_TRADE_FREQUENCY_TARGET:
                            logger.info(f"Trade-frequency status: {tf.get_status()}")

                    if config.DASHBOARD_ENABLED and _scan_counter % config.DASHBOARD_REFRESH_EVERY_N_SCANS == 0:
                        dashboard.print_dashboard(approved_combos)
                        reporter.report_status()

                    if config.RE_VALIDATE_EVERY_N_SCANS and _scan_counter % config.RE_VALIDATE_EVERY_N_SCANS == 0:
                        run_backtest_filter()

            except Exception:
                logger.exception("Unhandled error during scan, will retry next tick.")

            tick_counter += 1
            time.sleep(tick_seconds)
    except KeyboardInterrupt:
        logger.info("Shutdown requested by user.")
    finally:
        mt5c.shutdown()
        logger.info("MT5 connection closed. Bot stopped.")


if __name__ == "__main__":
    main()
