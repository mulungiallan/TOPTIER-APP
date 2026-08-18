"""
config.py
---------
All tunable settings for the bot live here. Edit this file, never the
strategy/execution logic, when you want to change behavior.
"""

import os


def _load_dotenv():
    import pathlib
    current = pathlib.Path(__file__).resolve().parent
    while True:
        env_file = current / ".env"
        try:
            text = env_file.read_text(encoding="utf-8")
        except OSError:
            text = None
        if text:
            for line in text.splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
        parent = current.parent
        if parent == current:
            break
        current = parent


_load_dotenv()

# ----------------------------------------------------------------------
# MT5 TERMINAL LOGIN
# Fill these in with your broker-issued account number, password, and
# server name (visible in your MT5 terminal under File > Login to Trade
# Account). Never commit real credentials to source control.
# ----------------------------------------------------------------------
MT5_LOGIN = int(os.environ.get("MT5_LOGIN", "0"))       # your account number, e.g. 12345678
MT5_PASSWORD = os.environ.get("MT5_PASSWORD", "")        # your account password
MT5_SERVER = os.environ.get("MT5_SERVER", "")            # e.g. "ICMarketsSC-Demo"
MT5_PATH = os.environ.get("MT5_PATH", "")                # optional: full path to terminal64.exe

# ----------------------------------------------------------------------
# INSTRUMENTS & TIMEFRAMES
# The bot scans every symbol on every timeframe listed here, independently.
# Each (symbol, timeframe) pair is treated as its own tradeable "slot" with
# its own backtest history and its own open-position tracking.
#
# Broad universe across majors, minors/crosses, and exotics, so the bot
# has many places to look for opportunities. Volatility (ATR%) is screened
# per symbol by volatility_screener.py and used to match each symbol to
# the strategies suited to its current behavior (see STRATEGY_VOLATILITY_MAP
# below) -- a quiet pair and a wild pair shouldn't be traded the same way.
#
# Some of these may not exist or may be named slightly differently at your
# broker (exotics especially -- check your MT5 Market Watch and adjust this
# list to match exact broker symbol names, including any suffix).
# ----------------------------------------------------------------------
SYMBOLS = [
    # majors
    "EURUSD.m", "GBPUSD.m", "USDJPY.m", "USDCHF.m", "USDCAD.m", "AUDUSD.m", "NZDUSD.m",
    # EUR crosses
    "EURGBP.m", "EURJPY.m", "EURCHF.m", "EURCAD.m", "EURAUD.m", "EURNZD.m",
    # GBP crosses
    "GBPJPY.m", "GBPCHF.m", "GBPCAD.m", "GBPAUD.m", "GBPNZD.m",
    # other crosses
    "AUDJPY.m", "AUDCAD.m", "AUDCHF.m", "AUDNZD.m",
    "CADJPY.m", "CADCHF.m",
    "NZDJPY.m", "NZDCAD.m", "NZDCHF.m",
    "CHFJPY.m",
    # exotics (wider spreads, more volatile, more expensive to trade -- handle with care)
    # NOTE: USDTRY removed -- not offered by this broker/account type, confirmed via list_all_symbols.py
    "USDZAR.m", "USDMXN.m", "USDSEK.m", "USDNOK.m", "USDPLN.m",
    # high-volatility instruments for scalping/momentum emphasis on a small account.
    # BTCUSD.m confirmed present in this broker's full symbol list (see list_all_symbols.py
    # output). XAUUSD/USOIL/US30 are NOT yet confirmed -- this broker uses ".std" for
    # indices (AU200.std, DE40.std, etc.) which is different from forex's ".m", so these
    # are best-guess placeholders. RUN check_symbols.py BEFORE relying on these live --
    # it now also tries the ".std" suffix and will tell you exactly which ones resolve.
    "BTCUSD.m",       # confirmed
    # "XAUUSD.m",      # UNCONFIRMED — run check_symbols.py before enabling
    # "USOIL.std",     # UNCONFIRMED — run check_symbols.py before enabling
    # "US30.std",      # UNCONFIRMED — run check_symbols.py before enabling
]
# NOTE: this broker (JustMarkets demo) suffixes every forex symbol with ".m" --
# confirmed via list_all_symbols.py. If you switch brokers/accounts later, re-run
# that script and update this list accordingly; suffixes vary a lot by broker.
TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4"]   # M1/M5 added for scalping
BARS_TO_FETCH = 500                                    # live-scan history length per (symbol, timeframe)

