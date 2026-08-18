"""
list_all_symbols.py
----------------------
Lists every symbol your broker actually offers (regardless of Market
Watch visibility), and fuzzy-matches them against config.SYMBOLS so you
can see the real names for anything that failed in check_symbols.py.
Read-only, places no trades.

Run:
    python list_all_symbols.py
"""

import MetaTrader5 as mt5
import config

if not mt5.initialize():
    print(f"Could not connect to MT5: {mt5.last_error()}")
    raise SystemExit(1)

if config.MT5_LOGIN:
    mt5.login(config.MT5_LOGIN, password=config.MT5_PASSWORD, server=config.MT5_SERVER)

account = mt5.account_info()
print(f"Connected. Account: {account.login}, Server: {account.server}\n")

all_symbols = mt5.symbols_get()
if all_symbols is None:
    print("symbols_get() returned nothing -- connection issue.")
    raise SystemExit(1)

all_names = [s.name for s in all_symbols]
print(f"Broker offers {len(all_names)} total symbols.\n")

print("=" * 60)
print("MATCHING YOUR CONFIG'S SYMBOLS AGAINST WHAT'S ACTUALLY OFFERED")
print("=" * 60)

for wanted in config.SYMBOLS:
    # exact match first
    if wanted in all_names:
        print(f"{wanted:<12} -> EXACT MATCH: {wanted}")
        continue

    # fuzzy: does the broker's name START WITH our 6-letter pair (covers suffixes)?
    matches = [n for n in all_names if n.upper().startswith(wanted.upper())]
    if matches:
        print(f"{wanted:<12} -> POSSIBLE MATCH(ES): {matches}")
    else:
        print(f"{wanted:<12} -> NOT OFFERED by this broker at all (on this account type)")

print("\n" + "=" * 60)
print("FULL LIST OF EVERYTHING THIS BROKER OFFERS (first 100):")
print("=" * 60)
for name in sorted(all_names)[:100]:
    print(f"  {name}")
if len(all_names) > 100:
    print(f"  ... and {len(all_names) - 100} more")

mt5.shutdown()
