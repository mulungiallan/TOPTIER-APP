# MT5 Multi-Strategy Forex Bot

A live-trading bot for MetaTrader 5 that combines four strategies —
trend following, momentum, mean reversion, and swing trading — across
the M15, M30, H1, and H4 timeframes, using a voting system. Before it
ever risks real money, it backtests every strategy on every symbol/
timeframe combo and only allows combos with a demonstrated historical
edge to trade live. Built-in risk management handles position sizing,
stop-loss/take-profit at a 1:3 reward:risk ratio, and a max daily loss
kill switch. When it places a trade, it draws entry/SL/TP markers
directly on your MT5 chart.

## ⚠️ Read this before you run it with real money

- **No bot — this one or any other — can guarantee a trade will be
  profitable.** The "historical performance filter" described below only
  allows strategies that *have* worked, on past data, to trade live. It
  is not a promise about the future. Markets change; a combo with a
  great backtest can still lose money live.
- **Test on a demo account first.** Run it for at least a few weeks of
  live market conditions on a free MT5 demo account before risking real
  capital.
- **Start small.** Even after demo testing, fund the live account with
  money you can afford to lose, and watch it closely for the first
  sessions.
- Past backtest or demo performance does not predict future results.
- You are responsible for complying with your broker's terms and any
  regulations in your jurisdiction (forex trading rules vary by country).

## Requirements

- Windows (or Linux/Mac via Wine) — the MetaTrader5 Python package only
  works alongside an actual running MT5 terminal.
- An MT5 account (demo or live) with a broker that supports the MT5
  Python API (most do).
- Python 3.9+

## Setup

1. Install MetaTrader 5 desktop terminal and log into your account once
   manually, so the terminal is configured.
2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Open `config.py` and fill in:
   - `MT5_LOGIN`, `MT5_PASSWORD`, `MT5_SERVER` (from your broker)
   - Confirm `SYMBOLS` matches symbol names exactly as your broker lists
     them (e.g. some brokers use `EURUSD.a` instead of `EURUSD`)
   - Open the charts for each symbol in `SYMBOLS` inside your MT5
     terminal if you want to see the chart markers (they only draw onto
     charts that are actually open)
4. Run it:
   ```
   python main.py
   ```
   On startup it backtests every (symbol, timeframe, strategy) combo
   and logs which ones got approved for live trading. If none qualify,
   it tells you and keeps running without trading — see "Tuning" below.
5. Stop it any time with `Ctrl+C`. It will NOT close your open positions
   on exit — those stay managed by their stop-loss/take-profit orders
   already placed on the broker's side.

## How it decides to trade

**At startup (and every `RE_VALIDATE_EVERY_N_SCANS` scans after that):**

1. For every symbol × timeframe (M15, M30, H1, H4) combo, the bot replays
   `BACKTEST_BARS` of history bar-by-bar for each strategy, simulating
   entries/exits with the same ATR-based SL and 1:3 TP the live bot uses.
2. A strategy is "approved" for that specific combo only if its backtest
   cleared `MIN_TRADES_FOR_VALIDITY` trades, `MIN_WIN_RATE_PCT` win rate,
   and `MIN_PROFIT_FACTOR`. (Math note: at a 1:3 reward:risk, breakeven
   win rate is only 25% — the default 35% threshold builds in a safety
   margin since backtests tend to look better than live results.)
3. Combos where nothing qualifies are disabled entirely; they generate
   no live trades no matter what the strategies say.

**Every `SCAN_INTERVAL_SECONDS`, for each symbol:**

1. Skips the symbol if it already has an open position (one at a time,
   across all its timeframes, to avoid conflicting trades).
2. For each of its approved timeframes, pulls fresh price bars and lets
   only the approved strategies vote `BUY`/`SELL`/`HOLD`.
3. If at least `MIN_VOTES_TO_TRADE` approved strategies agree, sizes the
   trade (`risk_manager.py`: stop-loss from ATR, risking
   `RISK_PER_TRADE_PCT` of equity, take-profit at `REWARD_RISK_RATIO` ×
   the stop distance) and places it.
4. Before placing anything, it also checks: daily loss kill switch, max
   open positions, and spread isn't unusually wide.
5. On a successful fill, draws an entry arrow and dashed SL/TP lines on
   that symbol's open MT5 chart.

## Tuning

All the knobs are in `config.py` with comments. The defaults are
intentionally conservative for a small account:
- 1% risk per trade
- 1:3 reward:risk
- 3 max concurrent positions
- 5% daily loss kill switch
- 35% min backtested win rate, 1.3 min profit factor, 15+ trade sample