# ----------------------------------------------------------------------
# HISTORICAL PERFORMANCE FILTER ("only profitable ones")
# Before the bot ever risks real money, it backtests every strategy on
# every (symbol, timeframe) combo over BACKTEST_BARS of history. A combo
# is only allowed to trade live if it cleared BOTH thresholds below.
# This is a filter based on demonstrated past performance -- it is NOT a
# guarantee that future trades will be profitable. Markets change, and a
# strategy that worked over the backtest window can still lose money live.
#
# Math note: with REWARD_RISK_RATIO = 3.0, the breakeven win rate is only
# 1 / (1 + 3) = 25%. MIN_WIN_RATE_PCT below is set well above breakeven
# on purpose, as a safety margin against the backtest being optimistic
# (it almost always is, to some degree, vs. live results).
# ----------------------------------------------------------------------
BACKTEST_BARS = 2000            # bars of history used to evaluate each combo
MIN_WIN_RATE_PCT = 35.0          # breakeven is 25% at a 1:3 RR -- this adds a safety margin
MIN_PROFIT_FACTOR = 1.3          # gross profit / gross loss must exceed this to qualify
MIN_TRADES_FOR_VALIDITY = 15     # need at least this many backtested trades to trust the stats
RE_VALIDATE_EVERY_N_SCANS = 500  # periodically re-run the backtest filter so a combo that
                                  # stops working gets disabled automatically (0 = never)

# ----------------------------------------------------------------------
# RISK MANAGEMENT (the most important section in this file)
#
# Position sizing is now FIXED per asset class and scales linearly with
# account equity, using a "$100 account" reference:
#
#   FOREX_BASE_LOT_PER_100    0.08  lots of currency pairs  per $100 equity
#   CRYPTO_BASE_LOT_PER_100   0.04  lots of crypto          per $100 equity
#   HIGH_VOL_BASE_LOT_PER_100 0.02  lots of metals/oil/indices (XAU, XAG,
#                                   US30, NAS100, ...) per $100 equity
#
# So a $100 account trades 0.08 forex lots, 0.04 crypto lots, and 0.02
# high-vol lots; a $500 account trades 0.40 / 0.20 / 0.10 respectively.
#
# The old confidence-scaled risk% sizing (MIN/MAX_RISK_PCT_PER_TRADE,
# PORTFOLIO_MAX_RISK_PCT) no longer sizes trades. What REMAINS enforced as
# safety floors:
#   - kill switch          (MAX_DAILY_LOSS_PCT)
#   - daily profit target  (DAILY_PROFIT_TARGET_PCT)
#   - consecutive-loss pause
#   - MAX_OPEN_POSITIONS   (MAXIMUM 3 ENTRIES PER TRADE)
#   - spread gate          (MAX_SPREAD_PIPS)
#   - lot-floor skip: if the broker's minimum tradeable lot would risk far
#     more than the fixed lot's own risk, skip instead of force it.
# ----------------------------------------------------------------------
FOREX_BASE_LOT_PER_100 = 0.08      # currency pairs: EURUSD, GBPJPY, ... (0.08 per $100 equity)
CRYPTO_BASE_LOT_PER_100 = 0.04     # crypto: BTCUSD, ETHUSD, ... (0.04 per $100 equity)
HIGH_VOL_BASE_LOT_PER_100 = 0.02   # metals/oil/indices: XAU, XAG, USOIL, US30, NAS100, ... (0.02 per $100 equity)
BASE_LOT_EQUITY_REFERENCE = 100.0  # the three lots above are "per 100 units of equity"
MAX_OPEN_POSITIONS = 3             # MAXIMUM entries per trade -- hard cap on open position COUNT

