"""
Layer 3 — subscriber execution client with advanced risk management.

Runs on a SUBSCRIBER's machine, next to their own logged-in MT5 terminal.
Polls the backend for approved signals not yet delivered to this subscriber,
scales each one using RISK-NORMALIZED sizing (rule #1), and executes it in
THEIR account. Handles both "opened" and "closed" signals.

Risk management features:
  1. Risk-normalized position sizing (not lot-normalized)
  2. Per-provider concurrent trade cap enforcement
  3. Per-symbol and per-asset-class exposure cap enforcement
  4. Weekend gap and news blackout handling
  5. Drawdown circuit breakers (per-provider soft pause, account-wide hard stop)

Usage:
    python subscriber_client.py
"""

import time
import json
import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime, timezone
from typing import Optional

import requests
import MetaTrader5 as mt5
from dotenv import dotenv_values

log = logging.getLogger("subscriber_client")
log.setLevel(logging.INFO)
_fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
_console = logging.StreamHandler()
_console.setFormatter(_fmt)
_file = RotatingFileHandler("subscriber_client.log", maxBytes=2_000_000, backupCount=3)
_file.setFormatter(_fmt)
log.addHandler(_console)
log.addHandler(_file)

config = dotenv_values(".env")

MT5_LOGIN = int(config.get("MT5_LOGIN", "0"))
MT5_PASSWORD = config.get("MT5_PASSWORD", "")
MT5_SERVER = config.get("MT5_SERVER", "")
BACKEND_URL = config.get("BACKEND_URL", "http://localhost:8000")
API_KEY = config.get("SUBSCRIBER_API_KEY", "")
LOT_MULTIPLIER = float(config.get("LOT_MULTIPLIER", "1.0"))
MAX_LOT_SIZE = float(config.get("MAX_LOT_SIZE", "1.0"))
POLL_SECONDS = float(config.get("POLL_SECONDS", "2.0"))
EQUITY_USD = float(config.get("EQUITY_USD", "10000"))

# Risk management settings (from .env or defaults)
MAX_RISK_PER_TRADE_PCT = float(config.get("MAX_RISK_PER_TRADE_PCT", "2.0"))
MAX_CONCURRENT_TRADES = int(config.get("MAX_CONCURRENT_TRADES", "20"))
MAX_SYMBOL_EXPOSURE_PCT = float(config.get("MAX_SYMBOL_EXPOSURE_PCT", "20.0"))
MAX_ASSET_CLASS_EXPOSURE_PCT = float(config.get("MAX_ASSET_CLASS_EXPOSURE_PCT", "40.0"))
WEEKEND_CRYPTO_CAP_PCT = float(config.get("WEEKEND_CRYPTO_CAP_PCT", "50.0"))
NEWS_BLACKOUT_MINUTES = int(config.get("NEWS_BLACKOUT_MINUTES", "30"))
DRAWDOWN_SOFT_PAUSE_PCT = float(config.get("DRAWDOWN_SOFT_PAUSE_PCT", "8.0"))
ACCOUNT_WIDE_HARD_STOP_PCT = float(config.get("ACCOUNT_WIDE_HARD_STOP_PCT", "15.0"))

# Per-asset-class sizing (volatility-adjusted: forex > metals > crypto)
FOREX_BASE_LOTS_PER_100 = float(config.get("FOREX_BASE_LOTS_PER_100", "0.02"))
FOREX_MIN_LOT = float(config.get("FOREX_MIN_LOT", "0.01"))
FOREX_MAX_LOTS = float(config.get("FOREX_MAX_LOTS", "15"))
FOREX_MAX_RISK_PCT = float(config.get("FOREX_MAX_RISK_PCT", "2.0"))
METALS_BASE_LOTS_PER_100 = float(config.get("METALS_BASE_LOTS_PER_100", "0.01"))
METALS_MIN_LOT = float(config.get("METALS_MIN_LOT", "0.01"))
METALS_MAX_LOTS = float(config.get("METALS_MAX_LOTS", "5"))
METALS_MAX_RISK_PCT = float(config.get("METALS_MAX_RISK_PCT", "2.0"))
CRYPTO_BASE_LOTS_PER_100 = float(config.get("CRYPTO_BASE_LOTS_PER_100", "0.01"))
CRYPTO_MIN_LOT = float(config.get("CRYPTO_MIN_LOT", "0.02"))
CRYPTO_MAX_LOTS = float(config.get("CRYPTO_MAX_LOTS", "5"))
CRYPTO_MAX_RISK_PCT = float(config.get("CRYPTO_MAX_RISK_PCT", "1.5"))

