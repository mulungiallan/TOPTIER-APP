"""
risk_manager.py
-----------------
Every trade passes through here before it's sent to MT5. This module:
  1. Computes stop-loss/take-profit prices from ATR (strategy-specific
     multiplier/ratio, since scalping uses tighter numbers than swing/trend).
  2. Sizes the position with FIXED lots per asset class, scaled linearly
     with account equity off a $100 reference:
       - currency pairs -> FOREX_BASE_LOT_PER_100  (0.08 / $100)
       - crypto         -> CRYPTO_BASE_LOT_PER_100 (0.04 / $100)
       - metals/oil/indices (XAU, XAG, USOIL, US30, NAS100, ...)
                       -> HIGH_VOL_BASE_LOT_PER_100 (0.02 / $100)
     The old confidence-based risk% sizing is gone.
  3. Enforces the safety floors: daily-loss kill switch, daily-profit
     target, consecutive-loss pause, max-open-positions cap, spread gate,
     and the lot-floor skip (if the broker's minimum lot would risk far
     more than the fixed lot's intended risk, skip the trade).

If anything here returns False/None/blocks, the calling code must NOT
place a trade.
"""

import json
import logging
import os
from datetime import datetime, timezone, timedelta

import pandas as pd
import config
import indicators as ind
import mt5_connector as mt5c
import trade_tracker as tt

logger = logging.getLogger("risk_manager")

_day_start_equity = None
_current_day = None
_paused_until = None  # consecutive-loss pause expiry, or None
_kill_switch_breach_count = 0   # consecutive scans where drawdown looked breached -- debounces single bad readings


# ----------------------------------------------------------------------
# Daily kill switch / daily profit target
# ----------------------------------------------------------------------

def _refresh_daily_baseline(account_info):
    """Reset the daily baseline (used by both kill switch and profit target) at the start of a new UTC day."""
    global _day_start_equity, _current_day, _kill_switch_breach_count
    today = datetime.now(timezone.utc).date()
    if _current_day != today:
        _current_day = today
        _day_start_equity = account_info.equity
        _kill_switch_breach_count = 0
        logger.info(f"New trading day. Baseline equity set to {_day_start_equity:.2f}")


def kill_switch_triggered(account_info) -> bool:
    """
    True if today's drawdown has breached MAX_DAILY_LOSS_PCT for
    KILL_SWITCH_CONFIRM_SCANS consecutive checks in a row. Requiring
    repeated confirmation (not just one reading) protects against a
    single transient bad equity read (e.g. during a brief network/MT5
    reconnect hiccup) causing a false alarm -- a real loss stays low
    across multiple checks; a glitch self-corrects within seconds.
    """
    global _kill_switch_breach_count
    _refresh_daily_baseline(account_info)
    if not _day_start_equity:
        return False

    # getattr with a default protects against exactly what just happened: a code file
    # referencing a config setting that an older/unsynced config.py doesn't have yet.
    # Default of 1 = old behavior (trip on the very first breach, no debounce).
    confirm_scans_required = getattr(config, "KILL_SWITCH_CONFIRM_SCANS", 1)

    drawdown_pct = (_day_start_equity - account_info.equity) / _day_start_equity * 100
    logger.debug(f"Kill switch check: baseline={_day_start_equity:.2f}, current_equity={account_info.equity:.2f}, drawdown={drawdown_pct:.2f}%")

    if drawdown_pct >= config.MAX_DAILY_LOSS_PCT:
        _kill_switch_breach_count += 1
        logger.warning(
            f"Drawdown {drawdown_pct:.2f}% >= limit {config.MAX_DAILY_LOSS_PCT}% "
            f"(baseline equity={_day_start_equity:.2f}, current equity={account_info.equity:.2f}) "
            f"-- confirmation {_kill_switch_breach_count}/{confirm_scans_required}"
        )
        if _kill_switch_breach_count >= confirm_scans_required:
            logger.warning("KILL SWITCH CONFIRMED: no new trades today.")
            return True
        return False  # not confirmed yet, could be a transient bad reading
    else:
        if _kill_switch_breach_count > 0:
            logger.info(f"Drawdown reading recovered ({drawdown_pct:.2f}%) -- resetting kill switch confirmation counter.")
        _kill_switch_breach_count = 0
        return False


