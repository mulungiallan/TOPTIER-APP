import json
import sys
import unittest
from pathlib import Path
from unittest import mock

BOT_DIR = Path(__file__).resolve().parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

import backtest_filter as bf
import config

FAKE_RESULTS = {
    ("EURUSD.m", "M15"): {
        "ema_cross": {"trade_count": 40, "win_rate_pct": 44.0, "profit_factor": 1.7},
        "rsi_reversion": {"trade_count": 12, "win_rate_pct": 33.0, "profit_factor": 0.9},
    }
}


class TestBacktestCache(unittest.TestCase):
    def setUp(self):
        self.path = bf._BACKTEST_CACHE_PATH
        self._orig_existed = self.path.exists()
        self._orig_contents = self.path.read_text(encoding="utf-8") if self._orig_existed else None
        self._orig_max_age = config.BACKTEST_CACHE_MAX_AGE_HOURS
        if self.path.exists():
            self.path.unlink()
        self.env = mock.patch.dict("os.environ", {}, clear=False)
        self.env.start()
        import os

        os.environ.pop("BOT_SKIP_BACKTEST_CACHE", None)
        config.BACKTEST_CACHE_MAX_AGE_HOURS = 12

    def tearDown(self):
        self.env.stop()
        config.BACKTEST_CACHE_MAX_AGE_HOURS = self._orig_max_age
        if self._orig_existed:
            self.path.write_text(self._orig_contents, encoding="utf-8")
        elif self.path.exists():
            self.path.unlink()

    def _write(self, stamp_overrides=None, combos=None):
        payload = {
            "stamp": {
                "fingerprint": bf._cache_fingerprint(),
                "saved_at": __import__("time").time(),
                "max_age_hours": 12,
                **(stamp_overrides or {}),
            },
            "combos": combos if combos is not None else {"EURUSD.m|M15": FAKE_RESULTS[("EURUSD.m", "M15")]},
        }
        self.path.write_text(json.dumps(payload), encoding="utf-8")

    def test_missing_cache_forces_fresh_run(self):
        self.assertIsNone(bf.load_cached_combo_results())

    def test_round_trip_preserves_combo_keys(self):
        bf.save_cached_combo_results(FAKE_RESULTS)
        loaded = bf.load_cached_combo_results()
        self.assertIsNotNone(loaded)
        self.assertIn(("EURUSD.m", "M15"), loaded)
        self.assertEqual(loaded[("EURUSD.m", "M15")]["ema_cross"]["profit_factor"], 1.7)

    def test_expired_cache_is_rejected(self):
        import time

        self._write(stamp_overrides={"saved_at": time.time() - 20 * 3600})
        self.assertIsNone(bf.load_cached_combo_results())

    def test_fresh_cache_is_accepted(self):
        import time

        self._write(stamp_overrides={"saved_at": time.time() - 3600})
        self.assertIsNotNone(bf.load_cached_combo_results())

    def test_zero_max_age_disables_reuse(self):
        bf.save_cached_combo_results(FAKE_RESULTS)
        config.BACKTEST_CACHE_MAX_AGE_HOURS = 0
        self.assertIsNone(bf.load_cached_combo_results())

    def test_config_change_invalidates_cache(self):
        self._write()
        self.assertIsNotNone(bf.load_cached_combo_results())
        original = config.BACKTEST_BARS
        try:
            config.BACKTEST_BARS = (original or 1000) + 250
            self.assertIsNone(bf.load_cached_combo_results())
        finally:
            config.BACKTEST_BARS = original

    def test_strategy_set_change_invalidates_cache(self):
        payload = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else None
        self._write()
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        raw["stamp"]["fingerprint"] = json.dumps({"strategies": ["something_else"]})
        self.path.write_text(json.dumps(raw), encoding="utf-8")
        self.assertIsNone(bf.load_cached_combo_results())

    def test_env_bypass_forces_fresh_run(self):
        import os

        bf.save_cached_combo_results(FAKE_RESULTS)
        os.environ["BOT_SKIP_BACKTEST_CACHE"] = "1"
        self.assertIsNone(bf.load_cached_combo_results())
        os.environ.pop("BOT_SKIP_BACKTEST_CACHE", None)
        self.assertIsNotNone(bf.load_cached_combo_results())

    def test_corrupt_cache_does_not_raise(self):
        self.path.write_text("{not json", encoding="utf-8")
        self.assertIsNone(bf.load_cached_combo_results())

    def test_empty_combos_rejected(self):
        self._write(combos={})
        self.assertIsNone(bf.load_cached_combo_results())

    def test_approved_gate_still_applies_to_cached_results(self):
        # Reusing stats must not bypass the win-rate / profit-factor gate.
        approved = bf.approved_strategies_for(FAKE_RESULTS)
        self.assertEqual(approved[("EURUSD.m", "M15")], ["ema_cross"])


if __name__ == "__main__":
    unittest.main()
