# Funded-account bot (FundingPips)

Rules-first MT5 bot for funded / prop accounts. This module is **completely separate** from the
standard `mt5_trading_bot` engine and must never share position sizing with it.

The standard engine sizes lots off equity (`per_100 * equity / 100`), which is wrong for a funded
account: on a $100,000 account that is roughly 80 lots of EURUSD. This module never uses that
formula. It sizes from a fixed **risk percentage of the profile's account size**, and a rules
guard runs on every loop iteration and flattens before any hard breach.

## Read this first
* Nothing here guarantees profit or "no losses". The job of the guard is to keep losses small when
  the strategy loses — which it will, often.
* `strategy.py` is a plain trend-pullback system with **no proven edge**. Run `backtest.py` on real
  M15 data per symbol, then forward-test on a demo account for weeks.
* Check your prop firm's Terms & Conditions before running a bot against a funded account. Some
  firms terminate accounts for automated trading. This is not stated in the rules these profiles
  were built from.
* Stop-losses can slip on gaps, spikes and thin liquidity. A stop is not a guarantee. Soft limits
  leave a large buffer but cannot make a breach impossible.

## Modes

A user links one account in one of two modes:

| Mode | Engine | Sizing |
|---|---|---|
| `standard` | `mt5_trading_bot` (multi-strategy voting) | retail equity-scaled lots |
| `funded` | this module | fixed % of profile size, rules-guarded |

## Models and phases

| Model | Phases | Daily loss | Max loss |
|---|---|---|---|
| `zero` | master | 3% | 5% trailing, locks at +5% |
| `1step_flex` | phase1, master | 3% | 12% static |
| `2step_standard` | phase1, phase2, master | 3% | 10% static |
| `2step_flex` | phase1, phase2, master | 4% | 12% static |
| `2step_pro` | phase1, phase2, master | 3% | 6% static |

`profiles.py` carries a `notes` tuple for every limit that the source rules did not actually
state. The bot logs each note as a `VERIFY:` warning at startup. Do not delete those notes.

## What the guard enforces

| Rule | Behaviour |
|---|---|
| Daily loss | Baseline of max(open balance, open equity), resets 00:00 UTC+3; flattens and stops at **50%** of limit |
| Max/trailing loss | Trailing floor for `zero` (locks at +5%), static floor for others; halts at 50% of the gap |
| Open risk | Floating-loser cap; flattens at **0.7%**; startup validates risk x positions fits |
| Per-trade | Default 0.25% of size, one position per pair, 30-min per-pair cooldown |
| News/speeches | Blocks entries ahead of the window, closes positions before it, **fails closed** if no calendar |
| Weekend | Flat by 19:30 UTC daily / 18:30 Friday; no overnight holds on master/zero |
| Profitable days | Zero requires 7 days of 0.25%+ per 30 days; daily profit stop banks 0.6% days |
| Inactivity | Trades most days, warns as 30 days approaches |
| Eval target | Stops trading once the target is reached and flat |

## Credentials

Credentials are read from the **environment**, never from a file:

```
MT5_LOGIN       account number; when unset the broker attaches to the already-logged-in terminal
MT5_PASSWORD    account password
MT5_SERVER      broker server name
MT5_PATH        optional explicit terminal64.exe path
MT5_SYMBOL_SUFFIX   optional, e.g. a broker suffix
MT5_UTC_OFFSET      server UTC offset in hours, default 3.0
```

`mt5_cfg_from_env()` builds the broker config in memory. `config.example.json` carries empty
credential fields and exists only for tuning `guard` / `strategy` / `news` settings. The service
writes those tuning settings into `instance.json`, not a credential file.

## Entry point for the service

`run_funded_bot()` takes explicit keyword arguments and never reads `argv` or `config.json`:

```python
from bot import run_funded_bot, mt5_cfg_from_env
from profiles import build_profile

profile = build_profile("zero", "master", 100000)
out = run_funded_bot(
    profile=profile,
    gcfg=GuardConfig(risk_per_trade_pct=0.25, max_positions=2),
    sp=StrategyParams(),
    symbols=["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"],
    news_cfg={...},
    state_path=".../state_zero_master_100000.json",
    mt5_cfg=mt5_cfg_from_env(),
    log_path=".../funded.log",
)
```

`state_*.json` holds the peak equity behind the trailing floor. Do not delete it. If the guard
halts itself, it stays halted across restarts until a human clears `manual_halt`.

## Standalone CLI (development only)

```
pip install -r requirements.txt
copy config.example.json config.json
python -m pytest -q                                   # 19 rule tests
python smoke_check.py                                # end-to-end loop against a fake MT5
python backtest.py --mt5 EURUSD --bars 60000 --risk 0.25
python bot.py --model zero --phase master --size 100000 --check
python bot.py --model zero --phase master --size 100000 --dry-run     # signals only
python bot.py --model zero --phase master --size 100000               # live
```