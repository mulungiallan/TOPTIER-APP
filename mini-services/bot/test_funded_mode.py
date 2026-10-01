"""
test_funded_mode.py
-------------------
Regression tests for the funded-account dispatch in runner.py.

A funded account is the user's own money at risk under a prop firm's hard
limits, so the funded path must be provably separate from the standard engine:

  1. mode=funded never generates a config.py and never imports
     mt5_trading_bot.main, so equity-scaled lot sizing cannot reach it
  2. run_funded_bot is called with the profile the user chose
  3. broker credentials reach the funded broker through the environment only
  4. an unknown model, a phase that model does not have, and an unsupported
     account size all fail loudly instead of falling back to standard sizing
  5. the peak-equity state file name is stable, because the trailing floor
     depends on it surviving restarts
  6. each instance gets a distinct magic number

Run: python -m unittest test_funded_mode -v   (from mini-services/bot)
"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

import runner  # noqa: E402


class _FakeConfig:
    """Stands in for a generated config.py that must never be created."""

    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class FundedDispatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="funded-mode-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

        self.calls = []
        self._real_run = None
        self._patched = {}

        # Stub the funded module's entry point so the loop never runs.
        self._patched["run_funded_bot"] = self._fake_run
        self._patched["mt5_cfg_from_env"] = self._fake_mt5_cfg

    def _install(self, module_name, **attrs):
        import types
        mod = types.ModuleType(module_name)
        for k, v in attrs.items():
            setattr(mod, k, v)
        return mod

    def _fake_run(self, **kwargs):
        self.calls.append(kwargs)
        return {"profile": "stub", "limits": {}}

    def _fake_mt5_cfg(self, base=None):
        # Mirrors the real helper: env wins, and the result is in-memory only.
        import os
        cfg = dict(base or {})
        login = os.environ.get("MT5_LOGIN", "").strip()
        if login:
            cfg["login"] = int(login)
            cfg["password"] = os.environ.get("MT5_PASSWORD", "")
            cfg["server"] = os.environ.get("MT5_SERVER", "")
        else:
            cfg["login"] = 0
        return cfg

    def _stub_modules(self):
        """Register fake profiles/guard/strategy/bot modules on sys.path order."""
        real = {}
        for name in ("profiles", "guard", "strategy", "broker_mt5", "bot"):
            real[name] = sys.modules.get(name)
        self.addCleanup(self._restore, real)

        def profile(model, phase, size, split=80):
            if model not in ("zero", "1step_flex", "2step_standard", "2step_flex", "2step_pro"):
                raise ValueError(f"unknown model {model!r}")
            phases = {
                "zero": ("master",),
                "1step_flex": ("phase1", "master"),
                "2step_standard": ("phase1", "phase2", "master"),
                "2step_flex": ("phase1", "phase2", "master"),
                "2step_pro": ("phase1", "phase2", "master"),
            }[model]
            if phase not in phases:
                raise ValueError(f"{model} has phases {phases}, not {phase!r}")
            sizes = {
                "zero": (5000, 10000, 25000, 50000, 100000, 200000),
                "1step_flex": (5000, 10000, 25000, 50000, 100000),
                "2step_standard": (5000, 10000, 25000, 50000, 100000),
                "2step_flex": (5000, 10000, 25000, 50000, 100000),
                "2step_pro": (5000, 10000, 25000, 50000, 100000, 200000),
            }[model]
            if int(size) not in sizes:
                raise ValueError(f"{model} sizes are {sizes}, not {size}")
            limits = {
                "zero": (3.0, 5.0, "trailing_lock"),
                "1step_flex": (3.0, 12.0, "static"),
                "2step_standard": (3.0, 10.0, "static"),
                "2step_flex": (4.0, 12.0, "static"),
                "2step_pro": (3.0, 6.0, "static"),
            }[model]
            return _FakeConfig(key=model, phase=phase, size=float(size),
                               label=f"{model} {phase}",
                               daily_loss_pct=limits[0], max_loss_pct=limits[1],
                               max_loss_mode=limits[2])

        sys.modules["profiles"] = self._install("profiles", build_profile=profile)
        sys.modules["guard"] = self._install(
            "guard", GuardConfig=lambda **kw: _FakeConfig(**kw), validate=lambda *a: None)
        sys.modules["strategy"] = self._install(
            "strategy", StrategyParams=lambda **kw: _FakeConfig(**kw))
        sys.modules["bot"] = self._install(
            "bot", run_funded_bot=self._fake_run, mt5_cfg_from_env=self._fake_mt5_cfg)

    def _restore(self, real):
        for name, mod in real.items():
            if mod is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = mod

    def _spec(self, **over):
        spec = {
            "instanceId": "inst_test01",
            "mode": "funded",
            "platform": "mt5",
            "fundedModel": "zero",
            "fundedPhase": "master",
            "fundedSize": 100000,
            "login": "1234567",
            "password": "SecretPass!7",
            "server": "Broker-Server",
            "webhookUrl": "https://example.test/hook",
        }
        spec.update(over)
        return spec

    # -- separation from the standard engine

    def test_funded_mode_never_writes_config_py(self):
        self._stub_modules()
        rc = runner._run_funded(self._spec(), "inst_test01", self.tmp)
        self.assertEqual(rc, 0)
        self.assertFalse((self.tmp / "config.py").exists(),
                         "funded instances must not get a standard-engine config.py")

    def test_funded_mode_reports_lifecycle(self):
        self._stub_modules()
        events = []
        original = runner._report
        runner._report = lambda event, payload, iid, ws: events.append((event, payload))
        self.addCleanup(lambda: setattr(runner, "_report", original))

        runner._run_funded(self._spec(), "inst_test01", self.tmp)

        names = [e for e, _ in events]
        self.assertEqual(names, ["starting", "stopped"])
        self.assertEqual(events[0][1]["mode"], "funded")
        self.assertEqual(events[0][1]["profile"], "zero master")
        # The firm-facing limits belong in the lifecycle payload for the app UI.
        self.assertEqual(events[0][1]["dailyLossPct"], 3.0)
        self.assertEqual(events[0][1]["maxLossPct"], 5.0)
        self.assertEqual(events[0][1]["maxLossMode"], "trailing_lock")

    # -- profile plumbing

    def test_run_receives_selected_profile(self):
        self._stub_modules()
        runner._run_funded(self._spec(), "inst_test01", self.tmp)
        kw = self.calls[0]
        self.assertEqual(kw["profile"].key, "zero")
        self.assertEqual(kw["profile"].phase, "master")
        self.assertEqual(kw["profile"].size, 100000.0)

    def test_credentials_come_from_env_only(self):
        self._stub_modules()
        import os
        os.environ["MT5_LOGIN"] = "1234567"
        os.environ["MT5_PASSWORD"] = "SecretPass!7"
        os.environ["MT5_SERVER"] = "Broker-Server"
        self.addCleanup(lambda: [os.environ.pop(k, None)
                                 for k in ("MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER")])

        runner._run_funded(self._spec(), "inst_test01", self.tmp)

        mt5_cfg = self.calls[0]["mt5_cfg"]
        self.assertEqual(mt5_cfg["login"], 1234567)
        self.assertEqual(mt5_cfg["server"], "Broker-Server")
        # Nothing credential-shaped may be written into the workspace.
        for path in self.tmp.rglob("*"):
            if path.is_file():
                blob = path.read_text(encoding="utf-8", errors="ignore")
                self.assertNotIn("SecretPass!7", blob, f"{path} leaked the password")

    def test_state_path_is_stable_per_profile(self):
        self._stub_modules()
        runner._run_funded(self._spec(), "inst_a", self.tmp)
        first = self.calls[0]["state_path"]
        runner._run_funded(self._spec(), "inst_b", self.tmp)
        second = self.calls[0]["state_path"]
        self.assertTrue(first.endswith("state_zero_master_100000.json"))
        self.assertEqual(first, second, "peak-equity state name must not vary per run")

    def test_magic_is_per_instance(self):
        self._stub_modules()
        runner._run_funded(self._spec(), "inst_a", self.tmp)
        runner._run_funded(self._spec(), "inst_b", self.tmp)
        first, second = self.calls[0]["magic"], self.calls[1]["magic"]
        self.assertIsNotNone(first)
        self.assertNotEqual(first, second, "two instances must not share a magic number")

    def test_dry_run_is_forwarded(self):
        self._stub_modules()
        runner._run_funded(self._spec(fundedDryRun=True), "inst_test01", self.tmp)
        self.assertTrue(self.calls[0]["dry_run"])

    # -- rejections

    def test_unknown_model_is_rejected(self):
        self._stub_modules()
        with self.assertRaises(ValueError):
            runner._run_funded(self._spec(fundedModel="ftmo"), "inst_test01", self.tmp)

    def test_phase_not_offered_by_model_is_rejected(self):
        self._stub_modules()
        with self.assertRaises(ValueError):
            # zero has no phase1
            runner._run_funded(self._spec(fundedPhase="phase1"), "inst_test01", self.tmp)

    def test_unsupported_size_is_rejected(self):
        self._stub_modules()
        with self.assertRaises(ValueError):
            # 1step_flex tops out at 100000
            runner._run_funded(
                self._spec(fundedModel="1step_flex", fundedPhase="master", fundedSize=250000),
                "inst_test01", self.tmp)

    def test_missing_model_is_rejected(self):
        self._stub_modules()
        with self.assertRaises(ValueError):
            runner._run_funded(self._spec(fundedModel=""), "inst_test01", self.tmp)

    def test_missing_size_is_rejected(self):
        self._stub_modules()
        with self.assertRaises(ValueError):
            runner._run_funded(self._spec(fundedSize=None), "inst_test01", self.tmp)

    def test_non_numeric_size_is_rejected(self):
        self._stub_modules()
        with self.assertRaises(ValueError):
            runner._run_funded(self._spec(fundedSize="100k"), "inst_test01", self.tmp)

    def test_unknown_settings_keys_are_dropped(self):
        self._stub_modules()
        runner._run_funded(
            self._spec(fundedGuard={"risk_per_trade_pct": 0.5, "evil": "x"},
                       fundedStrategy={"sl_atr": 2.0, "nope": 1}),
            "inst_test01", self.tmp)
        guard = self.calls[0]["gcfg"].__dict__
        strategy = self.calls[0]["sp"].__dict__
        self.assertEqual(guard["risk_per_trade_pct"], 0.5)
        self.assertNotIn("evil", guard)
        self.assertEqual(strategy["sl_atr"], 2.0)
        self.assertNotIn("nope", strategy)

    # -- news

    def test_news_uses_feed_when_no_calendar_file(self):
        self._stub_modules()
        runner._run_funded(self._spec(), "inst_test01", self.tmp)
        news = self.calls[0]["news_cfg"]
        self.assertEqual(news["calendar_file"], "")
        self.assertTrue(news["feed_url"].startswith("https://"))

    def test_news_uses_calendar_file_when_present(self):
        self._stub_modules()
        (self.tmp / "news_calendar.csv").write_text(
            "time_utc,currency,impact,title\n2026-01-01T12:00:00Z,EUR,High,ECB\n",
            encoding="utf-8")
        runner._run_funded(self._spec(), "inst_test01", self.tmp)
        news = self.calls[0]["news_cfg"]
        self.assertTrue(news["calendar_file"].endswith("news_calendar.csv"))

    def test_avoid_news_defaults_on(self):
        self._stub_modules()
        runner._run_funded(self._spec(), "inst_test01", self.tmp)
        self.assertTrue(self.calls[0]["news_always"])


if __name__ == "__main__":
    unittest.main()