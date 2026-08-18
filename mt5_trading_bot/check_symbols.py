"""
check_symbols.py
-------------------
Quick diagnostic: run this on the same machine as your MT5 terminal to see
exactly which symbols from your bot's config actually resolve at your
broker, and what their real names/specs are. Run it standalone, separate
from main.py:

    python check_symbols.py

This does NOT place any trades -- it only reads symbol info.
"""

import MetaTrader5 as mt5
import config

if not mt5.initialize():
    print(f"Could not connect to MT5: {mt5.last_error()}")
    raise SystemExit(1)

if config.MT5_LOGIN:
    mt5.login(config.MT5_LOGIN, password=config.MT5_PASSWORD, server=config.MT5_SERVER)

account = mt5.account_info()
print(f"Connected. Account: {account.login}, Server: {account.server}, Balance: {account.balance} {account.currency}\n")

print(f"{'Your config name':<15} {'Resolves?':<10} {'Broker name':<15} {'Spread (pips)':<15}")
print("-" * 60)

resolved = []
unresolved = []

for symbol in config.SYMBOLS:
    info = mt5.symbol_info(symbol)
    if info is None:
        # try common suffix patterns automatically
        found_alt = None
        for suffix in [".a", "m", ".raw", "_raw", ".pro", "-ECN", ".std"]:
            alt = mt5.symbol_info(symbol + suffix)
            if alt is not None:
                found_alt = symbol + suffix
                break
        if found_alt:
            print(f"{symbol:<15} {'ALT FOUND':<10} {found_alt:<15} {'-':<15}")
            unresolved.append((symbol, found_alt))
        else:
            print(f"{symbol:<15} {'NO':<10} {'-':<15} {'-':<15}")
            unresolved.append((symbol, None))
        continue

    if not info.visible:
        mt5.symbol_select(symbol, True)
        info = mt5.symbol_info(symbol)

    pip = info.point * 10 if info.digits in (3, 5) else info.point
    spread_pips = (info.ask - info.bid) / pip if pip else float("inf")
    print(f"{symbol:<15} {'YES':<10} {symbol:<15} {spread_pips:<15.2f}")
    resolved.append(symbol)

print("\n" + "=" * 60)
print(f"Resolved cleanly: {len(resolved)} / {len(config.SYMBOLS)}")
if unresolved:
    print(f"\nNeed fixing in config.py SYMBOLS list:")
    for original, alt in unresolved:
        if alt:
            print(f"  '{original}'  ->  try '{alt}'")
        else:
            print(f"  '{original}'  ->  not found under any common suffix. Check Market Watch 'Show All' manually.")

mt5.shutdown()
