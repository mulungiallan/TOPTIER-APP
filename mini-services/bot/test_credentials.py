"""
test_credentials.py
------------------
Regression tests for broker-credential handling in the bot service.

The service runs on the same Windows box as live MT5 terminals, so a plaintext
broker password in data/instances/<id>/instance.json or in the generated
config.py is a real exposure, not a theoretical one. These tests assert:

  1. a saved password is encrypted at rest and decrypts back to the original
  2. an unchanged secret round-trips; a different secret fails loudly
  3. a legacy plaintext instance.json still loads (so existing installs work)
     and is re-encrypted on the next save
  4. neither instance.json nor the generated config.py contains the secret
  5. the service key is never persisted
  6. a missing BOT_CREDENTIALS_SECRET raises instead of writing plaintext

Run: python -m unittest test_credentials -v   (from mini-services/bot)
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

SECRET = "test-credentials-secret-do-not-use"
PASSWORD = "Br0kerPassw0rd!42"

import crypto  # noqa: E402
import instance_util  # noqa: E402
import settings  # noqa: E402

# crypto/settings read these at call time, so overriding here is enough.
settings.BOT_CREDENTIALS_SECRET = SECRET
crypto.settings.BOT_CREDENTIALS_SECRET = SECRET

ENGINE_CONFIG = "MT5_PASSWORD = os.environ.get(\"MT5_PASSWORD\", \"\")\n"


class CredentialTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="toptier-cred-"))
        self._orig_instances = settings.INSTANCES_DIR
        self._orig_engine = settings.ENGINE_DIR
        settings.INSTANCES_DIR = self.tmp / "instances"
        settings.ENGINE_DIR = self.tmp / "engine"
        settings.ENGINE_DIR.mkdir(parents=True, exist_ok=True)
        (settings.ENGINE_DIR / "config.py").write_text(
            "import os\n" + ENGINE_CONFIG, encoding="utf-8"
        )
        self.spec = {
            "instanceId": "inst_test1",
            "platform": "mt5",
            "login": "12345678",
            "password": PASSWORD,
            "server": "ICMarketsSC-Demo",
            "terminalPath": r"C:\Program Files\MetaTrader 5\terminal64.exe",
            "webhookUrl": "https://example.test/api/bot/webhook",
            "settings": {"MAX_OPEN_POSITIONS": 3},
        }

    def tearDown(self):
        settings.INSTANCES_DIR = self._orig_instances
        settings.ENGINE_DIR = self._orig_engine
        crypto.settings.BOT_CREDENTIALS_SECRET = SECRET
        settings.BOT_CREDENTIALS_SECRET = SECRET
        shutil.rmtree(self.tmp, ignore_errors=True)

    def spec_file(self, instance_id="inst_test1"):
        return self.tmp / "instances" / instance_id / "instance.json"


class TestEncryptDecrypt(CredentialTestBase):
    def test_round_trip(self):
        blob = crypto.encrypt(PASSWORD)
        self.assertTrue(crypto.is_encrypted(blob))
        self.assertNotIn(PASSWORD, blob)
        self.assertEqual(crypto.decrypt(blob), PASSWORD)

    def test_empty_password_stays_empty(self):
        # GUI-attach mode sends no password; it must not invent one.
        self.assertEqual(crypto.encrypt(""), "")
        self.assertEqual(crypto.encrypt(None), "")

    def test_ciphertext_differs_each_time(self):
        # A fresh nonce per call, so two instances sharing a password do not
        # produce identical files.
        self.assertNotEqual(crypto.encrypt(PASSWORD), crypto.encrypt(PASSWORD))

    def test_wrong_secret_raises(self):
        blob = crypto.encrypt(PASSWORD)
        crypto.settings.BOT_CREDENTIALS_SECRET = "a-different-secret"
        with self.assertRaises(RuntimeError):
            crypto.decrypt(blob)

    def test_tampered_blob_raises(self):
        blob = crypto.encrypt(PASSWORD)
        tampered = blob[:-4] + ("AAAA" if not blob.endswith("AAAA") else "BBBB")
        with self.assertRaises(Exception):
            crypto.decrypt(tampered)

    def test_missing_secret_refuses_to_encrypt(self):
        crypto.settings.BOT_CREDENTIALS_SECRET = ""
        with self.assertRaises(crypto.CredentialSecretMissing):
            crypto.encrypt(PASSWORD)


class TestSpecAtRest(CredentialTestBase):
    def test_password_encrypted_on_disk(self):
        instance_util.save_spec(self.spec)
        raw = self.spec_file().read_text(encoding="utf-8")
        self.assertNotIn(PASSWORD, raw, "broker password must not be in instance.json")
        stored = json.loads(raw)
        self.assertTrue(crypto.is_encrypted(stored["password"]))

    def test_load_returns_plaintext_in_memory(self):
        instance_util.save_spec(self.spec)
        loaded = instance_util.load_spec("inst_test1")
        self.assertEqual(loaded["password"], PASSWORD)
        self.assertEqual(loaded["login"], "12345678")

    def test_service_key_not_persisted(self):
        self.spec["serviceKey"] = "the-service-key"
        instance_util.save_spec(self.spec)
        raw = self.spec_file().read_text(encoding="utf-8")
        self.assertNotIn("the-service-key", raw)
        self.assertNotIn("serviceKey", json.loads(raw))

    def test_legacy_plaintext_spec_loads_and_is_reencrypted(self):
        """An instance.json written before encryption must keep working, and
        get upgraded the next time it is saved."""
        legacy = dict(self.spec)  # plaintext password, as old installs had
        p = self.spec_file()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(legacy, indent=2), encoding="utf-8")

        loaded = instance_util.load_spec("inst_test1")
        self.assertEqual(loaded["password"], PASSWORD)

        instance_util.save_spec(loaded)
        raw = p.read_text(encoding="utf-8")
        self.assertNotIn(PASSWORD, raw, "legacy password must be re-encrypted on save")
        self.assertTrue(crypto.is_encrypted(json.loads(raw)["password"]))

    def test_missing_spec_returns_none(self):
        self.assertIsNone(instance_util.load_spec("does_not_exist"))


class TestGeneratedConfigHasNoSecrets(CredentialTestBase):
    def _write(self):
        instance_util.save_spec(self.spec)
        loaded = instance_util.load_spec("inst_test1")
        cfg = self.tmp / "instances" / "inst_test1" / "config.py"
        instance_util.write_config(loaded, cfg)
        return cfg

    def test_config_contains_no_password_literal(self):
        text = self._write().read_text(encoding="utf-8")
        self.assertNotIn(PASSWORD, text, "generated config.py must not embed the password")

    def test_config_reads_credentials_from_env(self):
        text = self._write().read_text(encoding="utf-8")
        self.assertIn('os.environ.get("MT5_PASSWORD"', text)
        # The generated block must not redefine the credential constants.
        self.assertNotIn("MT5_PASSWORD = '", text)
        self.assertNotIn("MT5_LOGIN = '", text)

    def test_config_still_sets_instance_specific_values(self):
        text = self._write().read_text(encoding="utf-8")
        self.assertIn("inst_test1", text)
        self.assertIn("MAX_OPEN_POSITIONS = 3", text)
        # The broker server name is a credential input too - it comes from the
        # environment now, so it must not be written into the file either.
        self.assertNotIn("ICMarketsSC-Demo", text)

    def test_config_is_valid_python_and_uses_env(self):
        cfg = self._write()
        text = cfg.read_text(encoding="utf-8")
        compile(text, str(cfg), "exec")  # raises on syntax error
        os.environ["MT5_PASSWORD"] = PASSWORD
        try:
            namespace: dict = {}
            exec(compile(text, str(cfg), "exec"), namespace)
            self.assertEqual(namespace["MT5_PASSWORD"], PASSWORD)
        finally:
            os.environ.pop("MT5_PASSWORD", None)

    def test_settings_blob_cannot_override_credentials(self):
        """A user-supplied settings entry must never reach a credential name."""
        self.spec["settings"] = {"MT5_PASSWORD": "'owned'"}
        text = self._write().read_text(encoding="utf-8")
        self.assertNotIn("MT5_PASSWORD = 'owned'", text)
        self.assertNotIn(PASSWORD, text)


if __name__ == "__main__":
    unittest.main(verbosity=2)