HEADERS = {"X-API-Key": API_KEY}

# Track open positions locally for exposure calculations
_local_open_trades: list[dict] = []

# ─── Asset classification ────────────────────────────────────────────────

CRYPTO_SYMBOLS = frozenset({
    'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'ADAUSD', 'DOGEUSD',
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT',
    'BNBUSD', 'DOTUSD', 'AVAXUSD', 'LINKUSD', 'MATICUSD', 'SHIBUSD',
    'LTCUSD', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'BNBUSDT',
})
METALS = frozenset({'XAUUSD', 'XAGUSD', 'XPTUSD', 'XPDUSD'})


def classify_symbol(symbol: str) -> str:
    upper = symbol.upper().replace(' ', '')
    if upper in CRYPTO_SYMBOLS or upper.endswith('USDT'):
        return 'crypto'
    if upper in METALS:
        return 'metals'
    if len(upper) == 6 and upper.isalpha():
        return 'forex'
    return 'unknown'


def notional_per_lot(symbol: str) -> float:
    cls = classify_symbol(symbol)
    return {'forex': 100000, 'metals': 200000, 'crypto': 50000}.get(cls, 100000)


# ─── Time-based helpers ─────────────────────────────────────────────────

def is_weekend_gap_window() -> bool:
    d = datetime.now(timezone.utc)
    utc_day = d.weekday()
    utc_hour = d.hour
    if utc_day == 4 and utc_hour >= 22:
        return True
    if utc_day == 5:
        return True
    if utc_day == 6 and utc_hour < 22:
        return True
    return False


def is_news_blackout_window() -> bool:
    if NEWS_BLACKOUT_MINUTES <= 0:
        return False
    d = datetime.now(timezone.utc)
    total_minutes = d.hour * 60 + d.minute
    major_times = [12 * 60 + 30, 14 * 60]
    for event_minutes in major_times:
        if abs(total_minutes - event_minutes) <= NEWS_BLACKOUT_MINUTES:
            return True
    return False


# ─── Exposure tracking ──────────────────────────────────────────────────

def compute_net_exposure(target_symbol: Optional[str] = None) -> dict:
    long_lots = 0.0
    short_lots = 0.0
    for t in _local_open_trades:
        if target_symbol and t['symbol'] != target_symbol:
            continue
        if t['direction'] == 'buy':
            long_lots += t['size']
        else:
            short_lots += t['size']
    return {'long_lots': long_lots, 'short_lots': short_lots, 'net': long_lots - short_lots}


def would_exceed_symbol_cap(symbol: str, direction: str, size: float) -> bool:
    if EQUITY_USD <= 0:
        return False
    current = compute_net_exposure(symbol)
    delta = size if direction == 'buy' else -size
    new_net = abs(current['net'] + delta)
    cap_usd = (MAX_SYMBOL_EXPOSURE_PCT / 100) * EQUITY_USD
    new_net_usd = new_net * notional_per_lot(symbol)
    return new_net_usd > cap_usd


def would_exceed_asset_class_cap(symbol: str, direction: str, size: float) -> bool:
    if EQUITY_USD <= 0:
        return False
    cls = classify_symbol(symbol)
    class_trades = [t for t in _local_open_trades if classify_symbol(t['symbol']) == cls]
    long_lots = sum(t['size'] for t in class_trades if t['direction'] == 'buy')
    short_lots = sum(t['size'] for t in class_trades if t['direction'] != 'buy')
    current_net = long_lots - short_lots
    delta = size if direction == 'buy' else -size
    new_net = abs(current_net + delta)
    cap_usd = (MAX_ASSET_CLASS_EXPOSURE_PCT / 100) * EQUITY_USD
    new_net_usd = new_net * notional_per_lot(symbol)
    return new_net_usd > cap_usd


