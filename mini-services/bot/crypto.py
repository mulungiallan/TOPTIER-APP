"""
crypto.py
---------
Encrypts the broker password for an instance before it is written to
data/instances/<id>/instance.json.

Why this exists: the Next.js app already stores broker passwords encrypted
(AES-256-GCM, see src/lib/bot-crypto.ts), but the bot service used to keep a
plaintext copy in each instance.json and another plaintext copy in the
generated config.py. On a Windows box that also runs MT5 terminals, those files
sit next to live trading terminals.

Format: "enc:v1:<base64url(nonce+ciphertext+tag)>"
AES-256-GCM, key = SHA-256(BOT_CREDENTIALS_SECRET). The version tag lets us
change the scheme later and still recognise old blobs. Values without the tag
are treated as legacy plaintext (see instance_util.load_spec) so an existing
install keeps working and gets re-encrypted on the next save.

GCM is authenticated: a wrong key or a tampered file raises, it never returns
silent garbage to the trading engine.
"""

import base64
import hashlib
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import settings

PREFIX = "enc:v1:"
NONCE_BYTES = 12  # 96-bit nonce, the GCM standard


class CredentialSecretMissing(RuntimeError):
    """Raised instead of silently writing a plaintext password to disk."""


def _key() -> bytes:
    secret = (settings.BOT_CREDENTIALS_SECRET or "").strip()
    if not secret:
        raise CredentialSecretMissing(
            "BOT_CREDENTIALS_SECRET is not set, so the broker password cannot be "
            "encrypted. Refusing to write it to disk in plaintext. Set "
            "BOT_CREDENTIALS_SECRET in the bot service environment (it must be "
            "the same value the app uses, since it is what already encrypted the "
            "password in the database)."
        )
    return hashlib.sha256(secret.encode("utf-8")).digest()


def is_encrypted(value) -> bool:
    return isinstance(value, str) and value.startswith(PREFIX)


def encrypt(plaintext: str) -> str:
    """Encrypt a broker password. Empty stays empty (nothing to protect)."""
    if plaintext is None or plaintext == "":
        return ""
    nonce = os.urandom(NONCE_BYTES)
    blob = nonce + AESGCM(_key()).encrypt(nonce, plaintext.encode("utf-8"), None)
    return PREFIX + base64.urlsafe_b64encode(blob).decode("ascii")


def decrypt(value: str) -> str:
    """Decrypt a stored password. Passes legacy plaintext through unchanged."""
    if value is None or value == "":
        return ""
    if not is_encrypted(value):
        return value
    raw = base64.urlsafe_b64decode(value[len(PREFIX):].encode("ascii"))
    nonce, blob = raw[:NONCE_BYTES], raw[NONCE_BYTES:]
    try:
        return AESGCM(_key()).decrypt(nonce, blob, None).decode("utf-8")
    except InvalidTag as exc:
        raise RuntimeError(
            "Could not decrypt the stored broker password. BOT_CREDENTIALS_SECRET "
            "does not match the value this instance was written with. Restore the "
            "original secret or re-link the account from the app - do not guess."
        ) from exc