# ----------------------------------------------------------------------
# ACCOUNT-SIZE TIERS (bot risk rules by account size)
# Every account is classified by its live equity into one of three tiers.
# The tier caps are enforced ON TOP of the per-asset-class sizing above --
# they can only shrink a lot, never grow it, and they limit concurrent
# entries. Accounts above the mid tier keep the present rules unchanged.
#
#   equity <= ACCOUNT_TIER_SMALL_MAX_EQUITY (<= $50)
#       max ACCOUNT_TIER_SMALL_MAX_ENTRIES (3) concurrent entries,
#       every trade capped at ACCOUNT_TIER_SMALL_MAX_LOT (0.02) lots.
#       All instruments allowed; the bot may take as many sequential
#       trades as possible as long as no more than 3 are open at once.
#
#   $50 < equity <= ACCOUNT_TIER_MID_MAX_EQUITY (<= $100)
#       max ACCOUNT_TIER_MID_MAX_ENTRIES (2) concurrent entries,
#       every trade capped at ACCOUNT_TIER_MID_MAX_LOT (0.02) lots.
#       Metals (XAU, XAG, ...) are enabled and sized at 0.01-0.02 lots,
#       and the scalping risk profile (tight stops / tighter reward:risk)
#       is used -- MOSTLY SCALPING on this tier.
#
#   equity > ACCOUNT_TIER_MID_MAX_EQUITY (> $100)
#       present rules -- per-asset-class fixed sizing, MAX_OPEN_POSITIONS.
# ----------------------------------------------------------------------
ACCOUNT_TIER_SMALL_MAX_EQUITY = 50.0   # accounts at or below this = small tier
ACCOUNT_TIER_SMALL_MAX_ENTRIES = 3     # small tier: max concurrent entries
ACCOUNT_TIER_SMALL_MAX_LOT = 0.02      # small tier: max lots per trade
ACCOUNT_TIER_MID_MAX_EQUITY = 100.0    # accounts above small, up to this = mid tier
ACCOUNT_TIER_MID_MAX_ENTRIES = 2       # mid tier: max concurrent entries
ACCOUNT_TIER_MID_MAX_LOT = 0.02        # mid tier: max lots per trade
ACCOUNT_TIER_MID_ENABLE_METALS = True  # mid tier: metals (XAU/XAG/...) allowed, 0.01-0.02 lots
ACCOUNT_TIER_MID_SCALP_PROFILE = True  # mid tier: use the scalping SL/RR profile (mostly scalping)

# NOTE: MIN_RISK_PCT_PER_TRADE / MAX_RISK_PCT_PER_TRADE / PORTFOLIO_MAX_RISK_PCT
# are retained as legacy constants (referenced by the dashboard snapshot) but are
# NOT used for position sizing anymore -- fixed lot sizing above wins.
MIN_RISK_PCT_PER_TRADE = 0.25
MAX_RISK_PCT_PER_TRADE = 1.5
PORTFOLIO_MAX_RISK_PCT = 10.0

MAX_LOT_FLOOR_RISK_MULTIPLE = 2.5  # if the broker's MINIMUM lot would risk more than this many
                                    # times the intended (fixed) risk amount -- common on small
                                    # accounts trading gold/BTC/indices, which have a much bigger
                                    # $-per-point than forex micro lots -- skip the trade rather
                                    # than force an oversized position

REWARD_RISK_RATIO = 3.0          # take-profit distance = stop-loss distance * this (swing/trend/momentum/mean-reversion)
REWARD_RISK_RATIO_SCALPING = 1.5 # scalping uses a tighter, faster ratio -- see strategies/scalping.py
MAX_DAILY_LOSS_PCT = 5.0         # kill switch: stop trading for the day past this drawdown
KILL_SWITCH_CONFIRM_SCANS = 2    # require the breach to show up this many consecutive scans before
                                  # trusting it -- protects against a single bad/transient equity
                                  # reading (e.g. during a brief network hiccup) causing a false alarm
