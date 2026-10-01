from datetime import datetime, timedelta, timezone

import pytest

from guard import (ClosedTrade, GuardConfig, NewsFilter, Position, RuleGuard, Snapshot, validate)
from profiles import MODELS, PHASES, SIZES, build_profile

UTC = timezone.utc
TUE_10 = datetime(2026, 9, 29, 10, 0, tzinfo=UTC)        # Tuesday, inside session


def snap(t=TUE_10, bal=100000, eq=None, pos=()):
    return Snapshot(t, bal, bal if eq is None else eq, list(pos))


def pos(sym="EURUSD", d=1, profit=0.0, t=TUE_10):
    return Position(1, sym, d, 0.1, profit, t)


def zero(size=100000, **kw):
    return RuleGuard(build_profile("zero", "master", size), GuardConfig(**kw))


# ---- rules copied from the uploaded file -------------------------------------------------
def test_daily_baseline_uses_higher_of_balance_or_equity():
    g = zero()
    g.evaluate(snap(bal=105000, eq=107000), 0, [])          # file example 1: baseline 107K
    assert g.s["day_baseline"] == 107000
    assert g.limits()["daily_hard"] == pytest.approx(107000 - 3210)   # $103,790

    g = zero()
    g.evaluate(snap(bal=100000, eq=99000), 0, [])           # file example 2: baseline 100K
    assert g.s["day_baseline"] == 100000
    assert g.limits()["daily_hard"] == pytest.approx(97000)


def test_trailing_floor_trails_then_locks_at_start():
    g = zero()
    g.evaluate(snap(bal=100000, eq=102000), 0, [])          # file: peak 102K -> floor 97,000
    assert g.max_floor() == pytest.approx(97000)
    g.evaluate(snap(bal=105000, eq=105000), 0, [])          # 5% profit -> locks at 100K
    assert g.max_floor() == pytest.approx(100000)
    g.evaluate(snap(bal=120000, eq=120000), 0, [])          # never moves again
    assert g.max_floor() == pytest.approx(100000)


def test_open_risk_only_counts_losers_no_netting():
    g = zero()
    # file example: 3 losers -400,-350,-250 = -1000 => hard breach. Bot flattens far earlier (700).
    ps = [pos("EURUSD", profit=-400), pos("GBPUSD", profit=-350)]
    assert g.evaluate(snap(pos=ps, eq=99250), 0, []).flatten_all
    # a big winner must NOT offset losers: losers -800 + winner +2000
    g = zero()
    ps = [pos("EURUSD", profit=-800), pos("GBPUSD", profit=+2000)]
    assert g.evaluate(snap(pos=ps, eq=101200), 0, []).flatten_all
    # small losses are fine
    g = zero()
    assert not g.evaluate(snap(pos=[pos(profit=-200)], eq=99800), 0, []).flatten_all


def test_idea_limit_combines_same_symbol_and_direction():
    g = zero(size=25000)          # <50K => 3% = $750 hard; bot soft = 50% = $375
    ps = [pos("EURUSD", 1, -200), Position(2, "EURUSD", 1, 0.1, -200, TUE_10)]
    v = g.evaluate(snap(bal=25000, eq=24600, pos=ps), 0, [])
    assert "EURUSD" in v.flatten_symbols


def test_ten_minute_rule_recent_losing_close_counts():
    g = zero()
    lost = ClosedTrade("EURUSD", 1, TUE_10 - timedelta(minutes=5), -300)
    v = g.evaluate(snap(pos=[pos("EURUSD", 1, -200)], eq=99500), -300, [lost])   # 300+200 >= 500? soft=1000
    assert "EURUSD" not in v.flatten_symbols              # 500 < soft cap 1000 (2% x 50% of 100K)
    v = g.evaluate(snap(pos=[pos("EURUSD", 1, -750)], eq=98950), -300, [lost])   # 750+300 >= 1000
    assert "EURUSD" in v.flatten_symbols


def test_soft_daily_limit_flattens_and_halts_day():
    g = zero()
    g.evaluate(snap(), 0, [])
    v = g.evaluate(snap(eq=98400, pos=[pos(profit=-1600)]), 0, [])   # soft = 1.5% = 98,500
    assert v.flatten_all and not v.allow_new
    assert not g.evaluate(snap(eq=99500), 0, []).allow_new           # stays halted rest of day


def test_manual_halt_persists_and_needs_clearing(tmp_path):
    path = str(tmp_path / "s.json")
    p = build_profile("1step_flex", "master", 100000)
    g = RuleGuard(p, GuardConfig(), path)
    g.evaluate(snap(eq=93000, bal=93000), 0, [])              # below max-soft (94,000)
    g2 = RuleGuard(p, GuardConfig(), path)                    # restart the bot
    assert g2.s["manual_halt"]
    assert not g2.evaluate(snap(bal=100000), 0, []).allow_new
    g2.clear_manual_halt()
    assert g2.evaluate(snap(bal=100000), 0, []).allow_new