If the bot logs "no combo qualifies," you can: widen `SYMBOLS`, increase
`BACKTEST_BARS` for a bigger sample, or carefully loosen
`MIN_WIN_RATE_PCT`/`MIN_PROFIT_FACTOR` — understanding that loosening
these makes the filter less protective, not more profitable.

## Chart markers

Set `DRAW_CHART_MARKERS = False` in `config.py` to turn these off. Colors
for buy/sell arrows and SL/TP lines are also configurable there. Markers
are named per-trade-ticket so multiple trades don't overwrite each other.

## AI strategy (5th voter)

Optional, off by default. When enabled, Claude analyzes recent price/
indicator data for each scan and casts one extra `BUY`/`SELL`/`HOLD`
vote alongside the four rule-based strategies.

**Important:** this vote is NOT covered by the backtest filter above --
an LLM call isn't something you can cheaply replay across thousands of
historical bars, and old-data judgment isn't a great proxy for live
judgment anyway. So `REQUIRE_NON_AI_AGREEMENT` (on by default) makes
sure the AI vote can only ever tip a decision that at least one
backtest-approved strategy already leans toward -- it can never trigger
a trade entirely on its own.

To turn it on:
1. Get an API key from https://console.anthropic.com
2. Set it as an environment variable (preferred, keeps it out of source
   control): `ANTHROPIC_API_KEY=sk-...`
3. In `config.py`, set `USE_AI_STRATEGY = True`
4. `pip install anthropic` (already in `requirements.txt`)

Tune `AI_MODEL`, `AI_MAX_TOKENS`, and `AI_CALL_COOLDOWN_SECONDS` (how
long to reuse the last vote before calling the API again) in `config.py`.

## Adding/removing strategies

Each file in `strategies/` exposes a `signal(df) -> "BUY"|"SELL"|"HOLD"`
function. Toggle any of them off globally in `config.py`
(`USE_TREND_FOLLOWING`, etc.). To add a new one, drop a new module with
the same `signal()` interface into `strategies/`, import it in
`signal_combiner.py` and `backtest_filter.py`, and add it to both
registries.

## Broad symbol universe, multi-timeframe, volatility & session matching

`config.SYMBOLS` now covers 30+ pairs (majors, crosses, exotics) and
`config.TIMEFRAMES` runs M1 through H4. `volatility_screener.py` ranks
every symbol's current volatility (ATR%) relative to the others being
scanned and buckets it LOW/MEDIUM/HIGH/EXTREME; `config.STRATEGY_
VOLATILITY_MAP` decides which strategies are even allowed to vote on a
symbol in its current bucket. `session_manager.py` adds a second,
independent filter based on the time of day (Asian/London/NY/off-hours).
A strategy needs to clear **all three** gates -- backtest-approved,
volatility-matched, session-matched -- to vote on a given scan. If any
single filter would empty the pool entirely, the bot falls back to the
looser list rather than going silent (logged at DEBUG level).

**Honest cost:** backtesting this many (symbol, timeframe, strategy)
combos at startup (and on every periodic re-validation) takes real
wall-clock time -- this is not instant, especially with 6 timeframes
including M1/M5. If startup feels too slow, reduce `BACKTEST_BARS`,
shrink `SYMBOLS`, or reduce `TIMEFRAMES`.

## Soft daily trade-frequency target (not a hard "must")

`config.DAILY_TRADE_TARGET` (default 20) and `TRADE_TARGET_WINDOW_HOURS`
(default 12) describe a target the bot tries to reach by progressively
lowering its effective `MIN_VOTES_TO_TRADE` (down to
`RELAXATION_FLOOR_MIN_VOTES`, never below 1) if it's falling behind pace
-- see `trade_frequency.py`. It will never invent a trade with zero
strategy agreement just to hit a number; on a genuinely quiet day it
falls short of the target rather than gambling to meet it. This is a
deliberate design choice, not a missing feature -- a bot that *must* find
a trade every day eventually takes one it shouldn't.

## Fixed lot sizing by asset class

Position size is now FIXED per asset class and scales linearly with
account equity off a $100 reference (`risk_manager.base_lot_for_symbol`):

- currency pairs: `FOREX_BASE_LOT_PER_100` = 0.08 lots per $100 equity
- crypto:         `CRYPTO_BASE_LOT_PER_100` = 0.04 lots per $100 equity
- metals/oil/indices (XAU, XAG, USOIL, US30, NAS100, ...):
                  `HIGH_VOL_BASE_LOT_PER_100` = 0.02 lots per $100 equity

