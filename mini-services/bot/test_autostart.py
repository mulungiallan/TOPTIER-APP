import os
import sys
import unittest
from pathlib import Path
from unittest import mock

SERVICE_DIR = Path(__file__).resolve().parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

import server


class FakeInstance:
    def __init__(self, spec):
        self.spec = spec
        self.process = None


class TestAutostartGate(unittest.TestCase):
    def setUp(self):
        self._orig = os.environ.get("BOT_AUTOSTART")
        os.environ["BOT_AUTOSTART"] = "1"

    def tearDown(self):
        if self._orig is None:
            os.environ.pop("BOT_AUTOSTART", None)
        else:
            os.environ["BOT_AUTOSTART"] = self._orig

    def test_defaults_to_starting(self):
        self.assertTrue(server._autostart_enabled({"instanceId": "a"}))

    def test_per_instance_opt_out(self):
        self.assertFalse(server._autostart_enabled({"settings": {"autostart": False}}))
        self.assertTrue(server._autostart_enabled({"settings": {"autostart": True}}))

    def test_env_kill_switch(self):
        for value in ("0", "false", "FALSE", "no", "No"):
            with self.subTest(value=value):
                os.environ["BOT_AUTOSTART"] = value
                self.assertFalse(server._autostart_enabled({"instanceId": "a"}))

    def test_missing_settings_defaults_on(self):
        self.assertTrue(server._autostart_enabled({"settings": None}))


class TestAutostartInstances(unittest.TestCase):
    def test_starts_opted_in_and_skips_disabled(self):
        a, b, c = (
            FakeInstance({"instanceId": "a"}),
            FakeInstance({"instanceId": "b", "settings": {"autostart": False}}),
            FakeInstance({"instanceId": "c"}),
        )
        started = []
        with mock.patch.object(server.manager, "_instances", {"a": a, "b": b, "c": c}), mock.patch.object(
            server, "_spawn", side_effect=lambda i: started.append(i.spec["instanceId"])
        ):
            self.assertEqual(server.autostart_instances(), 2)
        self.assertEqual(sorted(started), ["a", "c"])

    def test_one_failure_does_not_block_the_others(self):
        a, b = FakeInstance({"instanceId": "a"}), FakeInstance({"instanceId": "b"})
        attempted = []

        def flaky(inst):
            attempted.append(inst.spec["instanceId"])
            if inst.spec["instanceId"] == "a":
                raise RuntimeError("boom")

        with mock.patch.object(server.manager, "_instances", {"a": a, "b": b}), mock.patch.object(
            server, "_spawn", side_effect=flaky
        ):
            self.assertEqual(server.autostart_instances(), 1)
        self.assertEqual(sorted(attempted), ["a", "b"])

    def test_no_instances_is_harmless(self):
        with mock.patch.object(server.manager, "_instances", {}), mock.patch.object(server, "_spawn") as spawn:
            self.assertEqual(server.autostart_instances(), 0)
            self.assertEqual(spawn.call_count, 0)

    def test_startup_hook_is_registered(self):
        self.assertIn("_on_startup", [f.__name__ for f in server.app.router.on_startup])


if __name__ == "__main__":
    unittest.main()
