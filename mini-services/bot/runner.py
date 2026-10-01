"""
runner.py
---------
Process entrypoint for ONE bot instance. The service (server.py) spawns
`python runner.py <instanceId>` as a subprocess; this script:

  1. loads the instance spec (data/instances/<id>/instance.json),
  2. generates the instance's config.py (credentials + settings overrides),
  3. for MT4 instances, installs the MT4 bridge connector as mt5_connector.py
     so the engine can import it unchanged,
  4. puts the instance workspace at the FRONT of sys.path so every
     `import config` resolves to the per-instance file,
  5. imports the engine and runs main.main().

Anything the engine prints goes to stdout/stderr, which the service captures
into data/instances/<id>/bot_activity.log.
"""

import os
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import settings  # noqa: E402
import instance_util  # noqa: E402


def _install_mt4_connector(workspace: Path):
    """MT4 has no Python API, so we shim the engine's `import mt5_connector`
    with the TCP bridge client. The bridge talks to the ToptierBridge.mq4 EA
    running inside the user's MT4 terminal (see mt4_bridge/README)."""
    bridge = Path(__file__).resolve().parent / "mt4_bridge" / "mt4_connector.py"
    if not bridge.exists():
        raise RuntimeError("MT4 bridge connector not found: mt4_bridge/mt4_connector.py")
    source = bridge.read_text(encoding="utf-8")
    (workspace / "mt5_connector.py").write_text(
        "# Generated MT4 bridge shim - lets the engine's `import mt5_connector`\n"
        "# resolve to the TCP client that talks to ToptierBridge.mq4.\n"
        + source,
        encoding="utf-8",
    )


def _service_setting(name: str) -> str:
    """Read a service setting from the environment, falling back to the generated
    config.py when one exists.

    Funded instances do not generate a config.py (that file belongs to the
    standard engine), so lifecycle reporting must not depend on importing it.
    """
    value = os.environ.get(name, "")
    if value:
        return value
    try:
        import config
        return str(getattr(config, name, "") or "")
    except Exception:
        return ""