A $100 account trades 0.08 / 0.04 / 0.02; a $500 account trades
0.40 / 0.20 / 0.10 respectively. The old confidence-scaled risk%
machinery (`MIN/MAX_RISK_PCT_PER_TRADE`, `PORTFOLIO_MAX_RISK_PCT`) is
retained as legacy constants only and no longer sizes trades. What still
applies as safety floors: the daily-loss kill switch, daily profit target,
consecutive-loss pause, `MAX_OPEN_POSITIONS` (max 3 entries per trade),
the spread gate, and the lot-floor skip -- if the broker's minimum
tradeable lot would risk more than `MAX_LOT_FLOOR_RISK_MULTIPLE` times the
fixed lot's intended risk on this account size, the trade is skipped
rather than forced oversized.

## Take-profit ladder (4 take profits)

`USE_TP_LADDER` (on by default) splits every position into up to 4 take
profits. MT5/MT4 only allow one broker-side TP, so the first three levels
are realized as partial closes and the final level (fraction `1.0`) is the
broker TP itself, which closes whatever is left:

| Level | Position in target | % of position banked |
|-------|--------------------|----------------------|
| TP1   | 25% of the way     | 25%                  |
| TP2   | 50% of the way     | 25%                  |
| TP3   | 75% of the way     | 25%                  |
| TP4   | full target        | 25% (broker TP)      |

`TAKE_PROFIT_LEVELS` is a list of `(fraction, close_pct)` pairs, where
`fraction` is measured against each trade's own target distance (so the
same ladder scales correctly to swing 1:3, high-vol 1:2, scalping 1:1.5)
and `close_pct` is a % of the ORIGINAL position. `trade_tracker.py`
accumulates profit across the partial closes, so the final logged trade
result reflects the true total P/L. When `USE_TP_LADDER` is off, the old
single `USE_PARTIAL_CLOSE` / `PARTIAL_CLOSE_TRIGGER_R` /
`PARTIAL_CLOSE_PERCENT` rule is used instead.

## Consecutive-loss limiter & daily profit target

`USE_CONSECUTIVE_LOSS_LIMITER`: if the last `MAX_CONSECUTIVE_LOSSES`
trades (default 4) were all losses, new entries pause for
`RESUME_AFTER_HOURS` (default 4). `USE_DAILY_PROFIT_TARGET`: once the
day's gain hits `DAILY_PROFIT_TARGET_PCT` (default 4%), new entries pause
until the next UTC day -- the upside mirror of the existing daily-loss
kill switch. Both only block *new* entries; open positions are still
managed normally.

## Equity curve protection

`USE_EQUITY_CURVE_PROTECTION`: tracks the account's all-time equity peak
(persisted in `equity_peak.json`). If current equity has fallen
`DRAWDOWN_REDUCTION_TRIGGER_PCT` (default 8%) or more below that peak,
every new trade's risk is multiplied by `DRAWDOWN_RISK_MULTIPLIER`
(default 0.5x) until equity recovers back above the peak. This layers
*under* the confidence-based sizing above -- it only ever shrinks
position size during a drawdown, never increases it.

## Micro-scalping (experimental, off by default)

`USE_MICRO_SCALPING`: a sub-minute strategy in `micro_scalping.py` that
trades raw tick data on EXTREME-volatility symbols, targeting a small
absolute dollar profit (`MICRO_SCALP_TARGET_USD`) within a short hold
time (`MICRO_SCALP_MAX_HOLD_SECONDS`). It runs on its own faster loop
(`MICRO_SCALP_SCAN_INTERVAL_SECONDS`), independent of the main scan.

**Read this before turning it on:** a profit target this small can be
close to, or smaller than, your broker's round-trip spread + commission
on that symbol -- in which case this strategy loses money to transaction
costs regardless of whether its signal was right. Check your actual
spread on the symbol first. This strategy (along with `ai_strategy`) is
listed in `config.EXPERIMENTAL_STRATEGIES`: because tick-by-tick judgment
isn't something that gets backtested the normal way, `REQUIRE_NON_
EXPERIMENTAL_AGREEMENT` (on by default) means it can never trigger a
trade by itself -- a backtest-approved strategy on that symbol's M1 must
already agree.

## Dashboard

`DASHBOARD_ENABLED` (on by default): prints a read-only text snapshot to
the console every `DASHBOARD_REFRESH_EVERY_N_SCANS` scans -- equity, open
positions, all-time win rate, today's trade-frequency pace, and how many
combos are currently approved. Purely informational; doesn't affect any
trading decision.

## Logs

All activity (connections, signals, backtests, orders, errors) is
written to both the console and `bot_activity.log`.