MAX_SPREAD_PIPS = 3.0            # skip entries if spread is wider than this (low liquidity guard)
ATR_PERIOD = 14                  # used to size stop-loss distance
ATR_SL_MULTIPLIER = 1.5          # stop-loss = ATR * this multiplier (swing/trend/momentum/mean-reversion)
ATR_SL_MULTIPLIER_SCALPING = 0.8 # tighter stop for scalping -- see strategies/scalping.py

# ----------------------------------------------------------------------
# BREAKEVEN SHIFT & TRAILING STOP
# Applied to every open bot position, every scan, independent of which
# strategy opened it.
# ----------------------------------------------------------------------
USE_BREAKEVEN_SHIFT = True
BREAKEVEN_TRIGGER_R = 1.0       # once profit reaches this multiple of the original risk (R), move SL to entry
BREAKEVEN_BUFFER_PIPS = 1.0     # move SL slightly past entry (covers spread) rather than exactly at it

USE_TRAILING_STOP = True
TRAILING_START_R = 1.5          # trailing only begins after profit reaches this multiple of R
TRAILING_ATR_MULTIPLIER = 1.5   # trailing distance behind price = current ATR * this

# ----------------------------------------------------------------------
# NEWS FILTER
# Pulls a free public economic calendar feed and blocks new entries on a
# symbol around high-impact news for either of its base/quote currencies.
# If the feed can't be reached (no internet, feed down), the filter fails
# OPEN (does not block trading) by default -- see NEWS_FAIL_OPEN below --
# since a bot that silently stops trading because a feed is down is its
# own kind of risk.
# ----------------------------------------------------------------------
USE_NEWS_FILTER = True
NEWS_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
NEWS_BLACKOUT_MINUTES_BEFORE = 15
NEWS_BLACKOUT_MINUTES_AFTER = 15
NEWS_MIN_IMPACT = "High"         # only "High" impact events trigger a blackout (vs "Medium"/"Low")
NEWS_FAIL_OPEN = True            # if the calendar feed is unreachable, allow trading rather than block it
NEWS_CACHE_REFRESH_MINUTES = 60  # how often to re-download the calendar feed

# ----------------------------------------------------------------------
# TRADING HOURS WINDOW
# The bot only opens NEW trades inside this window (your local machine's
# time zone, 24h format). Open positions are still managed (breakeven/
# trailing/closing) outside this window. Set USE_TRADING_HOURS = False
# to scan and trade around the clock instead.
# ----------------------------------------------------------------------
USE_TRADING_HOURS = True
TRADING_HOURS_START = "07:00"   # e.g. London open
TRADING_HOURS_END = "16:00"     # e.g. before NY afternoon chop

# ----------------------------------------------------------------------
# NO OVERNIGHT HOLD
# If True, any position the bot still has open gets force-closed shortly
# before the broker's daily rollover, so the bot never pays/receives
# overnight swap and never carries risk through low-liquidity hours.
# ----------------------------------------------------------------------
USE_NO_OVERNIGHT_HOLD = True
ROLLOVER_CLOSE_TIME = "23:50"   # broker/server time -- close everything at/after this

# ----------------------------------------------------------------------
# STRATEGY TOGGLES
# Each strategy casts one vote per symbol per scan: BUY, SELL, or HOLD.
# A trade is only placed when enough strategies agree (see MIN_VOTES_TO_TRADE).
# ----------------------------------------------------------------------
USE_TREND_FOLLOWING = True
USE_MOMENTUM = True
USE_MEAN_REVERSION = True
USE_SWING = True
USE_SCALPING = True             # fast M1/M5 strategy, see strategies/scalping.py

MIN_VOTES_TO_TRADE = 2          # how many strategies must agree (same direction) to act -- this is
                                  # the BASE value; trade_frequency.py can temporarily lower it (never
                                  # below 1) on slow days, see "SOFT DAILY TRADE TARGET" below