def daily_profit_target_hit(account_info) -> bool:
    """True if today's gain has reached DAILY_PROFIT_TARGET_PCT -- stop opening new trades, lock in the day."""
    if not config.USE_DAILY_PROFIT_TARGET:
        return False
    _refresh_daily_baseline(account_info)
    if not _day_start_equity:
        return False
    gain_pct = (account_info.equity - _day_start_equity) / _day_start_equity * 100
    if gain_pct >= config.DAILY_PROFIT_TARGET_PCT:
        logger.info(f"DAILY PROFIT TARGET reached: +{gain_pct:.2f}% >= {config.DAILY_PROFIT_TARGET_PCT}%. No new trades until tomorrow (UTC).")
        return True
    return False


# ----------------------------------------------------------------------
# Consecutive loss limiter
# ----------------------------------------------------------------------

def consecutive_loss_pause_active() -> bool:
    """True if the bot is currently paused due to MAX_CONSECUTIVE_LOSSES in a row."""
    global _paused_until
    if not config.USE_CONSECUTIVE_LOSS_LIMITER:
        return False

    if _paused_until is not None:
        if datetime.now(timezone.utc) < _paused_until:
            return True
        else:
            logger.info("Consecutive-loss pause has expired. Resuming normal trading.")
            _paused_until = None

    recent_results = tt.get_recent_results(config.MAX_CONSECUTIVE_LOSSES)
    if len(recent_results) == config.MAX_CONSECUTIVE_LOSSES and all(r == "LOSS" for r in recent_results):
        _paused_until = datetime.now(timezone.utc) + timedelta(hours=config.RESUME_AFTER_HOURS)
        logger.warning(
            f"CONSECUTIVE LOSS LIMITER: last {config.MAX_CONSECUTIVE_LOSSES} trades were all losses. "
            f"Pausing new entries until {_paused_until.isoformat()}."
        )
        return True
    return False


# ----------------------------------------------------------------------
# Equity curve protection
# ----------------------------------------------------------------------

def _load_equity_peak() -> float:
    if os.path.exists(config.EQUITY_PEAK_FILE):
        try:
            with open(config.EQUITY_PEAK_FILE, "r") as f:
                return json.load(f).get("peak", 0.0)
        except (json.JSONDecodeError, OSError):
            return 0.0
    return 0.0


def _save_equity_peak(peak: float):
    with open(config.EQUITY_PEAK_FILE, "w") as f:
        json.dump({"peak": peak}, f)


def get_drawdown_risk_multiplier(account_info) -> float:
    """
    Returns 1.0 normally. Returns DRAWDOWN_RISK_MULTIPLIER (e.g. 0.5) if
    current equity has fallen DRAWDOWN_REDUCTION_TRIGGER_PCT or more below
    the all-time equity peak. Updates and persists the peak as it goes.
    """
    if not config.USE_EQUITY_CURVE_PROTECTION:
        return 1.0

    peak = _load_equity_peak()
    if account_info.equity > peak:
        peak = account_info.equity
        _save_equity_peak(peak)
        return 1.0

    if peak == 0:
        return 1.0

    drawdown_pct = (peak - account_info.equity) / peak * 100
    if drawdown_pct >= config.DRAWDOWN_REDUCTION_TRIGGER_PCT:
        logger.info(
            f"Equity curve protection active: {drawdown_pct:.1f}% below peak ({peak:.2f}). "
            f"New trade risk multiplied by {config.DRAWDOWN_RISK_MULTIPLIER}."
        )
        return config.DRAWDOWN_RISK_MULTIPLIER
    return 1.0


# ----------------------------------------------------------------------
# Position count / spread gates
# ----------------------------------------------------------------------

def too_many_open_positions(account_info=None) -> bool:
    # Only count positions opened by THIS bot (identified by magic number),
    # not manual trades or other EAs on the same account.
    all_positions = mt5c.get_open_positions()
    positions = [p for p in all_positions if p.magic == config.BOT_MAGIC_NUMBER]
    if account_info is not None and getattr(account_info, "equity", 0):
        cap = max_entries_for_equity(account_info.equity)
    else:
        cap = config.MAX_OPEN_POSITIONS
    return len(positions) >= cap


def spread_too_wide(symbol: str) -> bool:
    spread = mt5c.get_spread_pips(symbol)
    if spread > config.MAX_SPREAD_PIPS:
        logger.info(f"{symbol}: spread {spread:.1f} pips exceeds max {config.MAX_SPREAD_PIPS}, skipping.")
        return True
    return False