def _report(event: str, payload: dict, instance_id: str, workspace: Path):
    """Best-effort lifecycle report straight to the app webhook. Never raises."""
    try:
        import reporter
        reporter.report_event(event, payload)
    except Exception:
        try:
            # Fall back to a direct POST if reporter can't import for any reason.
            import json
            import urllib.request
            body = json.dumps({
                "instanceId": instance_id,
                "type": "lifecycle",
                "event": event,
                "data": payload,
            }).encode("utf-8")
            req = urllib.request.Request(
                _service_setting("WEBHOOK_URL"), data=body, method="POST",
                headers={"Content-Type": "application/json",
                         "x-bot-service-key": _service_setting("BOT_SERVICE_KEY")},
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass


def _export_credentials(spec: dict):
    """Hand the broker credentials to the engine through the environment.

    The engine's config.py reads MT5_LOGIN / MT5_PASSWORD / MT5_SERVER with
    os.environ.get(...), so exporting them here is enough for it to pick them up
    - and it keeps them out of the generated config.py on disk. Values are
    decrypted from the spec just before use and live only in this process.
    """
    os.environ["MT5_LOGIN"] = str(spec.get("login", "") or "")
    os.environ["MT5_PASSWORD"] = spec.get("password", "") or ""
    os.environ["MT5_SERVER"] = spec.get("server", "") or ""
    # Funded instances have no generated config.py, so the lifecycle reporter reads
    # the webhook target from the environment.
    os.environ["WEBHOOK_URL"] = spec.get("webhookUrl", "") or ""
    # The service already injected its own key; keep it for the webhook calls.
    if not os.environ.get("BOT_SERVICE_KEY") and settings.BOT_SERVICE_KEY:
        os.environ["BOT_SERVICE_KEY"] = settings.BOT_SERVICE_KEY


# ---------------------------------------------------------------------------
# Funded-account mode
#
# Deliberately a separate execution path from the standard engine. A funded
# instance never gets a generated config.py and never imports
# mt5_trading_bot.main, so it cannot inherit that engine's equity-scaled lot
# sizing. Sizing and every hard limit come from the FundingPips profile.
# ---------------------------------------------------------------------------

FUNDED_DIR = Path(__file__).resolve().parent.parent / "funded_bot"

# Guard/strategy knobs a funded user may set from the app. Anything not listed
# keeps the funded module's conservative default.
FUNDED_GUARD_KEYS = {
    "risk_per_trade_pct", "max_positions", "soft_frac", "open_risk_soft_frac",
    "idea_soft_frac", "daily_profit_stop_pct", "daily_loss_stop_pct",
    "max_consecutive_losses", "symbol_cooldown_min", "session_start_utc",
    "session_end_utc", "flatten_utc", "friday_flatten_utc",
    "news_before_min", "news_after_min", "news_entry_lead_min",
    "news_flatten_lead_min", "flatten_all",
}
FUNDED_STRATEGY_KEYS = {
    "ema_fast", "ema_slow", "ema_trend", "rsi_n", "rsi_long", "rsi_short",
    "atr_n", "sl_atr", "rr", "max_spread_atr",
}
FUNDED_NEWS_KEYS = {"feed_url", "impacts", "include_speeches"}
FUNDED_DEFAULT_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"]
FUNDED_DEFAULT_FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"


def _funded_settings(raw, allowed: set) -> dict:
    if raw in (None, ""):
        return {}
    if not isinstance(raw, dict):
        raise ValueError("funded settings must be an object")
    return {k: v for k, v in raw.items() if k in allowed}


def _funded_symbols(spec: dict) -> list:
    raw = spec.get("fundedSymbols") or FUNDED_DEFAULT_SYMBOLS
    if isinstance(raw, str):
        raw = [s for s in raw.split(",")]
    if not isinstance(raw, list):
        raise ValueError("fundedSymbols must be a list of symbols")
    symbols = [str(s).strip().upper() for s in raw if str(s).strip()]
    if not symbols:
        raise ValueError("fundedSymbols is empty")
    return symbols


def _funded_news(spec: dict, workspace: Path) -> tuple[dict, bool]:
    """News config plus the 'block news in evaluation' flag.

    The on-disk calendar is only used when it actually exists, otherwise the
    HTTP feed is the single source. If neither loads the guard fails closed and
    simply stops opening new trades, which is the safe outcome for funded money.
    """
    cfg = _funded_settings(spec.get("fundedNews"), FUNDED_NEWS_KEYS)
    calendar = workspace / "news_calendar.csv"
    cfg["calendar_file"] = str(calendar) if calendar.exists() else ""
    cfg.setdefault("feed_url", FUNDED_DEFAULT_FEED)
    cfg.setdefault("impacts", ["High"])
    cfg.setdefault("include_speeches", True)
    avoid_news = spec.get("fundedAvoidNews")
    return cfg, True if avoid_news is None else bool(avoid_news)


def _run_funded(spec: dict, instance_id: str, workspace: Path) -> int:
    if not FUNDED_DIR.exists():
        raise RuntimeError(f"funded bot module is missing: {FUNDED_DIR}")
    sys.path.insert(0, str(FUNDED_DIR))

    from profiles import build_profile
    from guard import GuardConfig, validate
    from strategy import StrategyParams
    from bot import run_funded_bot, mt5_cfg_from_env

    model = str(spec.get("fundedModel") or "").strip().lower()
    phase = str(spec.get("fundedPhase") or "master").strip().lower()
    raw_size = spec.get("fundedSize")
    if not model:
        raise ValueError("funded mode requires fundedModel")
    if raw_size in (None, ""):
        raise ValueError("funded mode requires fundedSize")
    try:
        size = int(raw_size)
    except (TypeError, ValueError):
        raise ValueError(f"fundedSize must be a number, got {raw_size!r}") from None
    try:
        split = int(spec.get("fundedSplit") or 80)
    except (TypeError, ValueError):
        raise ValueError(f"fundedSplit must be 80 or 95, got {spec.get('fundedSplit')!r}") from None

    # build_profile rejects an unknown model, a phase that model does not have,
    # and a size that model does not offer.
    profile = build_profile(model, phase, size, split)

    gcfg = GuardConfig(**_funded_settings(spec.get("fundedGuard"), FUNDED_GUARD_KEYS))
    validate(profile, gcfg)
    sp = StrategyParams(**_funded_settings(spec.get("fundedStrategy"), FUNDED_STRATEGY_KEYS))

    raw_peak = spec.get("fundedPeakEquity")
    peak_equity = None if raw_peak in (None, "") else float(raw_peak)

    news_cfg, avoid_news = _funded_news(spec, workspace)
    tag = f"{profile.key}_{profile.phase}_{int(profile.size)}"

    _report("starting", {
        "platform": spec.get("platform"),
        "mode": "funded",
        "profile": profile.label,
        "phase": profile.phase,
        "size": profile.size,
        "dailyLossPct": profile.daily_loss_pct,
        "maxLossPct": profile.max_loss_pct,
        "maxLossMode": profile.max_loss_mode,
        "message": "funded-account bot instance starting",
    }, instance_id, workspace)

    run_funded_bot(
        profile=profile,
        gcfg=gcfg,
        sp=sp,
        symbols=_funded_symbols(spec),
        news_cfg=news_cfg,
        # Peak equity behind the trailing floor. Must survive restarts.
        state_path=str(workspace / f"state_{tag}.json"),
        mt5_cfg=mt5_cfg_from_env(),
        peak_equity=peak_equity,
        # Same filename the app already tails, so the existing log UI works.
        log_path=str(workspace / "bot_activity.log"),
        dry_run=bool(spec.get("fundedDryRun")),
        news_always=avoid_news,
        # Per-instance magic so two instances never collide on one account.
        magic=instance_util.derive_magic(instance_id),
    )

    _report("stopped", {
        "mode": "funded",
        "profile": profile.label,
        "message": "funded bot exited cleanly",
    }, instance_id, workspace)
    return 0


def main():
    if len(sys.argv) < 2:
        print("usage: runner.py <instanceId>", file=sys.stderr)
        return 2

    instance_id = sys.argv[1]
    spec = instance_util.load_spec(instance_id)
    if spec is None:
        print(f"no spec found for instance {instance_id}", file=sys.stderr)
        return 1

    workspace = instance_util.instance_dir(instance_id)

    # Credentials must be in the environment before write_config generates the
    # file (it emits env lookups) and before the engine is imported.
    _export_credentials(spec)

    # Funded accounts take a completely separate path: no generated config.py,
    # no mt5_trading_bot import, sizing driven by the FundingPips profile.
    if spec.get("mode") == "funded":
        os.chdir(workspace)
        try:
            return _run_funded(spec, instance_id, workspace)
        except Exception:
            traceback.print_exc()
            _report("error", {
                "mode": "funded",
                "message": traceback.format_exc()[-2000:],
            }, instance_id, workspace)
            return 1

    # 1 + 2: generate the instance config.py
    instance_util.write_config(spec, workspace / "config.py")

    # 3: MT4 bridge shim (only for MT4 accounts)
    if spec.get("platform") == "mt4":
        _install_mt4_connector(workspace)

    # 4: instance workspace first in sys.path, engine second.
    os.chdir(workspace)
    sys.path.insert(0, str(workspace))
    sys.path.insert(1, str(settings.ENGINE_DIR))

    _report("starting", {"platform": spec.get("platform"), "message": "bot instance starting"}, instance_id, workspace)

    try:
        import main
        main.main()
        _report("stopped", {"message": "bot exited cleanly"}, instance_id, workspace)
        return 0
    except KeyboardInterrupt:
        print("runner: interrupted by user")
        _report("stopped", {"message": "bot stopped by user"}, instance_id, workspace)
        return 0
    except SystemExit as exc:
        code = int(exc.code or 0)
        if code != 0:
            _report("error", {"message": f"bot exited with code {code}"}, instance_id, workspace)
        return code
    except Exception:
        traceback.print_exc()
        _report("error", {"message": traceback.format_exc()[-2000:]}, instance_id, workspace)
        return 1


if __name__ == "__main__":
    sys.exit(main())
