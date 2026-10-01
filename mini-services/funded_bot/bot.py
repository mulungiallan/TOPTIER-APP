"""Real-time FundingPips bot.

    python bot.py --model zero --phase master --size 100000 --dry-run
    python bot.py --model 2step_flex --phase phase1 --size 50000 --split 80
    python bot.py --model 1step_flex --phase master --size 25000 --peak-equity 25400

Models : zero | 1step_flex | 2step_standard | 2step_flex | 2step_pro
Phases : phase1 | phase2 | master
Run on DEMO first with --dry-run, then live. Read README.md.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any, Optional

from guard import GuardConfig, NewsFilter, RuleGuard, norm, validate
from profiles import MODELS, build_profile
from strategy import StrategyParams, compute_indicators, signal_at

log = logging.getLogger("bot")


def setup_logging(path: Optional[str] = None):
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(logging.INFO)
    root.addHandler(logging.StreamHandler(sys.stdout))
    if path:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        root.addHandler(logging.FileHandler(path))
    for h in root.handlers:
        h.setFormatter(fmt)


def run_funded_bot(
    *,
    profile,
    gcfg: GuardConfig,
    sp: StrategyParams,
    symbols,
    news_cfg: dict,
    state_path: str,
    mt5_cfg: dict,
    peak_equity: Optional[float] = None,
    log_path: Optional[str] = None,
    dry_run: bool = False,
    check_only: bool = False,
    news_always: bool = True,
    magic: Optional[int] = None,
) -> dict[str, Any]:
    """Run the funded bot. Credentials must arrive in ``mt5_cfg`` in memory.

    ``mt5_cfg`` is built from environment variables by the caller and is never
    written to disk. If ``login`` is falsy the broker attaches to the
    already-logged-in terminal instead of authenticating.
    """
    setup_logging(log_path)

    news = NewsFilter(gcfg, news_cfg.get("calendar_file"), news_cfg.get("feed_url"),
                      tuple(news_cfg.get("impacts", ["High"])), news_cfg.get("include_speeches", True))
    guard = RuleGuard(profile, gcfg, state_path, peak_equity, news, news_always=news_always)

    log.info("PROFILE %s | phase=%s | size=%s | daily %s%% | max %s%% (%s) | news=%s | weekend hold=%s",
             profile.label, profile.phase, profile.size, profile.daily_loss_pct, profile.max_loss_pct,
             profile.max_loss_mode, profile.news_restricted, profile.weekend_hold_allowed)
    for n in profile.notes:
        log.warning("VERIFY: %s", n)
    limits = guard.limits()
    log.info("bot risk: %.2f%%/trade, max %d positions | soft limits: daily %.2f, max %.2f",
             gcfg.risk_per_trade_pct, gcfg.max_positions, limits["daily_soft"], limits["max_soft"])
    if check_only:
        return {"profile": profile.label, "limits": limits}

    from broker_mt5 import MT5Broker
    broker = MT5Broker(mt5_cfg, mt5_cfg.get("server_utc_offset_hours", 3.0),
                       magic=magic if magic is not None else 26092026)
    ai = broker.connect()
    if abs(ai.balance - profile.size) / profile.size > 0.05:
        log.warning("account balance %.2f differs >5%% from profile size %s. Limits are computed from the "
                    "profile size; make sure it is the STARTING size of this account.",
                    ai.balance, profile.size)
    real = {s: broker.resolve(s) for s in symbols}
    broker.check_server_offset(next(iter(real.values())))

    last_bar: dict = {}
    last_status = 0.0
    prev_reasons: tuple = ()
    consecutive_errors = 0
    log.info("running%s. Ctrl-C stops the bot (open positions keep their SL/TP but are then unmanaged).",
             " (DRY RUN)" if dry_run else "")

    while True:
        try:
            snap = broker.snapshot()
            net, closed = broker.closed_today(guard.platform_day(snap.time), guard.platform_day)
            v = guard.evaluate(snap, net, closed)

            if snap.positions and (v.flatten_all or v.flatten_symbols):
                targets = snap.positions if v.flatten_all else [
                    p for p in snap.positions if norm(p.symbol) in v.flatten_symbols]
                log.warning("FLATTENING %d position(s): %s", len(targets), "; ".join(v.reasons))
                if not dry_run:
                    done = broker.close_many(targets)
                    if done < len(targets):
                        log.error("could not close all positions (%d/%d) - retrying next loop", done, len(targets))
                flattened = True
            else:
                flattened = False

            reasons = tuple(v.reasons)
            if reasons != prev_reasons:
                if reasons:
                    log.info("guard: %s", " | ".join(reasons))
                prev_reasons = reasons

            if v.allow_new and not flattened:
                for name, sym in real.items():
                    bars = broker.closed_bars(sym, 1500)
                    if bars is None:
                        continue
                    bar_t = int(bars[-1]["time"])
                    if last_bar.get(sym) == bar_t:
                        continue
                    last_bar[sym] = bar_t
                    ind = compute_indicators(bars["open"], bars["high"], bars["low"], bars["close"], sp)
                    d, atr_v = signal_at(ind, len(bars) - 1, sp)
                    if d == 0:
                        continue
                    tick = broker.tick(sym)
                    if tick is None:
                        log.info("%s signal ignored: stale/no tick", sym)
                        continue
                    if (tick.ask - tick.bid) > sp.max_spread_atr * atr_v:
                        log.info("%s signal ignored: spread %.5f too wide vs ATR %.5f", sym, tick.ask - tick.bid, atr_v)
                        continue
                    dist = sp.sl_atr * atr_v
                    entry = tick.ask if d == 1 else tick.bid
                    sl = entry - d * dist
                    tp = entry + d * sp.rr * dist
                    risk_money = profile.size * gcfg.risk_per_trade_pct / 100
                    lots = broker.lots_for_risk(sym, risk_money, dist)
                    if lots <= 0:
                        log.info("%s signal ignored: minimum lot would risk more than %.2f", sym, risk_money)
                        continue
                    actual_risk = broker.risk_of(sym, lots, dist)
                    ok, why = guard.can_open(snap, v, sym, actual_risk)
                    if not ok:
                        log.info("%s %s signal blocked: %s", sym, "BUY" if d == 1 else "SELL", why)
                        continue
                    log.info("%s %s %.2f lots @ %.5f SL %.5f TP %.5f (risk %.2f)", sym,
                             "BUY" if d == 1 else "SELL", lots, entry, sl, tp, actual_risk)
                    if not dry_run:
                        if broker.open(sym, d, lots, sl, tp) is None:
                            log.error("%s order failed", sym)
                        else:
                            snap = broker.snapshot()     # so max_positions sees the new trade
                    else:
                        log.info("(dry run: order not sent)")

            if time.time() - last_status > 60:
                log.info(guard.status(snap, net))
                last_status = time.time()
            consecutive_errors = 0
            time.sleep(1.0)
        except KeyboardInterrupt:
            log.warning("stopped by user. Open positions (if any) still have their SL/TP.")
            break
        except Exception as e:   # noqa: BLE001 - keep running, but shout
            consecutive_errors += 1
            log.exception("loop error #%d: %s", consecutive_errors, e)
            try:
                time.sleep(min(30, 2 * consecutive_errors))
            except KeyboardInterrupt:
                log.warning("stopped by user.")
                break

    broker.shutdown()
    return {"profile": profile.label, "limits": limits, "stopped": True}


def mt5_cfg_from_env(base: Optional[dict] = None) -> dict:
    """Build the in-memory MT5 config. Environment variables win.

    With ``MT5_LOGIN`` set the broker authenticates; without it the broker attaches to the
    already-logged-in terminal. Nothing here is ever written to disk.
    """
    cfg = dict(base or {})
    login = os.environ.get("MT5_LOGIN", "").strip()
    if login:
        cfg["login"] = int(login)
        cfg["password"] = os.environ.get("MT5_PASSWORD", "")
        cfg["server"] = os.environ.get("MT5_SERVER", "")
    else:
        cfg["login"] = 0
        cfg.pop("password", None)
    for env_key, cfg_key in (("MT5_PATH", "path"),
                             ("MT5_SYMBOL_SUFFIX", "symbol_suffix"),
                             ("MT5_UTC_OFFSET", "server_utc_offset_hours")):
        value = os.environ.get(env_key, "").strip()
        if value:
            cfg[cfg_key] = value
    return cfg


def load_cli_config(path: str) -> dict:
    if not os.path.exists(path):
        raise SystemExit(f"{path} not found. Copy config.example.json to {path} and fill it in.")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, choices=MODELS)
    ap.add_argument("--phase", default="master", choices=("phase1", "phase2", "master"))
    ap.add_argument("--size", required=True, type=int, help="starting account size, e.g. 100000")
    ap.add_argument("--split", type=int, default=80, choices=(80, 95), help="2step_flex reward split")
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--peak-equity", type=float, help="highest equity so far, from the dashboard "
                    "(needed for Zero if you have traded before and state.json is missing)")
    ap.add_argument("--dry-run", action="store_true", help="log signals, send no orders")
    ap.add_argument("--check", action="store_true", help="print rules/limits and exit")
    a = ap.parse_args()

    cfg = load_cli_config(a.config)
    profile = build_profile(a.model, a.phase, a.size, a.split)
    gcfg = GuardConfig(**cfg.get("guard", {}))
    validate(profile, gcfg)
    sp = StrategyParams(**cfg.get("strategy", {}))

    tag = f"{a.model}_{a.phase}_{a.size}"
    os.makedirs("logs", exist_ok=True)
    run_funded_bot(
        profile=profile,
        gcfg=gcfg,
        sp=sp,
        symbols=cfg.get("symbols", ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"]),
        news_cfg=cfg.get("news", {}),
        state_path=f"logs/state_{tag}.json",
        mt5_cfg=mt5_cfg_from_env(cfg.get("mt5")),
        peak_equity=a.peak_equity,
        log_path=f"logs/{tag}.log",
        dry_run=a.dry_run,
        check_only=a.check,
        news_always=cfg.get("avoid_news_in_evaluation", True),
    )


if __name__ == "__main__":
    main()