# ----------------------------------------------------------------------
# Portfolio-level risk budget
# ----------------------------------------------------------------------

def get_open_portfolio_risk() -> float:
    """Sums the risk_amount (in account currency) of every trade the bot is currently tracking as open."""
    pending = tt.get_open_pending_trades()
    return sum(t.get("risk_amount", 0.0) for t in pending.values())


def get_remaining_portfolio_risk_budget(account_info) -> float:
    """How much more risk (in account currency) the bot is allowed to commit right now."""
    ceiling = account_info.equity * (config.PORTFOLIO_MAX_RISK_PCT / 100)
    committed = get_open_portfolio_risk()
    return max(0.0, ceiling - committed)


# ----------------------------------------------------------------------
# Asset-class classification + fixed lot sizing
# ----------------------------------------------------------------------

# Symbol-name fragments (upper-cased, broker suffix stripped) that identify
# each asset class. Anything not matching crypto or high-vol is treated as
# a currency pair (forex).
_CRYPTO_FRAGMENTS = ("BTC", "ETH", "XRP", "LTC", "SOL", "BNB", "ADA", "DOGE", "DOT", "LINK", "AVAX", "XLM", "MATIC", "XMR", "EOS", "TRX", "UNI", "ATOM", "SHIB", "PEPE", "NEAR", "APT", "ARB", "OP", "INJ", "SUI")
_HIGH_VOL_FRAGMENTS = (
    # metals
    "XAU", "XAG", "XPT", "XPD", "XAL", "XNI", "XCU", "XZN",
    # oil & energy
    "USOIL", "UKOIL", "WTI", "BRENT", "OIL", "XTI", "XBR", "NGAS", "GAS",
    # indices / futures
    "US30", "DJ30", "DOW", "NAS100", "US100", "NASDAQ", "NDX", "SPX", "US500", "SP500",
    "GER30", "DAX", "DE40", "EU50", "UK100", "FTSE", "JPN225", "NIKKEI", "HK50", "HSI",
    "AUS200", "AU200", "ASX200", "CAC40", "STOXX50", "IBEX35", "MEX40", "BOVESPA", "CHINA50",
    "SPI200", "XJO", "SMI", "NIFTY", "BANKNIFTY", "SENSEX",
)


def asset_class_for_symbol(symbol: str) -> str:
    """Classify a symbol into 'forex', 'crypto', or 'high_vol'.

    high_vol = metals, oil/energy, and stock indices (XAU, USOIL, US30,
    NAS100, ...). crypto = anything with a crypto base. Everything else is
    treated as a currency pair.
    """
    base = (symbol or "").split(".")[0].upper()
    if any(f in base for f in _CRYPTO_FRAGMENTS):
        return "crypto"
    if any(f in base for f in _HIGH_VOL_FRAGMENTS):
        return "high_vol"
    return "forex"


def base_lot_for_symbol(symbol: str, equity: float) -> float:
    """Fixed lot per asset class, scaled linearly with equity off the
    $100 reference. E.g. forex 0.08/$100 -> 0.16 on a $200 account."""
    asset_class = asset_class_for_symbol(symbol)
    per_100 = {
        "forex": config.FOREX_BASE_LOT_PER_100,
        "crypto": config.CRYPTO_BASE_LOT_PER_100,
        "high_vol": config.HIGH_VOL_BASE_LOT_PER_100,
    }[asset_class]
    reference = getattr(config, "BASE_LOT_EQUITY_REFERENCE", 100.0)
    return per_100 * (equity / reference)


# ----------------------------------------------------------------------
# Account-size tiers (business rule)
#   equity <= $50                  -> "small": 3 concurrent entries, 0.02 lot cap
#   $50 < equity <= $100           -> "mid":   2 concurrent entries, 0.02 lot cap,
#                                            metals enabled (0.01-0.02 lots),
#                                            scalping risk profile (mostly scalping)
#   equity > $100                  -> "standard": present rules, no tier cap
# ----------------------------------------------------------------------

_METAL_FRAGMENTS = ("XAU", "XAG", "XPT", "XPD", "XAL", "XNI", "XCU", "XZN")


def is_metal(symbol: str) -> bool:
    base = (symbol or "").split(".")[0].upper()
    return any(f in base for f in _METAL_FRAGMENTS)