# ─── Risk-normalized sizing (Rule #1) ───────────────────────────────────

# Progressive tiers per asset class
FOREX_TIERS = [(1000, 1.0), (5000, 1.5), (float('inf'), 2.5)]
METALS_TIERS = [(1000, 0.8), (5000, 1.2), (float('inf'), 1.8)]
CRYPTO_TIERS = [(1000, 0.5), (5000, 0.8), (float('inf'), 1.2)]
UNKNOWN_TIERS = FOREX_TIERS

ASSET_TIERS = {'forex': FOREX_TIERS, 'metals': METALS_TIERS, 'crypto': CRYPTO_TIERS, 'unknown': UNKNOWN_TIERS}


def get_sizing_config(symbol: str) -> dict:
    """Get per-asset-class sizing config for a symbol."""
    cls = classify_symbol(symbol)
    if cls == 'forex':
        return {'base_per_100': FOREX_BASE_LOTS_PER_100, 'min_lot': FOREX_MIN_LOT,
                'max_lots': FOREX_MAX_LOTS, 'max_risk_pct': FOREX_MAX_RISK_PCT}
    elif cls == 'metals':
        return {'base_per_100': METALS_BASE_LOTS_PER_100, 'min_lot': METALS_MIN_LOT,
                'max_lots': METALS_MAX_LOTS, 'max_risk_pct': METALS_MAX_RISK_PCT}
    elif cls == 'crypto':
        return {'base_per_100': CRYPTO_BASE_LOTS_PER_100, 'min_lot': CRYPTO_MIN_LOT,
                'max_lots': CRYPTO_MAX_LOTS, 'max_risk_pct': CRYPTO_MAX_RISK_PCT}
    else:
        return {'base_per_100': FOREX_BASE_LOTS_PER_100, 'min_lot': FOREX_MIN_LOT,
                'max_lots': FOREX_MAX_LOTS, 'max_risk_pct': MAX_RISK_PER_TRADE_PCT}


def compute_progressive_lots(balance_usd: float, symbol: str) -> float:
    """Progressive lot sizing using per-asset-class tiers."""
    cfg = get_sizing_config(symbol)
    cls = classify_symbol(symbol)
    tiers = ASSET_TIERS.get(cls, UNKNOWN_TIERS)
    base = cfg['base_per_100']
    lots = 0.0
    remaining = balance_usd
    prev_cap = 0.0
    for cap, mult in tiers:
        span = min(remaining, cap - prev_cap)
        if span > 0:
            lots += (span / 100) * base * mult
        remaining -= span
        prev_cap = cap
        if remaining <= 0:
            break
    raw = max(0, lots)
    if raw == 0:
        return 0
    return round(max(cfg['min_lot'], min(cfg['max_lots'], raw)), 2)


def compute_risk_normalized_lots(
    provider_volume: float,
    provider_sl_distance: float,
    provider_equity: float,
    symbol: str,
) -> float:
    """Rule #1: Compute subscriber's lot size based on risk % parity.

    The provider's risk as % of THEIR equity = risk we replicate against
    OUR equity, clamped to max_risk_per_trade_pct.
    """
    if provider_equity <= 0 or provider_sl_distance <= 0:
        # Fallback to progressive sizing with per-class tiers
        return compute_progressive_lots(EQUITY_USD, symbol)

    cls = classify_symbol(symbol)
    cfg = get_sizing_config(symbol)

    # Estimate provider's risk in USD
    if cls == 'crypto':
        multiplier = 1.0 if 'BTC' in symbol.upper() else 10.0
        provider_risk_usd = provider_volume * provider_sl_distance * multiplier
    elif cls == 'metals':
        provider_risk_usd = provider_volume * provider_sl_distance * 2000
    else:
        pips = provider_sl_distance / 0.0001
        provider_risk_usd = provider_volume * pips * 10

    provider_risk_pct = (provider_risk_usd / provider_equity) * 100

    # Clamp to per-class max risk
    target_risk_pct = min(provider_risk_pct, cfg['max_risk_pct'])
    target_risk_usd = (target_risk_pct / 100) * EQUITY_USD

    # Reverse-engineer lots
    if cls == 'crypto':
        multiplier = 1.0 if 'BTC' in symbol.upper() else 10.0
        risk_per_lot = provider_sl_distance * multiplier
    elif cls == 'metals':
        risk_per_lot = provider_sl_distance * 2000
    else:
        risk_per_lot = (provider_sl_distance / 0.0001) * 10

    if risk_per_lot <= 0:
        return compute_progressive_lots(EQUITY_USD, symbol)

    lots = round(target_risk_usd / risk_per_lot, 2)
    lots = max(cfg['min_lot'], min(lots, cfg['max_lots']))

    return lots


