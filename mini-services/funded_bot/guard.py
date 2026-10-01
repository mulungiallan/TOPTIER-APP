"""Rule guard: keeps the account far away from every hard-breach limit.

The firm's limits are HARD BREACHES (account closes the instant they are touched).
So the bot never aims at them. It runs its own, much tighter "soft" limits and
flattens/halts when those are hit. Everything here is pure logic (no broker calls),
so it is fully unit-tested offline.
"""
from __future__ import annotations

import csv
import json
import logging
import os
import re
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from profiles import Profile

log = logging.getLogger("guard")

PLATFORM_OFFSET = timedelta(hours=3)   # FundingPips platform time is UTC+3 (per your file)


# ----------------------------------------------------------------------------- data
@dataclass
class Position:
    ticket: int
    symbol: str
    direction: int          # +1 long, -1 short
    volume: float
    profit: float           # floating P&L (incl. swap)
    open_time: datetime


@dataclass
class Snapshot:
    time: datetime          # UTC, tz-aware
    balance: float
    equity: float
    positions: list


@dataclass
class ClosedTrade:
    symbol: str
    direction: int          # direction of the position that was closed
    time: datetime
    net: float


@dataclass
class GuardConfig:
    risk_per_trade_pct: float = 0.25       # % of STARTING size risked per trade (at the stop-loss)
    max_positions: int = 2
    soft_frac: float = 0.5                 # halt at 50% of daily / max-loss distance
    open_risk_soft_frac: float = 0.7       # flatten at 70% of the 1% open-risk limit (Zero)
    idea_soft_frac: float = 0.5
    daily_profit_stop_pct: float = 0.6     # stop opening trades once +0.6% closed today
    daily_loss_stop_pct: float = 0.5       # stop opening trades once -0.5% closed today
    max_consecutive_losses: int = 3
    symbol_cooldown_min: int = 30          # must be >= 10 (the firm's "10 minute rule")
    session_start_utc: str = "07:00"
    session_end_utc: str = "16:30"         # no new entries after this
    flatten_utc: str = "19:30"             # everything closed by this time, every day
    friday_flatten_utc: str = "18:30"
    news_before_min: int = 10
    news_after_min: int = 10
    news_entry_lead_min: int = 30          # no new entries this long before a blackout
    news_flatten_lead_min: int = 3         # close positions this long before a blackout


@dataclass
class Verdict:
    flatten_all: bool = False
    flatten_symbols: set = field(default_factory=set)
    allow_new: bool = True
    reasons: list = field(default_factory=list)


def norm(symbol: str) -> str:
    """'EURUSD.r' -> 'EURUSD' (first 6 letters)."""
    m = re.match(r"[A-Za-z]{6}", symbol)
    return (m.group(0) if m else symbol).upper()