def account_tier_for_equity(equity: float) -> str:
    if equity <= getattr(config, "ACCOUNT_TIER_SMALL_MAX_EQUITY", 50.0):
        return "small"
    if equity <= getattr(config, "ACCOUNT_TIER_MID_MAX_EQUITY", 100.0):
        return "mid"
    return "standard"


def max_entries_for_equity(equity: float) -> int:
    """Concurrent-entry cap for the account's tier. Standard = MAX_OPEN_POSITIONS."""
    tier = account_tier_for_equity(equity)
    if tier == "small":
        return int(getattr(config, "ACCOUNT_TIER_SMALL_MAX_ENTRIES", 3))
    if tier == "mid":
        return int(getattr(config, "ACCOUNT_TIER_MID_MAX_ENTRIES", 2))
    return int(config.MAX_OPEN_POSITIONS)


def max_lot_for_equity(equity: float) -> float:
    """Lot cap per trade for the account's tier. 0.0 = no tier cap (present rules)."""
    tier = account_tier_for_equity(equity)
    if tier == "small":
        return float(getattr(config, "ACCOUNT_TIER_SMALL_MAX_LOT", 0.02))
    if tier == "mid":
        return float(getattr(config, "ACCOUNT_TIER_MID_MAX_LOT", 0.02))
    return 0.0


# ----------------------------------------------------------------------
# Trade plan: fixed lot per asset class, scaled by equity, safety floors
# ----------------------------------------------------------------------