# ----------------------------------------------------------------------
# TWO-BRANCH TRADING ARCHITECTURE
# HIGH-VOLATILITY BRANCH (primary focus, traded more aggressively):
#   - Gold, BTC, Oil, indices, and the most volatile forex crosses
#   - Scanned first every loop, gets bigger risk allocation per trade
#   - Uses scalping + momentum strategies, wider spread tolerance
#   - Separate lot-floor check calibrated to larger contract sizes
#
# LOW-VOLATILITY BRANCH (secondary, standard forex pairs):
#   - Majors and crosses, current conservative behavior
#   - Scanned second, smaller risk per trade
#   - Mean reversion, swing, trend strategies
#
# SYMBOLS are now split into HIGH_VOL_SYMBOLS and LOW_VOL_SYMBOLS
# and the scanning loop processes HIGH_VOL first with its own settings.
# If a symbol appears in HIGH_VOL_SYMBOLS, the high-vol branch params
# apply to it regardless of what the volatility screener bucket says
# (the bucket still influences which STRATEGIES vote, just not the risk).
# ----------------------------------------------------------------------
HIGH_VOL_SYMBOLS = [
    # Commodities & crypto (confirmed or best-guess -- run check_symbols.py to verify)
    "BTCUSD.m",       # crypto -- confirmed in broker symbol list
    "XAUUSD.m",       # gold -- UNCONFIRMED suffix, verify with check_symbols.py
    "USOIL.std",      # oil -- UNCONFIRMED suffix
    "US30.std",       # US30 index -- UNCONFIRMED suffix
    # Most volatile forex crosses (genuinely high-movement even vs other forex)
    "GBPJPY.m", "GBPNZD.m", "GBPAUD.m",
    "USDZAR.m", "USDMXN.m",
    "EURJPY.m", "EURNZD.m", "EURAUD.m",
    "AUDJPY.m", "CADJPY.m", "NZDJPY.m", "CHFJPY.m",
]

LOW_VOL_SYMBOLS = [
    # Majors -- well-behaved, tighter spreads, core forex
    "EURUSD.m", "GBPUSD.m", "USDJPY.m", "USDCHF.m", "USDCAD.m", "AUDUSD.m", "NZDUSD.m",
    # Crosses -- moderate volatility
    "EURGBP.m", "EURCHF.m", "EURCAD.m",
    "GBPCHF.m", "GBPCAD.m",
    "AUDCAD.m", "AUDCHF.m", "AUDNZD.m",
    "CADCHF.m",
    "NZDCAD.m", "NZDCHF.m",
    "USDSEK.m", "USDNOK.m", "USDPLN.m",
]

# Keep SYMBOLS as the union for any code that needs the full list (check_symbols, volatility screener)
SYMBOLS = HIGH_VOL_SYMBOLS + [s for s in LOW_VOL_SYMBOLS if s not in HIGH_VOL_SYMBOLS]

# High-vol branch settings.
# NOTE: HIGH_VOL_MIN_RISK_PCT / HIGH_VOL_MAX_RISK_PCT / HIGH_VOL_MAX_LOT_FLOOR_MULTIPLE
# are retained as legacy constants only -- lot sizing is now the shared fixed
# per-asset-class sizing (see FOREX/CRYPTO/HIGH_VOL_BASE_LOT_PER_100 above),
# applied uniformly to every branch.
HIGH_VOL_MIN_RISK_PCT = 0.5      # legacy -- unused (was the risk% floor for high-vol trades)
HIGH_VOL_MAX_RISK_PCT = 2.0      # legacy -- unused (was the risk% ceiling for high-vol trades)
HIGH_VOL_REWARD_RISK_RATIO = 2.0 # tighter than swing (2:1 vs 3:1) since high-vol moves are faster
HIGH_VOL_ATR_SL_MULTIPLIER = 1.2 # tighter ATR multiplier -- high-vol has bigger ATR already
HIGH_VOL_MAX_SPREAD_PIPS = 8.0   # gold/BTC/oil have naturally wider spreads than forex
HIGH_VOL_MIN_VOTES = 1           # only requires 1 strategy to agree (high-vol = act fast)
HIGH_VOL_MAX_LOT_FLOOR_MULTIPLE = 5.0  # legacy -- unused (lot-floor check is now shared)

# High-vol branch strategy map -- scalping + momentum dominant on all buckets
HIGH_VOL_STRATEGY_MAP = {
    "LOW": ["momentum", "swing_trading"],
    "MEDIUM": ["momentum", "scalping"],
    "HIGH": ["scalping", "momentum", "trend_following"],
    "EXTREME": ["scalping", "momentum"],
}

