"""
Crypto custody provider abstraction.

CRITICAL: this app's codebase must never generate, store, or transmit raw
private keys. All real custody happens through a specialized provider —
Fireblocks, BitGo, Coinbase Custody/Prime, or Anchorage are the standard
choices — accessed through their API using MPC (multi-party computation)
or HSM-backed signing. Your database only tracks *which internal ledger
balance corresponds to which provider vault/sub-account*; the provider
holds the actual keys and does the actual signing.

Why this matters: a custodial wallet holding user crypto is one of the
highest-value targets there is, and "we stored keys encrypted in our own
database" is the postmortem line in nearly every major exchange hack.
Specialized custody providers exist specifically because getting this
right (key sharding, HSMs, withdrawal policies, insurance) is a dedicated
discipline, not a side feature.

`MockCustodyProvider` lets you build and test your app's flow today
without any real crypto or provider account. Before handling real crypto,
implement a real provider class against your chosen provider's actual API
in their sandbox/testnet environment.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
import uuid


class CustodyProvider(ABC):
    @abstractmethod
    def create_deposit_address(self, user_id: str, asset: str) -> dict:
        """Ask the provider to generate a deposit address for this user/asset."""

    @abstractmethod
    def get_address_balance(self, address: str, asset: str) -> float:
        """On-chain confirmed balance at an address (provider queries the chain)."""

    @abstractmethod
    def initiate_withdrawal(self, user_id: str, asset: str, amount: float, destination_address: str) -> dict:
        """Ask the provider to sign and broadcast an outgoing on-chain transaction."""

    @abstractmethod
    def get_transaction_status(self, provider_tx_id: str) -> dict:
        """Check confirmation status of a previously-initiated transaction."""


class MockCustodyProvider(CustodyProvider):
    """
    In-memory simulator for development — no real blockchain interaction.
    Deposit addresses are fake strings, balances are tracked in memory, and
    withdrawals 'confirm' instantly. Real providers involve confirmation
    delays (block confirmations), network fees, and can reject withdrawals
    (e.g. address validation failures, compliance holds) — don't assume
    production behaves this simply.
    """

    def __init__(self):
        self._addresses: dict[str, dict] = {}
        self._balances: dict[str, float] = {}
        self._transactions: dict[str, dict] = {}

    def create_deposit_address(self, user_id: str, asset: str) -> dict:
        fake_address = f"mock_{asset.lower()}_{uuid.uuid4().hex[:24]}"
        record = {"address": fake_address, "user_id": user_id, "asset": asset, "provider_ref": fake_address}
        self._addresses[fake_address] = record
        self._balances[fake_address] = 0.0
        return record

    def get_address_balance(self, address: str, asset: str) -> float:
        return self._balances.get(address, 0.0)

    def simulate_incoming_deposit(self, address: str, amount: float) -> None:
        """Test helper only: simulates an on-chain deposit arriving. Real
        providers notify you of this via a webhook, not a function you call."""
        self._balances[address] = self._balances.get(address, 0.0) + amount

    def initiate_withdrawal(self, user_id: str, asset: str, amount: float, destination_address: str) -> dict:
        tx_id = f"mock_tx_{uuid.uuid4().hex[:16]}"
        record = {
            "provider_tx_id": tx_id, "user_id": user_id, "asset": asset, "amount": amount,
            "destination_address": destination_address, "status": "confirmed", "confirmations": 6,
        }
        self._transactions[tx_id] = record
        return record

    def get_transaction_status(self, provider_tx_id: str) -> dict:
        return self._transactions.get(provider_tx_id, {"status": "not_found"})


# Swap this for a real provider instance once you've integrated one, e.g.:
#   from .providers.fireblocks_provider import FireblocksCustodyProvider
#   default_provider = FireblocksCustodyProvider(api_key=..., private_key_path=...)
default_provider: CustodyProvider = MockCustodyProvider()