# ─── Drawdown tracking ──────────────────────────────────────────────────

_drawdown_tracker: dict[str, float] = {}  # symbol -> cumulative P/L


def update_drawdown(realized_pl: float, symbol: str):
    """Track running drawdown for circuit breaker checks."""
    _drawdown_tracker[symbol] = _drawdown_tracker.get(symbol, 0) + realized_pl


def check_soft_pause() -> bool:
    """Rule #5: Check if per-provider drawdown has hit soft pause threshold."""
    total_pl = sum(_drawdown_tracker.values())
    if EQUITY_USD <= 0:
        return False
    drawdown_pct = (total_pl / EQUITY_USD) * 100
    if drawdown_pct <= -DRAWDOWN_SOFT_PAUSE_PCT:
        log.warning("Soft pause triggered: drawdown %.1f%% exceeds threshold %.1f%%",
                     drawdown_pct, DRAWDOWN_SOFT_PAUSE_PCT)
        return True
    return False


def check_hard_stop() -> bool:
    """Rule #5: Check if account-wide drawdown has hit hard stop threshold."""
    total_pl = sum(_drawdown_tracker.values())
    if EQUITY_USD <= 0:
        return False
    drawdown_pct = (total_pl / EQUITY_USD) * 100
    if drawdown_pct <= -ACCOUNT_WIDE_HARD_STOP_PCT:
        log.critical("HARD STOP triggered: drawdown %.1f%% exceeds threshold %.1f%%. ALL trading paused.",
                      drawdown_pct, ACCOUNT_WIDE_HARD_STOP_PCT)
        return True
    return False


# ─── MT5 operations ─────────────────────────────────────────────────────

def connect():
    if not mt5.initialize(login=MT5_LOGIN, password=MT5_PASSWORD, server=MT5_SERVER):
        raise RuntimeError(f"MT5 initialize() failed: {mt5.last_error()}")
    log.info("Connected to subscriber MT5 account %s on %s", MT5_LOGIN, MT5_SERVER)


def fetch_pending_signals():
    resp = requests.get(f"{BACKEND_URL}/signals/pending", headers=HEADERS, timeout=5)
    resp.raise_for_status()
    return resp.json()


def confirm(signal_id: int, executed: bool, local_ticket: int = None, realized_pl: float = None,
            computed_lots: float = None, provider_risk_pct: float = None, actual_risk_pct: float = None):
    payload = {"signal_id": signal_id, "executed": executed}
    if local_ticket is not None:
        payload["local_ticket"] = local_ticket
    if realized_pl is not None:
        payload["realized_pl"] = realized_pl
    if computed_lots is not None:
        payload["computed_lots"] = computed_lots
    if provider_risk_pct is not None:
        payload["provider_risk_pct"] = provider_risk_pct
    if actual_risk_pct is not None:
        payload["actual_risk_pct"] = actual_risk_pct
    try:
        resp = requests.post(f"{BACKEND_URL}/signals/confirm", json=payload, headers=HEADERS, timeout=5)
        if resp.ok and resp.json().get("kill_switch_tripped"):
            log.warning("Daily loss limit reached — no new signals delivered until tomorrow (UTC).")
    except requests.RequestException as e:
        log.warning("Failed to confirm execution for signal %s: %s", signal_id, e)


