"""
instance_util.py
----------------
Shared helpers for a single bot instance workspace:
  - workspace path resolution
  - loading / saving the instance spec (instance.json)
  - generating the instance's config.py (base engine config + overrides +
    credentials), so each account can run with its own settings without
    editing any shared source file.

Why a generated config.py instead of passing params? The engine modules are
written to `import config` and read constants from it. By placing a
per-instance config.py at the FRONT of sys.path, every `import config` inside
the engine resolves to that instance's own file. Zero engine edits required
for per-account configuration.
"""

import hashlib
import json
import os
from pathlib import Path

import settings

# config.py constants that are instance-owned and MUST always be regenerated
# (never taken from the user-supplied settings blob).
INSTANCE_OVERRIDES = {
    "MT5_LOGIN": None,   # filled at generation time
    "MT5_PASSWORD": None,
    "MT5_SERVER": None,
    "MT5_PATH": None,
    "PLATFORM": None,
    "BOT_MAGIC_NUMBER": None,
    "INSTANCE_ID": None,
    "WEBHOOK_URL": None,
    "BOT_SERVICE_KEY": None,
    "LOG_FILE": "bot_activity.log",
    "TRADE_LOG_FILE": "trade_log.csv",
    "PENDING_TRADES_FILE": "pending_trades.json",
    "DASHBOARD_SNAPSHOT_FILE": "dashboard_snapshot.json",
    "MT4_BRIDGE_DIR": None,   # filled at generation time (per-instance folder)
}

# Keys a user may tweak from the app. Everything else in config.py keeps the
# engine's conservative defaults.
ALLOWED_SETTINGS = {
    # fixed lot sizing (per $100 equity reference)
    "FOREX_BASE_LOT_PER_100", "CRYPTO_BASE_LOT_PER_100", "HIGH_VOL_BASE_LOT_PER_100",
    "BASE_LOT_EQUITY_REFERENCE", "MAX_OPEN_POSITIONS",
    # account-size tier rules (business rule caps)
    "ACCOUNT_TIER_SMALL_MAX_EQUITY", "ACCOUNT_TIER_SMALL_MAX_ENTRIES", "ACCOUNT_TIER_SMALL_MAX_LOT",
    "ACCOUNT_TIER_MID_MAX_EQUITY", "ACCOUNT_TIER_MID_MAX_ENTRIES", "ACCOUNT_TIER_MID_MAX_LOT",
    "ACCOUNT_TIER_MID_ENABLE_METALS", "ACCOUNT_TIER_MID_SCALP_PROFILE",
    # legacy risk% knobs (accepted for compatibility, not used for sizing)
    "MIN_RISK_PCT_PER_TRADE", "MAX_RISK_PCT_PER_TRADE", "PORTFOLIO_MAX_RISK_PCT",
    "REWARD_RISK_RATIO", "MAX_DAILY_LOSS_PCT",
    "MAX_SPREAD_PIPS", "ATR_PERIOD", "ATR_SL_MULTIPLIER",
    # strategy toggles
    "USE_TREND_FOLLOWING", "USE_MOMENTUM", "USE_MEAN_REVERSION", "USE_SWING",
    "USE_SCALPING", "MIN_VOTES_TO_TRADE",
    # instruments
    "SYMBOLS", "TIMEFRAMES",
    # news / hours
    "USE_NEWS_FILTER", "USE_TRADING_HOURS", "TRADING_HOURS_START", "TRADING_HOURS_END",
    # behaviour
    "USE_TP_LADDER", "TAKE_PROFIT_LEVELS",
    "USE_PARTIAL_CLOSE", "USE_TRAILING_STOP", "USE_BREAKEVEN_SHIFT",
    "USE_CONSECUTIVE_LOSS_LIMITER", "USE_DAILY_PROFIT_TARGET",
    "USE_TRADE_FREQUENCY_TARGET", "DAILY_TRADE_TARGET",
}


def instance_dir(instance_id: str) -> Path:
    import re
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', instance_id):
        raise ValueError(f"Invalid instance ID: {instance_id!r}")
    d = settings.INSTANCES_DIR / instance_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def spec_path(instance_id: str) -> Path:
    return instance_dir(instance_id) / "instance.json"


def load_spec(instance_id: str) -> dict | None:
    p = spec_path(instance_id)
    if not p.exists():
        return None
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def save_spec(spec: dict):
    p = spec_path(spec["instanceId"])
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(spec, f, indent=2)


def delete_workspace(instance_id: str):
    import shutil
    d = instance_dir(instance_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


def derive_magic(instance_id: str) -> int:
    """Stable, unique magic number per instance so the bot's trades on a shared
    account never collide with another instance's (or the user's manual) trades."""
    digest = hashlib.sha256(instance_id.encode("utf-8")).digest()
    return 100_000_000 + (int.from_bytes(digest[:8], "big") % 890_000_000)


def write_config(spec: dict, config_py: Path):
    """
    Writes the instance's config.py:
      1. the engine's base config.py verbatim, then
      2. a generated override block (credentials, instance identity, webhook,
         and any allowed user settings).
    Python module semantics make the last assignment win, so the overrides
    take effect without touching the shared engine file.
    """
    base = settings.ENGINE_DIR / "config.py"
    base_text = base.read_text(encoding="utf-8") if base.exists() else ""

    overrides = INSTANCE_OVERRIDES.copy()
    overrides["MT5_LOGIN"] = spec.get("login", 0)
    overrides["MT5_PASSWORD"] = spec.get("password", "")
    overrides["MT5_SERVER"] = spec.get("server", "")
    overrides["MT5_PATH"] = spec.get("terminalPath", "")
    overrides["PLATFORM"] = spec.get("platform", "mt5")
    overrides["BOT_MAGIC_NUMBER"] = derive_magic(spec["instanceId"])
    overrides["INSTANCE_ID"] = spec["instanceId"]
    overrides["WEBHOOK_URL"] = spec.get("webhookUrl", "")
    overrides["BOT_SERVICE_KEY"] = spec.get("serviceKey", "")
    bridge_dir = config_py.parent / "mt4_bridge"
    overrides["MT4_BRIDGE_DIR"] = str(bridge_dir)

    settings_block = []
    for key, value in (spec.get("settings") or {}).items():
        if key in ALLOWED_SETTINGS:
            settings_block.append(f"{key} = {value!r}")

    header = [
        "",
        "# " + "=" * 62,
        "# TOPTIER instance overrides (generated by mini-services/bot/runner.py)",
        "# Do not edit by hand - this file is rewritten on every start.",
        "# " + "=" * 62,
    ]

    lines = [base_text.rstrip("\n")] + header
    for key, value in overrides.items():
        lines.append(f"{key} = {value!r}")
    if settings_block:
        lines.append("")
        lines.append("# --- account-specific settings (from the app) ---")
        lines.extend(settings_block)
    lines.append("")

    config_py.write_text("\n".join(lines), encoding="utf-8")