def test_no_weekend_or_overnight_holds():
    g = zero()
    fri = datetime(2026, 10, 2, 18, 45, tzinfo=UTC)
    assert g.evaluate(snap(fri, pos=[pos(t=fri)]), 0, []).flatten_all
    tue_late = datetime(2026, 9, 29, 19, 45, tzinfo=UTC)
    assert g.evaluate(snap(tue_late, pos=[pos(t=tue_late)]), 0, []).flatten_all
    sat = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)
    assert not g.evaluate(snap(sat), 0, []).allow_new


def test_daily_profit_stop_and_loss_stop():
    g = zero()
    assert not g.evaluate(snap(), 700, []).allow_new         # +0.7% >= 0.6% => bank the day
    g = zero()
    assert not g.evaluate(snap(), -600, []).allow_new        # -0.6% <= -0.5% => stop


def test_target_reached_halts_evaluation():
    g = RuleGuard(build_profile("2step_pro", "phase1", 100000), GuardConfig())
    g.s["trade_days"] = ["a", "b", "c"]
    v = g.evaluate(snap(bal=106500), 0, [])
    assert not v.allow_new and g.s["manual_halt"]


# ---- news --------------------------------------------------------------------------------
def make_news(tmp_path, when):
    f = tmp_path / "n.csv"
    f.write_text(f"time_utc,currency,impact,title\n{when.isoformat()},USD,High,NFP\n"
                 f"{(when + timedelta(hours=1)).isoformat()},EUR,Low,Boring\n")
    cfg = GuardConfig()
    n = NewsFilter(cfg, calendar_file=str(f))
    n.refresh(TUE_10)
    return cfg, n


def test_news_blocks_entries_and_flattens(tmp_path):
    ev = TUE_10 + timedelta(minutes=35)                      # event 10:35Z
    cfg, n = make_news(tmp_path, ev)
    g = RuleGuard(build_profile("zero", "master", 100000), cfg, news=n)
    v = g.evaluate(snap(), 0, [])
    ok, why = g.can_open(snap(), v, "EURUSD", 250)           # USD in EURUSD; 35 < 10+30 lead
    assert not ok and "news" in why
    ok, _ = g.can_open(snap(), v, "EURJPY", 250)             # no USD leg => allowed
    assert ok
    later = TUE_10 + timedelta(minutes=23)                   # 12 min before event => inside 10+3
    v = g.evaluate(snap(later, pos=[pos("GBPUSD", t=later)]), 0, [])
    assert "GBPUSD" in v.flatten_symbols


def test_news_fails_closed_without_calendar():
    n = NewsFilter(GuardConfig())                            # nothing to load
    g = RuleGuard(build_profile("zero", "master", 100000), GuardConfig(), news=n)
    v = g.evaluate(snap(), 0, [])
    ok, why = g.can_open(snap(), v, "EURUSD", 250)
    assert not ok and "fail-closed" in why


# ---- pre-trade gate ----------------------------------------------------------------------
def test_can_open_gates(tmp_path):
    g = zero()
    s = snap()
    v = g.evaluate(s, 0, [])
    assert g.can_open(s, v, "EURUSD", 250)[0]
    assert not g.can_open(s, v, "EURUSD", 900)[0]                                # over risk cap
    s2 = snap(pos=[pos("EURUSD"), pos("GBPUSD")])
    assert not g.can_open(s2, g.evaluate(s2, 0, []), "USDJPY", 250)[0]           # max positions
    cl = ClosedTrade("USDJPY", 1, TUE_10 - timedelta(minutes=12), -100)
    v = g.evaluate(snap(), -100, [cl])
    assert not g.can_open(snap(), v, "USDJPY", 250)[0]                           # cooldown
    assert g.can_open(snap(), v, "EURUSD", 250)[0]


# ---- every model x phase x size has a config that passes validation ------------------------
@pytest.mark.parametrize("model", MODELS)
def test_defaults_valid_for_all_models(model):
    for phase in PHASES[model]:
        for size in SIZES[model]:
            validate(build_profile(model, phase, size), GuardConfig())


def test_validation_rejects_dangerous_risk():
    with pytest.raises(ValueError):
        validate(build_profile("zero", "master", 100000), GuardConfig(risk_per_trade_pct=0.6))
    with pytest.raises(ValueError):
        validate(build_profile("zero", "master", 100000), GuardConfig(symbol_cooldown_min=5))
