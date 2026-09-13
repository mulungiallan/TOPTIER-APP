"""
Payment provider abstraction.

This is where REAL fiat money actually moves — via a licensed, regulated
payment processor (Stripe, Plaid + a bank partner, Dwolla, etc.). This
module never touches money itself; it only calls out to whichever
processor you integrate and reports back what happened, so cash_wallet.py
can record it in the ledger.

`MockPaymentProvider` is provided so you can build and test your app's
flow today. Before handling real money, implement a real provider class
(e.g. StripePaymentProvider) against your chosen processor's actual API
and their sandbox/test-mode environment — and confirm with them (or a
fintech lawyer) whether your setup needs its own money transmitter
license on top of what they provide.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
import uuid


class PaymentProvider(ABC):
    @abstractmethod
    def initiate_deposit(self, user_id: str, amount: float, currency: str, source_ref: str) -> dict:
        """Start pulling `amount` from the user's external funding source (bank/card)."""

    @abstractmethod
    def initiate_withdrawal(self, user_id: str, amount: float, currency: str, destination_ref: str) -> dict:
        """Start sending `amount` out to the user's external bank account."""

    @abstractmethod
    def get_status(self, provider_tx_id: str) -> dict:
        """Check a previously-initiated transfer's current status."""


class MockPaymentProvider(PaymentProvider):
    """
    In-memory simulator for development. Deposits/withdrawals 'settle'
    immediately as 'completed' — real processors take hours/days and can
    fail (insufficient funds, closed account, etc.), so don't assume
    synchronous success once you swap this out.
    """

    def __init__(self):
        self._transfers: dict[str, dict] = {}

    def initiate_deposit(self, user_id: str, amount: float, currency: str, source_ref: str) -> dict:
        tx_id = f"mock_dep_{uuid.uuid4().hex[:12]}"
        record = {
            "provider_tx_id": tx_id, "type": "deposit", "user_id": user_id,
            "amount": amount, "currency": currency, "source_ref": source_ref, "status": "completed",
        }
        self._transfers[tx_id] = record
        return record

    def initiate_withdrawal(self, user_id: str, amount: float, currency: str, destination_ref: str) -> dict:
        tx_id = f"mock_wd_{uuid.uuid4().hex[:12]}"
        record = {
            "provider_tx_id": tx_id, "type": "withdrawal", "user_id": user_id,
            "amount": amount, "currency": currency, "destination_ref": destination_ref, "status": "completed",
        }
        self._transfers[tx_id] = record
        return record

    def get_status(self, provider_tx_id: str) -> dict:
        return self._transfers.get(provider_tx_id, {"status": "not_found"})


# Swap this for a real provider instance once you've integrated one, e.g.:
#   from .providers.stripe_provider import StripePaymentProvider
#   default_provider = StripePaymentProvider(api_key=os.environ["STRIPE_API_KEY"])
default_provider: PaymentProvider = MockPaymentProvider()