# Scan priority -- high-vol is checked first EACH scan cycle
# (first match per scan wins the bot's position slot anyway; scanning
# high-vol first means it gets priority when multiple signals fire at once)
HIGH_VOL_SCAN_FIRST = True

# Low-vol branch volatility screener config (unchanged from before)
VOLATILITY_REFERENCE_TIMEFRAME = "H1"
VOLATILITY_LOOKBACK_BARS = 100
VOLATILITY_LOW_PERCENTILE = 33
VOLATILITY_HIGH_PERCENTILE = 80
VOLATILITY_REFRESH_EVERY_N_SCANS = 60

STRATEGY_VOLATILITY_MAP = {
    "LOW": ["mean_reversion", "swing_trading"],
    "MEDIUM": ["swing_trading", "trend_following"],
    "HIGH": ["trend_following", "momentum"],
    "EXTREME": ["scalping", "momentum"],
}

# ----------------------------------------------------------------------
# SOFT DAILY TRADE-FREQUENCY TARGET
# A TARGET, not a guarantee -- the bot tries to reach DAILY_TRADE_TARGET
# trades within TRADE_TARGET_WINDOW_HOURS by progressively widening its
# net (lowering MIN_VOTES_TO_TRADE, down to RELAXATION_FLOOR_MIN_VOTES,
# never below 1) if it's falling behind pace. It will NOT invent trades
# with zero strategy agreement just to hit a number -- on a genuinely
# quiet day it will fall short of the target rather than gamble to meet it.
# Set USE_TRADE_FREQUENCY_TARGET = False to disable this and just let
# MIN_VOTES_TO_TRADE stay fixed all day.
# ----------------------------------------------------------------------
USE_TRADE_FREQUENCY_TARGET = True
DAILY_TRADE_TARGET = 20
TRADE_TARGET_WINDOW_HOURS = 12
RELAXATION_FLOOR_MIN_VOTES = 1     # the absolute minimum MIN_VOTES_TO_TRADE can ever be relaxed to
RELAXATION_CHECK_EVERY_N_SCANS = 30  # how often to check pace and possibly relax further

# ----------------------------------------------------------------------
# AI STRATEGY (5th voter, alongside the 4 rule-based ones)
# Sends recent price/indicator data to Claude for one extra BUY/SELL/HOLD
# vote. Unlike the other 4 strategies, this one is NOT covered by the
# historical backtest filter (see ai_strategy.py for why) -- so
# REQUIRE_NON_AI_AGREEMENT (in signal_combiner.py's logic) makes sure it
# can tip a decision but never single-handedly force a trade on its own.
# Get your API key from https://console.anthropic.com -- prefer setting
# it via the ANTHROPIC_API_KEY environment variable over hardcoding it
# here, so it never ends up in source control.
# ----------------------------------------------------------------------
USE_AI_STRATEGY = True           # on -- Claude casts the 5th BUY/SELL/HOLD vote
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
AI_MODEL = "claude-sonnet-4-6"
AI_MAX_TOKENS = 200
AI_CALL_COOLDOWN_SECONDS = 600   # don't re-call the API for the same bar more often than this

# ----------------------------------------------------------------------
# EXPERIMENTAL / UNBACKTESTED STRATEGIES SAFEGUARD
# ai_strategy and micro_scalping (below) are NOT covered by the backtest
# filter -- an LLM call and tick-by-tick data aren't things that can be
# cheaply/meaningfully replayed across thousands of historical bars. So
# neither one is allowed to single-handedly trigger a trade: at least one
# backtest-approved strategy must agree with whatever direction they lean,
# every time, with no exceptions.
# ----------------------------------------------------------------------
EXPERIMENTAL_STRATEGIES = {"ai_strategy", "micro_scalping"}
REQUIRE_NON_EXPERIMENTAL_AGREEMENT = True

