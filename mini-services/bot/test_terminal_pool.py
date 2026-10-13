"""
test_terminal_pool.py
---------------------
Tests for the multi-tenant terminal pool (terminal_pool.py).

One MT5 terminal is one session, so hosting many accounts means giving each
instance its own terminal slot. These tests pin the allocation rules:

  1. slots are discovered from the pool directory (sub-folders with a terminal exe)
  2. a disabled pool allocates nothing (fall back to the app-supplied path)
  3. allocation is stable per instance and never hands one slot to two instances
  4. a full pool returns None rather than silently sharing a terminal
  5. release returns a slot to the free set
  6. a missing state file cannot cause a double-allocation: existing instance
     specs are also treated as taken

Run: python -m unittest test_terminal_pool -v   (from mini-services/bot)
"""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

import settings  # noqa: E402
import terminal_pool  # noqa: E402


class TerminalPoolTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="toptier-pool-"))
        self._orig = (
            settings.DATA_DIR,
            settings.INSTANCES_DIR,
            settings.TERMINAL_POOL_DIR,
            settings.TERMINAL_POOL_ENABLED,
        )
        settings.DATA_DIR = self.tmp / "data"
        settings.INSTANCES_DIR = settings.DATA_DIR / "instances"
        settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
        settings.TERMINAL_POOL_DIR = str(self.tmp / "MT5")
        settings.TERMINAL_POOL_ENABLED = True
        self.pool = Path(settings.TERMINAL_POOL_DIR)

    def tearDown(self):
        (
            settings.DATA_DIR,
            settings.INSTANCES_DIR,
            settings.TERMINAL_POOL_DIR,
            settings.TERMINAL_POOL_ENABLED,
        ) = self._orig
        shutil.rmtree(self.tmp, ignore_errors=True)

    def make_slot(self, name: str, exe: str = "terminal64.exe") -> str:
        d = self.pool / name
        d.mkdir(parents=True, exist_ok=True)
        (d / exe).write_text("", encoding="utf-8")
        return str(d)

    def write_spec(self, instance_id: str, terminal_path: str) -> None:
        d = settings.INSTANCES_DIR / instance_id
        d.mkdir(parents=True, exist_ok=True)
        (d / "instance.json").write_text(
            json.dumps({"instanceId": instance_id, "terminalPath": terminal_path}),
            encoding="utf-8",
        )


class TestDiscovery(TerminalPoolTestBase):
    def test_disabled_when_no_directory(self):
        settings.TERMINAL_POOL_DIR = ""
        self.assertFalse(terminal_pool.is_enabled())
        self.assertEqual(terminal_pool.discover(), [])
        self.assertIsNone(terminal_pool.allocate("i1"))

    def test_disabled_flag_wins(self):
        self.make_slot("term01")
        settings.TERMINAL_POOL_ENABLED = False
        self.assertFalse(terminal_pool.is_enabled())
        self.assertIsNone(terminal_pool.allocate("i1"))

    def test_discovers_only_terminals(self):
        a = self.make_slot("term01")
        b = self.make_slot("term02", exe="terminal.exe")
        (self.pool / "notes").mkdir()  # no terminal exe -> ignored
        found = terminal_pool.discover()
        self.assertEqual(len(found), 2)
        self.assertIn(a, found)
        self.assertIn(b, found)

    def test_empty_pool_allocates_nothing(self):
        self.pool.mkdir(parents=True, exist_ok=True)
        self.assertEqual(terminal_pool.discover(), [])
        self.assertIsNone(terminal_pool.allocate("i1"))


class TestAllocation(TerminalPoolTestBase):
    def setUp(self):
        super().setUp()
        self.a = self.make_slot("term01")
        self.b = self.make_slot("term02")

    def test_assigns_distinct_slots(self):
        s1 = terminal_pool.allocate("i1")
        s2 = terminal_pool.allocate("i2")
        self.assertEqual({s1, s2}, {self.a, self.b})

    def test_allocation_is_stable(self):
        s1 = terminal_pool.allocate("i1")
        self.assertEqual(terminal_pool.allocate("i1"), s1)

    def test_full_pool_returns_none(self):
        self.assertIsNotNone(terminal_pool.allocate("i1"))
        self.assertIsNotNone(terminal_pool.allocate("i2"))
        self.assertIsNone(terminal_pool.allocate("i3"))

    def test_release_frees_the_slot(self):
        s1 = terminal_pool.allocate("i1")
        terminal_pool.allocate("i2")
        terminal_pool.release("i1")
        self.assertEqual(terminal_pool.allocate("i3"), s1)

    def test_summary_counts(self):
        terminal_pool.allocate("i1")
        s = terminal_pool.summary()
        self.assertTrue(s["enabled"])
        self.assertEqual(s["total"], 2)
        self.assertEqual(s["assigned"], 1)
        self.assertEqual(s["free"], 1)

    def test_specs_guard_against_double_allocation(self):
        # i1 holds term01 on disk, but the pool state file is absent (wiped).
        self.write_spec("i1", self.a)
        assigned = terminal_pool.allocate("i2")
        self.assertEqual(assigned, self.b)  # must not reuse i1's slot


if __name__ == "__main__":
    unittest.main(verbosity=2)