def execute_open(sig: dict):
    # ── Rule #5: Circuit breaker pre-checks ────────────────────────────
    if check_hard_stop():
        log.warning("Hard stop active — rejecting signal %s", sig["id"])
        confirm(sig["id"], executed=False)
        return

    if check_soft_pause():
        log.warning("Soft pause active — rejecting signal %s", sig["id"])
        confirm(sig["id"], executed=False)
        return

    # ── Rule #2: Concurrent trade cap ──────────────────────────────────
    if len(_local_open_trades) >= MAX_CONCURRENT_TRADES:
        log.warning("Concurrent trade cap %d reached — rejecting signal %s", MAX_CONCURRENT_TRADES, sig["id"])
        confirm(sig["id"], executed=False)
        return

    # ── Rule #4: Time-based rules ──────────────────────────────────────
    cls = classify_symbol(sig["symbol"])
    if cls in ('forex', 'metals'):
        if is_weekend_gap_window():
            log.info("Weekend gap window — blocking forex/metals signal %s", sig["id"])
            confirm(sig["id"], executed=False)
            return
        if is_news_blackout_window():
            log.info("News blackout — blocking %s signal %s", cls, sig["id"])
            confirm(sig["id"], executed=False)
            return

    # ── Rule #1: Risk-normalized sizing ────────────────────────────────
    # Try to get provider's equity and SL distance for risk-normalized sizing
    provider_equity = float(sig.get("provider_equity", 0))
    sl_distance = abs(sig.get("sl", 0) - sig.get("price_open", 0)) if sig.get("sl") else 0

    if provider_equity > 0 and sl_distance > 0:
        volume = compute_risk_normalized_lots(sig["volume"], sl_distance, provider_equity, sig["symbol"])
        provider_risk_pct = (sig["volume"] * sl_distance / provider_equity) * 100 if provider_equity > 0 else 0
        actual_risk_pct = (volume * sl_distance / EQUITY_USD) * 100 if EQUITY_USD > 0 else 0
    else:
        # Fallback to simple multiplier
        volume = round(sig["volume"] * LOT_MULTIPLIER, 2)
        volume = min(volume, MAX_LOT_SIZE)
        provider_risk_pct = None
        actual_risk_pct = None

    if volume <= 0:
        log.info("Skipping signal %s: scaled volume is 0", sig["id"])
        confirm(sig["id"], executed=False)
        return

    # ── Rule #3: Exposure cap checks ───────────────────────────────────
    direction = "buy" if sig["direction"] == "buy" else "sell"
    if would_exceed_symbol_cap(sig["symbol"], direction, volume):
        log.info("Per-symbol exposure cap would be exceeded for %s — blocking signal %s", sig["symbol"], sig["id"])
        confirm(sig["id"], executed=False)
        return

    if would_exceed_asset_class_cap(sig["symbol"], direction, volume):
        log.info("Per-asset-class exposure cap would be exceeded for %s — blocking signal %s",
                 classify_symbol(sig["symbol"]), sig["id"])
        confirm(sig["id"], executed=False)
        return

    # ── Weekend crypto cap ─────────────────────────────────────────────
    if cls == 'crypto' and is_weekend_gap_window():
        volume = round(volume * (WEEKEND_CRYPTO_CAP_PCT / 100), 2)
        if volume < 0.01:
            log.info("Crypto weekend cap reduced volume below minimum for signal %s", sig["id"])
            confirm(sig["id"], executed=False)
            return

    # ── Execute the trade ──────────────────────────────────────────────
    order_type = mt5.ORDER_TYPE_BUY if sig["direction"] == "buy" else mt5.ORDER_TYPE_SELL
    tick = mt5.symbol_info_tick(sig["symbol"])
    if tick is None:
        log.warning("No tick data for %s, skipping signal %s", sig["symbol"], sig["id"])
        confirm(sig["id"], executed=False)
        return

    price = tick.ask if order_type == mt5.ORDER_TYPE_BUY else tick.bid

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": sig["symbol"],
        "volume": volume,
        "type": order_type,
        "price": price,
        "sl": sig.get("sl", 0.0),
        "tp": sig.get("tp", 0.0),
        "deviation": 20,
        "magic": 900001,
        "comment": f"copy:{sig['id']}",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request)
    ok = result is not None and result.retcode == mt5.TRADE_RETCODE_DONE
    if ok:
        log.info("Opened for signal %s: %s %s %s (local ticket %s, risk %.2f%%)",
                  sig["id"], sig["direction"], volume, sig["symbol"], result.order,
                  actual_risk_pct or 0)
        _local_open_trades.append({
            'symbol': sig["symbol"], 'direction': direction, 'size': volume,
            'ticket': result.order, 'signal_id': sig["id"],
        })
        confirm(sig["id"], executed=True, local_ticket=result.order,
                computed_lots=volume, provider_risk_pct=provider_risk_pct,
                actual_risk_pct=actual_risk_pct)
    else:
        log.error("Open failed for signal %s: %s", sig["id"], result)
        confirm(sig["id"], executed=False)


