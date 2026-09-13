"""
Double-entry ledger core.

Every movement of value is recorded as a `ledger_transaction` containing
two or more `ledger_entries` whose amounts sum to exactly zero. This is
non-negotiable: `post_transaction()` refuses to post anything that doesn't
balance, which makes it structurally impossible for a bug elsewhere in the
app to silently create or destroy money — the database itself rejects it.

A user's balance is never stored as a single mutable number; it's always
the SUM of their entries. This means the full history is auditable and a
balance can always be reconstructed/verified from first principles.

This module only manages the *internal ledger* — i.e. who the app's books
say owns what. It does not move real money or crypto. Actual settlement
happens through payment_provider.py (fiat) or custody_provider.py (crypto),
which call back into this ledger to record the result.
"""

from __future__ import annotations
from . import db


class LedgerError(Exception):
    pass


def get_or_create_account(user_id: str, asset: str, account_type: str = "user") -> dict:
    existing = db.query_one(
        "SELECT * FROM ledger_accounts WHERE user_id = ? AND asset = ? AND account_type = ?",
        (user_id, asset, account_type),
    )
    if existing:
        return existing
    acc_id = db.execute(
        "INSERT INTO ledger_accounts (user_id, asset, account_type) VALUES (?, ?, ?)",
        (user_id, asset, account_type),
    )
    return db.query_one("SELECT * FROM ledger_accounts WHERE id = ?", (acc_id,))


def get_balance(user_id: str, asset: str, account_type: str = "user") -> float:
    account = db.query_one(
        "SELECT * FROM ledger_accounts WHERE user_id = ? AND asset = ? AND account_type = ?",
        (user_id, asset, account_type),
    )
    if not account:
        return 0.0
    row = db.query_one(
        """SELECT COALESCE(SUM(le.amount), 0) as balance
           FROM ledger_entries le
           JOIN ledger_transactions lt ON lt.id = le.transaction_id
           WHERE le.account_id = ? AND lt.status = 'posted'""",
        (account["id"],),
    )
    return round(row["balance"], 10)


def post_transaction(
    tx_type: str,
    entries: list[tuple[int, float]],
    reference: str | None = None,
    memo: str = "",
) -> dict:
    """
    entries: list of (account_id, amount) pairs. amount > 0 credits the
    account (increases balance), amount < 0 debits it. Must sum to ~zero.

    Example — crediting a $500 deposit into a user's USD account, offset
    against the house's incoming-deposits clearing account:
        post_transaction(
            "deposit",
            [(user_usd_account_id, 500.0), (house_clearing_account_id, -500.0)],
            reference="stripe_pi_abc123",
        )
    """
    if len(entries) < 2:
        raise LedgerError("A transaction needs at least two entries (it must balance).")
    total = sum(amount for _, amount in entries)
    if abs(total) > 1e-8:
        raise LedgerError(f"Entries do not balance (sum={total}); refusing to post.")

    tx_id = db.execute(
        "INSERT INTO ledger_transactions (tx_type, reference, status, memo, posted_at) VALUES (?, ?, 'posted', ?, datetime('now'))",
        (tx_type, reference, memo),
    )
    for account_id, amount in entries:
        db.execute(
            "INSERT INTO ledger_entries (transaction_id, account_id, amount) VALUES (?, ?, ?)",
            (tx_id, account_id, amount),
        )
    return db.query_one("SELECT * FROM ledger_transactions WHERE id = ?", (tx_id,))


def get_transaction_history(user_id: str, asset: str | None = None, limit: int = 100) -> list[dict]:
    """All posted transactions touching any of this user's accounts."""
    if asset:
        accounts = db.query_all(
            "SELECT id FROM ledger_accounts WHERE user_id = ? AND asset = ?", (user_id, asset)
        )
    else:
        accounts = db.query_all("SELECT id FROM ledger_accounts WHERE user_id = ?", (user_id,))
    if not accounts:
        return []
    account_ids = [a["id"] for a in accounts]
    placeholders = ",".join("?" * len(account_ids))
    return db.query_all(
        f"""SELECT lt.*, le.account_id, le.amount
            FROM ledger_transactions lt
            JOIN ledger_entries le ON le.transaction_id = lt.id
            WHERE le.account_id IN ({placeholders}) AND lt.status = 'posted'
            ORDER BY lt.posted_at DESC LIMIT ?""",
        (*account_ids, limit),
    )


def verify_books_balance() -> dict:
    """
    Sanity check across the ENTIRE ledger (not just one user): every posted
    transaction's entries must sum to zero. Run this periodically (e.g. a
    nightly job) — if it ever reports unbalanced=True, stop the app and
    investigate immediately; it means a bug bypassed post_transaction()'s
    check, most likely via a direct DB write somewhere.
    """
    rows = db.query_all(
        """SELECT lt.id as tx_id, SUM(le.amount) as total
           FROM ledger_transactions lt
           JOIN ledger_entries le ON le.transaction_id = lt.id
           WHERE lt.status = 'posted'
           GROUP BY lt.id
           HAVING ABS(SUM(le.amount)) > 0.00000001"""
    )
    return {"unbalanced": len(rows) > 0, "unbalanced_transactions": rows}
