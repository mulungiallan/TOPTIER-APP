"""
ai_strategy.py
-----------------
A 5th voter alongside the four rule-based strategies. Sends a compact
summary of recent price action and indicator values to Claude, and asks
for a single BUY/SELL/HOLD vote with a short reason.

Important limitations, by design:
  - This is NOT backtested the way the other 4 strategies are (see
    backtest_filter.py). Replaying an LLM call against thousands of
    historical bars would be slow, costly, and the model's judgment on
    old data isn't a reliable proxy for live judgment anyway.
  - signal_combiner.py's REQUIRE_NON_AI_AGREEMENT setting means this
    vote can tip a decision but can never single-handedly force a trade
    -- at least one backtest-approved strategy must agree too.
  - Results are cached for AI_CALL_COOLDOWN_SECONDS per (symbol,
    timeframe) so the bot isn't hammering the API every scan and racking
    up cost/latency for no benefit (price action rarely changes
    meaningfully scan-to-scan on M15+ timeframes).
  - If the API call fails or returns something unparseable, this votes
    HOLD and logs a warning -- it never lets an API hiccup turn into an
    accidental BUY or SELL.
"""

import json
import logging
import time

import pandas as pd

import config
import indicators as ind

logger = logging.getLogger("ai_strategy")

_cache = {}  # key: last-bar-timestamp -> {"signal": ..., "timestamp": ...}

try:
    import anthropic
    _client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY) if config.ANTHROPIC_API_KEY else None
except ImportError:
    anthropic = None
    _client = None


def _build_prompt(df: pd.DataFrame) -> str:
    recent = df.tail(30).copy()
    closes = recent["close"].round(5).tolist()
    rsi_val = ind.rsi(df["close"], 14).iloc[-1]
    atr_val = ind.atr(df, 14).iloc[-1]
    sma20 = ind.sma(df["close"], 20).iloc[-1]
    sma50 = ind.sma(df["close"], 50).iloc[-1] if len(df) >= 50 else None

    return (
        "You are one input into an automated forex trading system. You will be given "
        "recent price data and indicator values for one currency pair. Respond with "
        "ONLY a JSON object, no other text, no markdown fences, in exactly this shape: "
        '{"signal": "BUY" | "SELL" | "HOLD", "reason": "<one short sentence>"}\n\n'
        f"Last 30 closes (oldest to newest): {closes}\n"
        f"Current RSI(14): {round(float(rsi_val), 1) if pd.notna(rsi_val) else 'n/a'}\n"
        f"Current ATR(14): {round(float(atr_val), 5) if pd.notna(atr_val) else 'n/a'}\n"
        f"SMA(20): {round(float(sma20), 5) if pd.notna(sma20) else 'n/a'}\n"
        f"SMA(50): {round(float(sma50), 5) if (sma50 is not None and pd.notna(sma50)) else 'n/a'}\n\n"
        "Give your single best directional vote for the next move based on this data alone."
    )


def _parse_response(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    parsed = json.loads(text)
    sig = parsed.get("signal", "HOLD").upper()
    if sig not in ("BUY", "SELL", "HOLD"):
        return "HOLD"
    return sig


def signal(df: pd.DataFrame) -> str:
    """Returns 'BUY', 'SELL', or 'HOLD'. Never raises -- any failure falls back to HOLD."""
    if not config.USE_AI_STRATEGY:
        return "HOLD"

    if anthropic is None:
        logger.warning("The 'anthropic' package isn't installed (pip install anthropic). AI strategy voting HOLD.")
        return "HOLD"

    if _client is None:
        logger.warning("ANTHROPIC_API_KEY not set in config.py. AI strategy voting HOLD.")
        return "HOLD"

    if len(df) < 50:
        return "HOLD"

    # Cache key: use the timestamp of the last bar as a stand-in for "this exact dataset."
    # Combined with the time-based cooldown below, this avoids re-calling the API every
    # scan when the underlying price data hasn't meaningfully moved on.
    last_bar_time = str(df["time"].iloc[-1]) if "time" in df.columns else str(len(df))
    cache_key = last_bar_time
    now = time.time()

    cached = _cache.get(cache_key)
    if cached and (now - cached["timestamp"]) < config.AI_CALL_COOLDOWN_SECONDS:
        return cached["signal"]

    try:
        prompt = _build_prompt(df)
        response = _client.messages.create(
            model=config.AI_MODEL,
            max_tokens=config.AI_MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(block.text for block in response.content if hasattr(block, "text"))
        sig = _parse_response(text)
        logger.info(f"AI strategy vote: {sig} (raw response: {text[:200]})")
    except Exception as e:
        logger.warning(f"AI strategy call failed, voting HOLD: {e}")
        sig = "HOLD"

    _cache[cache_key] = {"signal": sig, "timestamp": now}
    return sig