def execute_close(sig: dict):
    """Look up the local ticket and close the position."""
    try:
        resp = requests.get(
            f"{BACKEND_URL}/signals/open_lookup",
            params={"provider_ticket": sig["ticket"]},
            headers=HEADERS,
            timeout=5,
        )
        resp.raise_for_status()
        lookup = resp.json()
    except requests.RequestException as e:
        log.error("open_lookup failed for signal %s: %s", sig["id"], e)
        confirm(sig["id"], executed=False)
        return

    if not lookup.get("found") or lookup.get("local_ticket") is None:
        log.info("No local position found to close for provider ticket %s (signal %s)", sig["ticket"], sig["id"])
        confirm(sig["id"], executed=False)
        return

    local_ticket = lookup["local_ticket"]
    positions = mt5.positions_get(ticket=local_ticket)
    if not positions:
        log.info("Local ticket %s already closed or not found for signal %s", local_ticket, sig["id"])
        confirm(sig["id"], executed=False)
        return

    pos = positions[0]
    close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
    tick = mt5.symbol_info_tick(pos.symbol)
    if tick is None:
        log.warning("No tick data for %s, skipping close for signal %s", pos.symbol, sig["id"])
        confirm(sig["id"], executed=False)
        return
    price = tick.bid if close_type == mt5.ORDER_TYPE_SELL else tick.ask

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": pos.symbol,
        "volume": pos.volume,
        "type": close_type,
        "position": pos.ticket,
        "price": price,
        "deviation": 20,
        "magic": 900001,
        "comment": f"copy_close:{sig['id']}",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request)
    ok = result is not None and result.retcode == mt5.TRADE_RETCODE_DONE
    if ok:
        realized_pl = pos.profit
        log.info("Closed local ticket %s for signal %s, realized P/L %.2f",
                  local_ticket, sig["id"], realized_pl)
        # Update drawdown tracker
        update_drawdown(realized_pl, pos.symbol)
        # Remove from local open trades
        _local_open_trades[:] = [t for t in _local_open_trades if t.get('ticket') != local_ticket]
        confirm(sig["id"], executed=True, realized_pl=realized_pl)
    else:
        log.error("Close failed for signal %s (local ticket %s): %s", sig["id"], local_ticket, result)
        confirm(sig["id"], executed=False)


def execute_signal(sig: dict):
    if sig["status"] == "opened":
        execute_open(sig)
    elif sig["status"] == "closed":
        execute_close(sig)
    else:
        log.warning("Unknown signal status '%s' for signal %s, skipping", sig["status"], sig["id"])
        confirm(sig["id"], executed=False)


def run():
    connect()
    while True:
        try:
            for sig in fetch_pending_signals():
                execute_signal(sig)
        except requests.RequestException as e:
            log.error("Failed to reach backend: %s", e)
        except Exception as e:
            log.exception("Error processing signals: %s", e)

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    run()