# ----------------------------------------------------------------------
# MICRO-SCALPING (sub-minute, small-dollar-target strategy)
# Trades on raw tick data rather than candles, targeting a small ABSOLUTE
# dollar profit (not a pip distance) over a very short hold time. Runs on
# its own faster loop (MICRO_SCALP_SCAN_INTERVAL_SECONDS), independent of
# the main SCAN_INTERVAL_SECONDS loop, and only considers symbols
# currently in the EXTREME volatility bucket during trading hours.
#
# Read this before turning it on: on a typical retail spread, the cost of
# entering AND exiting one trade can be close to, or larger than, a
# MICRO_SCALP_TARGET_USD this small. If the target profit doesn't clearly
# exceed round-trip spread + commission on the symbol you're trading, this
# strategy loses money to transaction costs alone, regardless of whether
# its signal was "right." Check your broker's actual spread on a symbol
# before relying on this, and consider raising the target if spreads are
# wide. This strategy is also bound by EXPERIMENTAL_STRATEGIES above -- it
# can never trigger a trade without a backtest-approved strategy agreeing.
# ----------------------------------------------------------------------
USE_MICRO_SCALPING = False
MICRO_SCALP_TARGET_USD = 0.80          # target profit per trade, in account currency
MICRO_SCALP_MAX_HOLD_SECONDS = 30      # force-close if still open this long, win or lose
MICRO_SCALP_TICK_WINDOW_SECONDS = 25   # how much recent tick history to evaluate for a signal
MICRO_SCALP_MIN_MOVE_POINTS = 3        # minimum raw price movement (in points) over the window to count as a real move, not noise
MICRO_SCALP_SCAN_INTERVAL_SECONDS = 5  # this strategy needs to check far more often than the main loop
MICRO_SCALP_MAX_CONCURRENT = 2         # separate, smaller cap than MAX_OPEN_POSITIONS -- this style needs tight limits

# ----------------------------------------------------------------------
# SESSION-BASED STRATEGY SELECTION
# Further restricts which strategies are even allowed to vote, based on
# the current trading session (server/broker time). Combines with (does
# not replace) the backtest filter and the volatility matching above --
# a strategy must clear ALL THREE gates (backtest-approved AND
# volatility-matched AND session-matched) to vote on a given scan.
# ----------------------------------------------------------------------
USE_SESSION_STRATEGY_FILTER = True
SESSION_ASIAN_START_HOUR = 0     # server time, 24h
SESSION_ASIAN_END_HOUR = 8
SESSION_LONDON_START_HOUR = 8
SESSION_LONDON_END_HOUR = 16
SESSION_NY_START_HOUR = 13
SESSION_NY_END_HOUR = 21

SESSION_STRATEGIES = {
    "ASIAN": ["mean_reversion", "swing_trading"],
    "LONDON": ["scalping", "momentum", "trend_following"],
    "NY": ["trend_following", "momentum"],
    "OFF_HOURS": ["swing_trading"],
}

# ----------------------------------------------------------------------
# TAKE-PROFIT LADDER (4 take profits)
# MT5/MT4 allows only ONE broker-side TP per position, so the bot realizes
# profit in up to 4 steps: partial closes at the first three levels, then
# the broker TP at the final level closes what's left.
#
# Each level is a (fraction, close_pct) pair:
#   fraction   = where in the trade's target this level sits, as a fraction
#                of the strategy's own take-profit distance. The same ladder
#                therefore scales correctly to swing (1:3), high-vol (1:2),
#                scalping (1:1.5), etc. The final level (1.0) is the broker
#                TP itself -- no manual close needed there.
#   close_pct  = % of the ORIGINAL position banked at that level.
#                The 4 levels below bank 25% each and fully exit at target.
# ----------------------------------------------------------------------
USE_TP_LADDER = True
TAKE_PROFIT_LEVELS = [
    (0.25, 25.0),   # TP1: 25% of the way to target, bank 25% of the position
    (0.50, 25.0),   # TP2: 50% of the way, bank another 25%
    (0.75, 25.0),   # TP3: 75% of the way, bank another 25%
    (1.00, 25.0),   # TP4: full target (= broker TP), closes the last 25%
]

