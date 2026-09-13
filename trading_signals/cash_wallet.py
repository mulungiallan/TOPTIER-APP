"""
Cash (fiat) wallet, built on the double-entry ledger + a swappable
payment provider. This module never moves money itself — it calls
payment_provider.default_provider to actually pull/push funds, then
records the outcome as a balanced ledger transaction.

House accounting: a single 'house' clearing account per currency absorbs
the other side of every user deposit/withdrawal, so the ledger always
balances even though money is really moving in/out of the platform's
external bank account (managed by your payment processor).
"""

from __future__ import annotations
from . import ledger
from . import payment_provider as pp

HOUSE_USER_ID = "house"


class WalletError(Exception):
    pass


def get_cash_balance(user_id: str, currency: str = "USD") -> float:
    return ledger.get_balance(user_id, currency, "user")


def deposit(user_id: str, amount: float, currency: str = "USD", source_ref: str = "") -> dict:
    """
    Initiates a real-world funds pull via the payment provider (e.g. ACH
    from the user's linked bank account), then credits the user's ledger
    balance once the provider reports success.

    NOTE: real processors are asynchronous — a deposit can take 1-5
    business days and can later fail (e.g. ACH return for insufficient
    funds). This mock provider completes instantly; don't assume production
    behaves the same way. For a real integration, only credit the ledger
    once you've received a confirmed webhook from the processor, not
    immediately after calling initiate_deposit().
    """
    if amount <= 0:
        raise WalletError("Deposit amount must be positive")

    result = pp.default_provider.initiate_deposit(user_id, amount, currency, source_ref)
    if result["status"] != "completed":
        return {"status": result["status"], "provider_tx_id": result["provider_tx_id"], "ledger_tx": None}

    user_acc = ledger.get_or_create_account(user_id, currency, "user")
    house_acc = ledger.get_or_create_account(HOUSE_USER_ID, currency, "house")
    tx = ledger.post_transaction(
        "deposit",
        [(user_acc["id"], amount), (house_acc["id"], -amount)],
        reference=result["provider_tx_id"],
        memo=f"Deposit via {source_ref}",
    )
    return {"status": "completed", "provider_tx_id": result["provider_tx_id"], "ledger_tx": tx,
            "new_balance": get_cash_balance(user_id, currency)}


def withdraw(user_id: str, amount: float, currency: str = "USD", destination_ref: str = "") -> dict:
    """
    Withdraws from the user's ledger balance and initiates a real-world
    payout via the payment provider. Checks sufficient balance first —
    always verify funds in the ledger, never trust a client-supplied balance.
    """
    if amount <= 0:
        raise WalletError("Withdrawal amount must be positive")

    current_balance = get_cash_balance(user_id, currency)
    if amount > current_balance:
        raise WalletError(f"Insufficient balance: have {current_balance}, requested {amount}")

    result = pp.default_provider.initiate_withdrawal(user_id, amount, currency, destination_ref)
    if result["status"] != "completed":
        return {"status": result["status"], "provider_tx_id": result["provider_tx_id"], "ledger_tx": None}

    user_acc = ledger.get_or_create_account(user_id, currency, "user")
    house_acc = ledger.get_or_create_account(HOUSE_USER_ID, currency, "house")
    tx = ledger.post_transaction(
        "withdrawal",
        [(user_acc["id"], -amount), (house_acc["id"], amount)],
        reference=result["provider_tx_id"],
        memo=f"Withdrawal to {destination_ref}",
    )
    return {"status": "completed", "provider_tx_id": result["provider_tx_id"], "ledger_tx": tx,
            "new_balance": get_cash_balance(user_id, currency)}


def transfer_for_trade(user_id: str, amount: float, currency: str, order_ref: str, memo: str = "") -> dict:
    """
    Internal ledger movement for a trade settlement (e.g. debiting cash
    when a buy order fills). No payment provider involved — this is money
    moving between the user's cash sub-ledger and a house trading/clearing
    account, not leaving the platform.
    """
    current_balance = get_cash_balance(user_id, currency)
    if amount > 0 and amount > current_balance:
        raise WalletError(f"Insufficient balance for trade settlement: have {current_balance}, need {amount}")

    user_acc = ledger.get_or_create_account(user_id, currency, "user")
    house_acc = ledger.get_or_create_account(HOUSE_USER_ID, currency, "house")
    tx = ledger.post_transaction(
        "trade_settlement",
        [(user_acc["id"], -amount), (house_acc["id"], amount)],
        reference=order_ref,
        memo=memo,
    )
    return {"ledger_tx": tx, "new_balance": get_cash_balance(user_id, currency)}


def get_transaction_history(user_id: str, currency: str = "USD", limit: int = 100) -> list[dict]:
    return ledger.get_transaction_history(user_id, currency, limit)
