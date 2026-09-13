"""
Crypto wallet, built on the double-entry ledger + a swappable custody
provider. Mirrors cash_wallet.py's pattern but with crypto-specific
semantics: users get a deposit address instead of linking a bank account,
and deposits are detected (via the provider, e.g. a webhook in production)
rather than pulled on request.

This module never generates or stores private keys — see
custody_provider.py's docstring for why that boundary is load-bearing.
"""

from __future__ import annotations
from . import ledger
from . import db
from . import custody_provider as cp

HOUSE_USER_ID = "house"


class WalletError(Exception):
    pass


def get_crypto_balance(user_id: str, asset: str) -> float:
    return ledger.get_balance(user_id, asset, "user")


def get_or_create_deposit_address(user_id: str, asset: str) -> dict:
    """
    Returns the user's existing deposit address for this asset, or asks the
    custody provider to generate one. Show this address in your app's UI
    for the user to send funds to.
    """
    existing = db.query_one(
        "SELECT * FROM crypto_deposit_addresses WHERE user_id = ? AND asset = ?", (user_id, asset)
    )
    if existing:
        return existing

    result = cp.default_provider.create_deposit_address(user_id, asset)
    db.execute(
        "INSERT INTO crypto_deposit_addresses (user_id, asset, address, provider_ref) VALUES (?, ?, ?, ?)",
        (user_id, asset, result["address"], result.get("provider_ref")),
    )
    return db.query_one(
        "SELECT * FROM crypto_deposit_addresses WHERE user_id = ? AND asset = ?", (user_id, asset)
    )


def credit_confirmed_deposit(user_id: str, asset: str, amount: float, onchain_tx_ref: str) -> dict:
    """
    Call this from your custody provider's deposit-confirmation webhook
    handler (NOT from user-facing code) once an incoming transaction has
    enough confirmations to be considered final. Credits the user's ledger
    balance for the confirmed amount.

    Idempotency matters here: webhooks can be delivered more than once.
    This checks whether onchain_tx_ref was already recorded and skips
    re-crediting if so.
    """
    if amount <= 0:
        raise WalletError("Deposit amount must be positive")

    already_processed = db.query_one(
        "SELECT * FROM ledger_transactions WHERE reference = ? AND tx_type = 'deposit'", (onchain_tx_ref,)
    )
    if already_processed:
        return {"status": "already_processed", "ledger_tx": already_processed}

    user_acc = ledger.get_or_create_account(user_id, asset, "user")
    house_acc = ledger.get_or_create_account(HOUSE_USER_ID, asset, "house")
    tx = ledger.post_transaction(
        "deposit",
        [(user_acc["id"], amount), (house_acc["id"], -amount)],
        reference=onchain_tx_ref,
        memo=f"On-chain deposit ({asset})",
    )
    return {"status": "completed", "ledger_tx": tx, "new_balance": get_crypto_balance(user_id, asset)}


def withdraw(user_id: str, asset: str, amount: float, destination_address: str) -> dict:
    """
    Debits the user's ledger balance and asks the custody provider to sign
    and broadcast the on-chain transaction. Always checks ledger balance
    first (never trust a client-supplied balance) — and in production, add
    address validation and a withdrawal review/limit policy before calling
    the provider, since on-chain sends are typically irreversible.
    """
    if amount <= 0:
        raise WalletError("Withdrawal amount must be positive")

    current_balance = get_crypto_balance(user_id, asset)
    if amount > current_balance:
        raise WalletError(f"Insufficient balance: have {current_balance}, requested {amount}")

    result = cp.default_provider.initiate_withdrawal(user_id, asset, amount, destination_address)
    if result["status"] not in ("confirmed", "pending", "broadcast"):
        return {"status": result["status"], "provider_tx_id": result.get("provider_tx_id"), "ledger_tx": None}

    user_acc = ledger.get_or_create_account(user_id, asset, "user")
    house_acc = ledger.get_or_create_account(HOUSE_USER_ID, asset, "house")
    tx = ledger.post_transaction(
        "withdrawal",
        [(user_acc["id"], -amount), (house_acc["id"], amount)],
        reference=result["provider_tx_id"],
        memo=f"Withdrawal to {destination_address}",
    )
    return {"status": "completed", "provider_tx_id": result["provider_tx_id"], "ledger_tx": tx,
            "new_balance": get_crypto_balance(user_id, asset)}


def get_transaction_history(user_id: str, asset: str, limit: int = 100) -> list[dict]:
    return ledger.get_transaction_history(user_id, asset, limit)