# ----------------------------------------------------------------------
# LEGACY SINGLE PARTIAL CLOSE (used only when USE_TP_LADDER = False)
# Closes a portion of a position once it's reached partway to its take
# profit, locking in some realized profit while the rest keeps running
# (with the existing breakeven shift / trailing stop still applying to
# the remainder).
# ----------------------------------------------------------------------
USE_PARTIAL_CLOSE = True
PARTIAL_CLOSE_TRIGGER_R = 1.5    # close part of the position once profit reaches this multiple of original risk
PARTIAL_CLOSE_PERCENT = 50.0     # % of the position to close at that point

# ----------------------------------------------------------------------
# CONSECUTIVE LOSS LIMITER
# If the bot's last N closed trades (in a row, across all symbols) were
# all losses, it pauses opening any NEW trades for RESUME_AFTER_HOURS.
# Existing open positions are still managed normally during the pause.
# ----------------------------------------------------------------------
USE_CONSECUTIVE_LOSS_LIMITER = True
MAX_CONSECUTIVE_LOSSES = 4
RESUME_AFTER_HOURS = 4

# ----------------------------------------------------------------------
# DAILY PROFIT TARGET
# The upside mirror of MAX_DAILY_LOSS_PCT: once the day's gain reaches
# this %, the bot stops opening new trades until the next UTC day, locking
# in the day's result rather than risking it chasing more.
# ----------------------------------------------------------------------
USE_DAILY_PROFIT_TARGET = True
DAILY_PROFIT_TARGET_PCT = 4.0

# ----------------------------------------------------------------------
# EQUITY CURVE PROTECTION
# Tracks the account's all-time equity peak. If current equity has fallen
# DRAWDOWN_REDUCTION_TRIGGER_PCT or more below that peak, every new
# trade's risk is multiplied by DRAWDOWN_RISK_MULTIPLIER (i.e. sized down)
# until equity recovers back above the peak. This is layered UNDER
# MIN/MAX_RISK_PCT_PER_TRADE -- it shrinks position size further during a
# drawdown, it never increases it.
# ----------------------------------------------------------------------
USE_EQUITY_CURVE_PROTECTION = True
DRAWDOWN_REDUCTION_TRIGGER_PCT = 8.0
DRAWDOWN_RISK_MULTIPLIER = 0.5
EQUITY_PEAK_FILE = "equity_peak.json"

# ----------------------------------------------------------------------
# LOOP TIMING
# ----------------------------------------------------------------------
SCAN_INTERVAL_SECONDS = 60     # how often the main loop checks for new signals

# ----------------------------------------------------------------------
# CHART MARKERS
# When True, the bot draws an entry arrow plus SL/TP lines directly onto
# the symbol's open chart in your MT5 terminal whenever it places a trade.
# Requires that chart to be open in the terminal to be visible.
# ----------------------------------------------------------------------
DRAW_CHART_MARKERS = True
CHART_MARKER_BUY_COLOR = "clrLimeGreen"
CHART_MARKER_SELL_COLOR = "clrRed"
CHART_SL_COLOR = "clrOrange"
CHART_TP_COLOR = "clrDodgerBlue"

# ----------------------------------------------------------------------
# TRADE IDENTIFICATION & LIVE PERFORMANCE TRACKING
# BOT_MAGIC_NUMBER tags every order this bot places, so trade_tracker.py
# can tell this bot's trades apart from any manual trades or other EAs on
# the same account when reading closed-deal history.
# ----------------------------------------------------------------------
BOT_MAGIC_NUMBER = 20260620
TRADE_LOG_FILE = "trade_log.csv"           # append-only record of every closed trade
PENDING_TRADES_FILE = "pending_trades.json"  # bot's memory of trades still open
STATS_SUMMARY_EVERY_N_SCANS = 10            # how often to print a running win-rate summary

DASHBOARD_ENABLED = True
DASHBOARD_REFRESH_EVERY_N_SCANS = 5
DASHBOARD_SNAPSHOT_FILE = "dashboard_snapshot.json"
DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "")    # REQUIRED env var

# ----------------------------------------------------------------------
# LOGGING
# ----------------------------------------------------------------------
LOG_FILE = "bot_activity.log"