def _mins(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def validate(profile: Profile, cfg: GuardConfig) -> None:
    """Refuse configs whose worst case could get near a hard limit."""
    r, n = cfg.risk_per_trade_pct, cfg.max_positions
    if cfg.symbol_cooldown_min < 10:
        raise ValueError("symbol_cooldown_min must be >= 10 (10-minute same-idea rule)")
    if profile.open_risk_pct is not None:
        cap = cfg.open_risk_soft_frac * profile.open_risk_pct
        if r * n > cap + 1e-9:
            raise ValueError(
                f"risk_per_trade {r}% x {n} positions = {r*n}% exceeds the open-risk soft cap "
                f"{cap:.2f}% ({profile.open_risk_pct}% hard limit). Lower risk or max_positions."
            )
    if profile.idea_limit_pct is not None and r > cfg.idea_soft_frac * profile.idea_limit_pct:
        raise ValueError("risk_per_trade exceeds the per-trade-idea soft cap")
    worst_day = cfg.daily_loss_stop_pct + n * r
    if worst_day > cfg.soft_frac * profile.daily_loss_pct + 1e-9:
        raise ValueError(
            f"worst-case day {worst_day:.2f}% (loss stop + open trades at stop) exceeds the daily "
            f"soft limit {cfg.soft_frac * profile.daily_loss_pct:.2f}%."
        )


# ----------------------------------------------------------------------------- news
class NewsFilter:
    """High-impact news + speeches blackout. Fails CLOSED: no fresh calendar => no new trades."""

    SPEECH_WORDS = ("speaks", "speech", "testifies", "press conference")

    def __init__(self, cfg: GuardConfig, calendar_file: str | None = None,
                 feed_url: str | None = None, impacts=("High",), include_speeches=True):
        self.cfg = cfg
        self.calendar_file = calendar_file
        self.feed_url = feed_url
        self.impacts = {i.lower() for i in impacts}
        self.include_speeches = include_speeches
        self.events: list = []            # (utc datetime, currency, title)
        self._last_ok: datetime | None = None
        self._last_try: datetime | None = None

    # -- loading
    def _keep(self, impact: str, title: str) -> bool:
        if impact.lower() in self.impacts:
            return True
        return self.include_speeches and any(w in title.lower() for w in self.SPEECH_WORDS)

    def _load_feed(self):
        with urllib.request.urlopen(self.feed_url, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
        out = []
        for it in data:
            if not self._keep(it.get("impact", ""), it.get("title", "")):
                continue
            dt = datetime.fromisoformat(it["date"]).astimezone(timezone.utc)
            out.append((dt, it.get("country", "").upper(), it.get("title", "")))
        return out

    def _load_file(self):
        out = []
        with open(self.calendar_file, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):     # columns: time_utc,currency,impact,title
                if not self._keep(row.get("impact", "High"), row.get("title", "")):
                    continue
                dt = datetime.fromisoformat(row["time_utc"].replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                out.append((dt.astimezone(timezone.utc), row["currency"].upper(), row.get("title", "")))
        return out

    def refresh(self, now: datetime) -> None:
        if self._last_ok and now - self._last_ok < timedelta(hours=6):
            return
        if self._last_try and now - self._last_try < timedelta(minutes=10):
            return
        self._last_try = now
        events = None
        for loader, enabled in ((self._load_feed, self.feed_url), (self._load_file, self.calendar_file)):
            if not enabled:
                continue
            try:
                events = loader()
                break
            except Exception as e:   # noqa: BLE001 - any failure => try next source
                log.warning("news calendar load failed (%s): %s", loader.__name__, e)
        if events is not None:
            self.events, self._last_ok = events, now
            log.info("news calendar loaded: %d restricted events", len(events))

    def usable(self, now: datetime) -> bool:
        if not self._last_ok or now - self._last_ok > timedelta(hours=24):
            return False
        return bool(self.events) and max(e[0] for e in self.events) >= now

    # -- queries
    @staticmethod
    def currencies(symbol: str) -> set:
        s = norm(symbol)
        return {s[:3], s[3:6]}

    def _window(self, symbol: str, now: datetime, lead_min: int):
        cur = self.currencies(symbol)
        before = timedelta(minutes=self.cfg.news_before_min + lead_min)
        after = timedelta(minutes=self.cfg.news_after_min)
        for dt, ccy, title in self.events:
            if ccy in cur and dt - before <= now <= dt + after:
                return f"{ccy} {title} @ {dt:%H:%M}Z"
        return None

    def entry_blocked(self, symbol: str, now: datetime):
        if not self.usable(now):
            return "news calendar unavailable/stale (fail-closed)"
        return self._window(symbol, now, self.cfg.news_entry_lead_min)

    def must_flatten(self, symbol: str, now: datetime):
        return self._window(symbol, now, self.cfg.news_flatten_lead_min)


# ----------------------------------------------------------------------------- guard
class RuleGuard:
    def __init__(self, profile: Profile, cfg: GuardConfig, state_path: str | None = None,
                 peak_override: float | None = None, news: NewsFilter | None = None,
                 news_always: bool = True):
        self.p, self.cfg, self.news = profile, cfg, news
        self.news_active = news is not None and (profile.news_restricted or news_always)
        self.initial = profile.size
        self.state_path = state_path
        self.s = self._load()
        if peak_override:
            self.s["peak_equity"] = max(self.s["peak_equity"], float(peak_override))

    # -- state
    def _default(self):
        return {"peak_equity": self.initial, "day_key": None, "day_baseline": None,
                "day_halt": None, "manual_halt": None, "closed_by_day": {},
                "trade_days": [], "last_close": {}, "last_trade_close": None}

    def _load(self):
        if self.state_path and os.path.exists(self.state_path):
            try:
                with open(self.state_path) as f:
                    return {**self._default(), **json.load(f)}
            except Exception as e:   # noqa: BLE001
                log.error("state file unreadable (%s); starting fresh - SET peak_equity_override!", e)
        return self._default()

    def save(self):
        if self.state_path:
            tmp = self.state_path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(self.s, f, indent=1)
            os.replace(tmp, self.state_path)

    def clear_manual_halt(self):
        self.s["manual_halt"] = None
        self.save()

    # -- helpers
    @staticmethod
    def platform_day(now: datetime) -> str:
        return (now + PLATFORM_OFFSET).date().isoformat()

    def max_floor(self) -> float:
        """Hard equity floor for the max-loss rule."""
        gap = self.p.max_loss_pct / 100 * self.initial
        if self.p.max_loss_mode == "static":
            return self.initial - gap
        peak = self.s["peak_equity"]
        if peak >= self.initial * (1 + self.p.trail_lock_profit_pct / 100):
            return self.initial            # locked at breakeven
        return peak - gap

    def limits(self) -> dict:
        base = self.s["day_baseline"] or self.initial
        d = self.p.daily_loss_pct / 100
        gap = self.p.max_loss_pct / 100 * self.initial
        mh = self.max_floor()
        return {
            "daily_hard": base * (1 - d),
            "daily_soft": base * (1 - self.cfg.soft_frac * d),
            "max_hard": mh,
            "max_soft": mh + (1 - self.cfg.soft_frac) * gap,
        }

    def in_session(self, now: datetime) -> bool:
        m = now.hour * 60 + now.minute
        return now.weekday() < 5 and _mins(self.cfg.session_start_utc) <= m < _mins(self.cfg.session_end_utc)

    def past_flatten_time(self, now: datetime) -> bool:
        if now.weekday() >= 5:
            return True
        cut = self.cfg.friday_flatten_utc if now.weekday() == 4 else self.cfg.flatten_utc
        return now.hour * 60 + now.minute >= _mins(cut)

    # -- main evaluation
    def evaluate(self, snap: Snapshot, closed_net_today: float, closed_today: list) -> Verdict:
        s, cfg, p, I = self.s, self.cfg, self.p, self.initial
        now = snap.time
        day = self.platform_day(now)
        v = Verdict()

        if s["day_key"] != day:                               # new platform day
            est_open_balance = snap.balance - closed_net_today
            # Bot never holds overnight, so opening equity == opening balance; if something was
            # carried, equity may be higher, so take the higher (matches the firm's baseline rule).
            fresh = not snap.positions and closed_net_today == 0
            s["day_baseline"] = max(est_open_balance, snap.equity) if fresh else est_open_balance
            s["day_key"], s["day_halt"] = day, None
        s["peak_equity"] = max(s["peak_equity"], snap.equity)
        s["closed_by_day"][day] = round(closed_net_today, 2)
        for old in sorted(s["closed_by_day"])[:-60]:
            s["closed_by_day"].pop(old)
        if closed_today:
            if day not in s["trade_days"]:
                s["trade_days"].append(day)
            s["last_trade_close"] = max(t.time for t in closed_today).isoformat()
            for t in closed_today:
                key = f"{norm(t.symbol)}|{t.direction}"
                prev = s["last_close"].get(key)
                if prev is None or t.time.isoformat() > prev["time"]:
                    s["last_close"][key] = {"time": t.time.isoformat(), "net": t.net}

        L = self.limits()
        eq = snap.equity

        # --- hard-limit touched (account is already gone; flatten anyway)
        if eq <= L["daily_hard"] or eq <= L["max_hard"]:
            v.flatten_all = True
            v.reasons.append("HARD LIMIT TOUCHED - account likely breached")
            s["manual_halt"] = "hard limit touched"

        # --- soft limits
        if eq <= L["daily_soft"]:
            v.flatten_all = True
            s["day_halt"] = day
            v.reasons.append(f"daily soft limit hit (equity {eq:.2f} <= {L['daily_soft']:.2f})")
        if eq <= L["max_soft"]:
            v.flatten_all = True
            s["manual_halt"] = s["manual_halt"] or f"max-loss soft limit hit at equity {eq:.2f}"
            v.reasons.append(s["manual_halt"])

        # --- open-risk limit (Zero): only LOSING positions count, no netting with winners
        if p.open_risk_pct is not None and snap.positions:
            losers = -sum(min(pos.profit, 0.0) for pos in snap.positions)
            if losers >= cfg.open_risk_soft_frac * p.open_risk_pct / 100 * I:
                v.flatten_all = True
                s["day_halt"] = day
                v.reasons.append(f"open-risk soft limit hit (floating losers {losers:.2f})")

        # --- trade-idea limit (Zero): same symbol+direction, live losses + recent losing close
        if p.idea_limit_pct is not None:
            cap = cfg.idea_soft_frac * p.idea_limit_pct / 100 * I
            groups: dict = {}
            for pos in snap.positions:
                k = (norm(pos.symbol), pos.direction)
                groups[k] = groups.get(k, 0.0) + min(pos.profit, 0.0)
            for (sym, d), floating in groups.items():
                prev = s["last_close"].get(f"{sym}|{d}")
                recent = 0.0
                if prev and prev["net"] < 0 and now - datetime.fromisoformat(prev["time"]) < timedelta(minutes=10):
                    recent = prev["net"]
                if -(floating + recent) >= cap:
                    v.flatten_symbols.add(sym)
                    v.reasons.append(f"trade-idea soft limit hit on {sym}")

        # --- flatten schedule (no overnight / weekend holds, ever)
        if snap.positions and self.past_flatten_time(now):
            v.flatten_all = True
            v.reasons.append("end-of-day/weekend flatten")

        # --- news: close positions before a blackout starts
        if self.news_active:
            self.news.refresh(now)
            for pos in snap.positions:
                why = self.news.must_flatten(pos.symbol, now)
                if why:
                    v.flatten_symbols.add(norm(pos.symbol))
                    v.reasons.append(f"news blackout: {why}")

        # --- gates on NEW entries
        if s["manual_halt"]:
            v.allow_new = False
            v.reasons.append(f"MANUAL HALT: {s['manual_halt']}")
        if s["day_halt"] == day:
            v.allow_new = False
        if not self.in_session(now):
            v.allow_new = False
        if closed_net_today >= cfg.daily_profit_stop_pct / 100 * I:
            v.allow_new = False
            v.reasons.append("daily profit stop reached - banking the day")
        if closed_net_today <= -cfg.daily_loss_stop_pct / 100 * I:
            v.allow_new = False
            v.reasons.append("daily loss stop reached")
        streak = 0
        for t in sorted(closed_today, key=lambda t: t.time, reverse=True):
            if t.net < 0:
                streak += 1
            else:
                break
        if streak >= cfg.max_consecutive_losses:
            v.allow_new = False
            v.reasons.append(f"{streak} consecutive losses today")

        # --- evaluation-phase target: stop once reached with everything closed
        if p.target_pct and snap.balance >= I * (1 + p.target_pct / 100) and not snap.positions:
            if len(s["trade_days"]) >= p.min_trading_days:
                s["manual_halt"] = s["manual_halt"] or "PROFIT TARGET REACHED - done, stop trading"
                v.allow_new = False
                v.reasons.append(s["manual_halt"])

        if v.flatten_all or v.flatten_symbols:
            v.allow_new = False
        self.save()
        return v

    # -- pre-trade gate
    def can_open(self, snap: Snapshot, v: Verdict, symbol: str, risk_money: float):
        if not v.allow_new:
            return False, "new entries disabled"
        if len(snap.positions) >= self.cfg.max_positions:
            return False, "max positions open"
        sym = norm(symbol)
        if any(norm(pos.symbol) == sym for pos in snap.positions):
            return False, "already in this symbol"
        latest = None
        for d in (1, -1):
            lc = self.s["last_close"].get(f"{sym}|{d}")
            if lc:
                t = datetime.fromisoformat(lc["time"])
                latest = t if latest is None or t > latest else latest
        if latest and snap.time - latest < timedelta(minutes=self.cfg.symbol_cooldown_min):
            return False, "symbol cooldown"
        if risk_money > self.initial * self.cfg.risk_per_trade_pct / 100 * 1.001:
            return False, "risk above per-trade cap"
        if self.news_active:
            why = self.news.entry_blocked(symbol, snap.time)
            if why:
                return False, f"news: {why}"
        return True, "ok"

    # -- reporting
    def status(self, snap: Snapshot, closed_net_today: float) -> str:
        L = self.limits()
        days = [d for d, x in self.s["closed_by_day"].items()
                if p_ok(self.p, x, self.initial)] if self.p.profitable_day_pct else []
        pd_txt = ""
        if self.p.profitable_days_needed:
            cutoff = (snap.time + PLATFORM_OFFSET).date() - timedelta(days=self.p.profitable_days_window - 1)
            n = sum(1 for d in days if datetime.fromisoformat(d).date() >= cutoff)
            pd_txt = f" | profitable days {n}/{self.p.profitable_days_needed}"
        return (f"eq {snap.equity:,.2f} bal {snap.balance:,.2f} | today {closed_net_today:+,.2f} | "
                f"daily floor {L['daily_hard']:,.2f} (bot stops {L['daily_soft']:,.2f}) | "
                f"max floor {L['max_hard']:,.2f} | open {len(snap.positions)}{pd_txt}")


def p_ok(profile: Profile, day_pnl: float, initial: float) -> bool:
    return day_pnl >= profile.profitable_day_pct / 100 * initial
