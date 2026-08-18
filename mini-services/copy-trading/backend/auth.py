"""API keys are stored as SHA-256 hashes, never in plaintext, so a database
leak doesn't hand out live credentials. The plaintext key is shown to the
admin/subscriber exactly once, at creation time, and never stored again."""

import hashlib


def hash_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()