def calculate_trade_plan(symbol: str, direction: str, df, account_info,
                          confidence_ratio: float = 0.5,
                          atr_sl_multiplier: float = None,
                          reward_risk_ratio: float = None):
    """
    Returns a dict with lot size, stop-loss price, and take-profit price,
    or None if the trade should not be taken.

    Lot size is FIXED per asset class and scaled by account equity
    (see base_lot_for_symbol). confidence_ratio is accepted for signature
    compatibility with the old dynamic sizing but no longer affects the
    lot -- the fixed lot wins. Safety floors still apply: the broker's
    volume_min/volume_max clamp, and the lot-floor skip that refuses a
    trade when the broker's minimum lot would risk far more than the
    fixed lot's intended risk on this account size.

    atr_sl_multiplier / reward_risk_ratio: override the standard
    swing/trend numbers (used by scalping, which trades tighter/faster).
    """
    atr_sl_multiplier = atr_sl_multiplier or config.ATR_SL_MULTIPLIER
    reward_risk_ratio = reward_risk_ratio or config.REWARD_RISK_RATIO

    equity = account_info.equity
    tier = account_tier_for_equity(equity)

    # Mid tier ($50-$100) is "mostly scalping": force the tighter scalping
    # stop/reward profile regardless of which strategy raised the signal.
    if tier == "mid" and getattr(config, "ACCOUNT_TIER_MID_SCALP_PROFILE", False):
        atr_sl_multiplier = config.ATR_SL_MULTIPLIER_SCALPING
        reward_risk_ratio = config.REWARD_RISK_RATIO_SCALPING

    # Mid tier explicitly enables metals (XAU/XAG/...) at 0.01-0.02 lots.
    # Disabling the knob restores the old behaviour of skipping metals here.
    if tier == "mid" and not getattr(config, "ACCOUNT_TIER_MID_ENABLE_METALS", True) and is_metal(symbol):
        logger.info(f"{symbol}: mid-tier metals trading is disabled by config, skipping trade.")
        return None

    info = mt5c.get_symbol_info(symbol)
    if info is None:
        return None

    atr_series = ind.atr(df, config.ATR_PERIOD)
    last_atr = atr_series.iloc[-1]
    if last_atr is None or last_atr <= 0 or pd.isna(last_atr):
        logger.warning(f"{symbol}: invalid ATR value, skipping trade.")
        return None

    entry_price = info.ask if direction == "BUY" else info.bid
    sl_distance = last_atr * atr_sl_multiplier
    tp_distance = sl_distance * reward_risk_ratio

    # Brokers enforce a minimum distance between price and SL/TP
    # (info.trade_stops_level, in points) -- an ATR-based stop that's
    # tighter than this gets rejected outright with retcode 10016
    # "Invalid stops". Widen both SL and TP (keeping the reward:risk
    # ratio intact) to at least clear that floor, with a small buffer
    # since brokers sometimes reject orders sitting exactly at the limit.
    min_stop_points = max(getattr(info, "trade_stops_level", 0), getattr(info, "trade_freeze_level", 0))
    if min_stop_points > 0:
        min_stop_distance = min_stop_points * info.point * 1.1  # +10% buffer past the exact minimum
        if sl_distance < min_stop_distance:
            logger.info(
                f"{symbol}: ATR stop distance ({sl_distance:.5f}) is tighter than broker's minimum "
                f"({min_stop_distance:.5f}), widening to clear it."
            )
            sl_distance = min_stop_distance
            tp_distance = sl_distance * reward_risk_ratio

    if direction == "BUY":
        sl_price = entry_price - sl_distance
        tp_price = entry_price + tp_distance
    else:
        sl_price = entry_price + sl_distance
        tp_price = entry_price - tp_distance

    # --- fixed lot sizing: per asset class, scaled by equity off the
    #     $100 reference. The old confidence/risk% scaling is gone. ---
    raw_lot = base_lot_for_symbol(symbol, equity)
    if raw_lot <= 0:
        logger.warning(f"{symbol}: computed zero/negative base lot, skipping trade.")
        return None

    # Account-size tier cap: shrink the lot to the tier's maximum (never
    # grows it). Applied BEFORE the floor check so that, on a capped tier,
    # the intended risk is based on the capped lot (this is what makes
    # 0.01-0.02-lot metals tradeable on $50-$100 accounts instead of being
    # skipped by the lot-floor guard below).
    tier_cap = max_lot_for_equity(equity)
    if tier_cap > 0 and raw_lot > tier_cap:
        logger.info(f"{symbol}: account tier ({tier}, equity {equity:.2f}) caps lot at {tier_cap}, was {raw_lot:.3f}.")
        raw_lot = tier_cap

    point = info.point
    tick_value = info.trade_tick_value  # account-currency value of one tick move, per 1.0 lot
    tick_size = info.trade_tick_size or point

    sl_distance_in_ticks = sl_distance / tick_size if tick_size else 0
    value_per_lot_at_sl = sl_distance_in_ticks * tick_value

    if value_per_lot_at_sl <= 0:
        logger.warning(f"{symbol}: could not compute lot value, skipping trade.")
        return None

    lot_step = info.volume_step or 0.01
    lot = max(info.volume_min, min(info.volume_max, round(raw_lot / lot_step) * lot_step))

    # The tier cap is a hard ceiling: if the broker's minimum lot already
    # exceeds it (e.g. an instrument whose min lot is 0.05 on a 0.02-capped
    # account), skip rather than breach the cap.
    if tier_cap > 0 and lot > tier_cap:
        logger.warning(
            f"{symbol}: broker's minimum lot ({lot}) exceeds the account tier's cap ({tier_cap}) "
            f"on this {tier} tier account. Skipping rather than breach the risk rule."
        )
        return None

    # re-derive the ACTUAL risk amount for the rounded lot, for accurate logging/tracking
    actual_risk_amount = lot * value_per_lot_at_sl
    intended_risk_amount = raw_lot * value_per_lot_at_sl

    # Safety floor: on a small account, some instruments' MINIMUM tradeable lot can risk
    # far more than intended -- e.g. gold/BTC/indices often have a much larger dollar value
    # per point than a forex micro lot, so volume_min alone might already blow past the
    # fixed lot's intended risk. If the rounded lot risks more than MAX_LOT_FLOOR_RISK_MULTIPLE
    # times what was actually intended, skip the trade entirely rather than force an oversized
    # position just because the broker's floor doesn't fit this account size.
    floor_multiple = getattr(config, "MAX_LOT_FLOOR_RISK_MULTIPLE", 2.5)
    if intended_risk_amount > 0 and actual_risk_amount > intended_risk_amount * floor_multiple:
        logger.warning(
            f"{symbol}: broker's minimum lot ({lot}) would risk {actual_risk_amount:.2f}, "
            f"which is {actual_risk_amount / intended_risk_amount:.1f}x the intended risk "
            f"({intended_risk_amount:.2f}) on this account size. Skipping rather than force an "
            f"oversized position."
        )
        return None

    risk_pct_used = (actual_risk_amount / account_info.equity * 100) if account_info.equity else 0.0

    return {
        "symbol": symbol,
        "direction": direction,
        "lot": round(lot, 2),
        "sl_price": round(sl_price, info.digits),
        "tp_price": round(tp_price, info.digits),
        "risk_amount": round(actual_risk_amount, 2),
        "risk_pct_used": round(risk_pct_used, 2),
    }
