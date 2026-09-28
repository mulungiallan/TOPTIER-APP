import importlib
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

BOT_DIR = Path(__file__).resolve().parent
if str(BOT_DIR) not in sys.path:
    sys.path.insert(0, str(BOT_DIR))

import config
import trade_frequency as tf


def _at_hour(hour: int):
    """Patch datetime so the module sees `now` pinned to a given UTC hour."""
    real_now = datetime.now(timezone.utc)

    class _PinnedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            base = real_now.replace(hour=hour, minute=30, second=0, microsecond=0)
            return base if tz else base.replace(tzinfo=None)

    return mock.patch.object(tf, "datetime", _PinnedDatetime)


class TestTradeFrequencyConfig(unittest.TestCase):
    def test_relaxation_is_not_dead_code(self):
        # A floor equal to the base vote count allowed zero relaxation, so the
        # "widen the net when behind pace" logic could never fire.
        self.assertTrue(config.USE_TRADE_FREQUENCY_TARGET)
        self.assertLess(config.RELAXATION_FLOOR_MIN_VOTES, config.MIN_VOTES_TO_TRADE)
        self.assertGreater(config.MIN_VOTES_TO_TRADE - config.RELAXATION_FLOOR_MIN_VOTES, 0)

    def test_pace_window_covers_the_whole_day(self):
        # A 12h window meant relaxation was impossible after 12:00 UTC, i.e.
        # never during the London/NY session.
        self.assertGreaterEqual(config.TRADE_TARGET_WINDOW_HOURS, 24)

    def test_max_open_positions(self):
        self.assertEqual(config.MAX_OPEN_POSITIONS, 3)


class TestRelaxation(unittest.TestCase):
    def setUp(self):
        self._orig_level = tf._relaxation_level
        self._orig_day = tf._day_start

    def tearDown(self):
        tf._relaxation_level = self._orig_level
        tf._day_start = self._orig_day

    def _drive(self, trades_today: int, hour: int, passes: int = 1):
        tf._relaxation_level = 0
        tf._day_start = None
        with mock.patch.object(tf, "_count_trades_today", return_value=trades_today), _at_hour(hour):
            for _ in range(passes):
                tf.update_relaxation_level()
            return tf._relaxation_level, tf.get_effective_min_votes()

    def test_starts_strict(self):
        tf._relaxation_level = 0
        self.assertEqual(tf.get_effective_min_votes(), config.MIN_VOTES_TO_TRADE)

    def test_relaxes_when_behind_pace_at_any_hour(self):
        for hour in (2, 9, 14, 18, 21):
            with self.subTest(hour=hour):
                level, votes = self._drive(0, hour)
                self.assertEqual(level, 1)
                self.assertEqual(votes, 2)

    def test_stays_strict_when_on_pace(self):
        level, votes = self._drive(40, 18)
        self.assertEqual(level, 0)
        self.assertEqual(votes, config.MIN_VOTES_TO_TRADE)

    def test_never_goes_below_the_floor(self):
        _, votes = self._drive(0, 23, passes=20)
        self.assertEqual(votes, config.RELAXATION_FLOOR_MIN_VOTES)
        self.assertGreaterEqual(votes, 1)

    def test_tightens_again_when_catching_up(self):
        tf._relaxation_level = 1
        tf._day_start = None
        with mock.patch.object(tf, "_count_trades_today", return_value=999), _at_hour(18):
            tf.update_relaxation_level()
        self.assertEqual(tf._relaxation_level, 0)
        self.assertEqual(tf.get_effective_min_votes(), config.MIN_VOTES_TO_TRADE)

    def test_status_reports_live_settings(self):
        status = tf.get_status()
        self.assertEqual(status["target"], config.DAILY_TRADE_TARGET)
        self.assertIn(status["effective_min_votes"], (2, 3))


if __name__ == "__main__":
    unittest.main()
