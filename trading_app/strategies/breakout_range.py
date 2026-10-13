"""Strategies #29-38 -- Breakout & Range."""
import numpy as np
import pandas as pd
import sys, os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import indicators as ind
import engines as eng


def s29_range_breakout(df, period=20):
    """Range defined by an N-bar high/low, same math as Donchian but usually
    applied after a volatility-contraction filter to identify real ranges."""
    upper = df["high"].rolling(period).max()
    lower = df["low"].rolling(period).min()
    return eng.band_breakout_signal(df["close"], upper, lower)


def s30_opening_range_breakout(df, opening_bars=15):
    """
    df must be intraday bars with a DatetimeIndex. For each session, the
    opening range is the high/low of the first `opening_bars` bars; signal
    fires on the first break after that window each day.
    """
    day = df.index.date
    signal = pd.Series(0, index=df.index)
    for d, idx in pd.Series(df.index, index=df.index).groupby(day):
        day_df = df.loc[idx.values]
        if len(day_df) <= opening_bars:
            continue
        opening = day_df.iloc[:opening_bars]
        or_high, or_low = opening["high"].max(), opening["low"].min()
        position = 0
        for ts in day_df.index[opening_bars:]:
            c = df.loc[ts, "close"]
            if position == 0:
                if c > or_high:
                    position = 1
                elif c < or_low:
                    position = -1
            signal.loc[ts] = position
    return signal


def s31_volatility_squeeze_breakout(df, bb_period=20, bb_std=2.0, kc_period=20, kc_mult=1.5):
    bb = ind.bollinger_bands(df["close"], bb_period, bb_std)
    kc = ind.keltner_channels(df, kc_period, kc_mult)
    squeeze_on = (bb["upper"] < kc["upper"]) & (bb["lower"] > kc["lower"])
    squeeze_release = squeeze_on.shift(1) & ~squeeze_on
    momentum = df["close"].diff(3)
    signal = pd.Series(0, index=df.index)
    signal[squeeze_release & (momentum > 0)] = 1
    signal[squeeze_release & (momentum < 0)] = -1
    return signal.replace(0, np.nan).ffill().fillna(0)


def s32_retest_entry(df, period=20, tolerance_atr_mult=0.3, confirm_bars=10):
    """State machine: after a Donchian-style breakout, wait for price to pull
    back within `tolerance_atr_mult`*ATR of the broken level and hold, then enter."""
    dc = ind.donchian_channels(df, period)
    a = ind.atr(df, 14)
    signal = pd.Series(0, index=df.index)
    state = None  # None | ("await_retest_long", level, bars_left) | ("await_retest_short", ...)
    position = 0
    for i in range(period, len(df)):
        c = df["close"].iloc[i]
        if state is None and position == 0:
            if c > dc["upper"].iloc[i - 1]:
                state = ["await_retest_long", dc["upper"].iloc[i - 1], confirm_bars]
            elif c < dc["lower"].iloc[i - 1]:
                state = ["await_retest_short", dc["lower"].iloc[i - 1], confirm_bars]
        elif state is not None:
            kind, level, bars_left = state
            tol = tolerance_atr_mult * a.iloc[i]
            if kind == "await_retest_long":
                if abs(c - level) <= tol and c > level - tol:
                    position, state = 1, None
                elif c < level - tol:
                    state = None  # failed retest, invalidate
            else:
                if abs(c - level) <= tol and c < level + tol:
                    position, state = -1, None
                elif c > level + tol:
                    state = None
            if state is not None:
                state[2] -= 1
                if state[2] <= 0:
                    state = None
        signal.iloc[i] = position
    return signal


def s33_failed_breakout_reversal(df, period=20, confirm_bars=3):
    dc = ind.donchian_channels(df, period)
    signal = pd.Series(0, index=df.index)
    pending = None
    for i in range(period, len(df)):
        c = df["close"].iloc[i]
        if pending is None:
            if c > dc["upper"].iloc[i - 1]:
                pending = ["long_break", i]
            elif c < dc["lower"].iloc[i - 1]:
                pending = ["short_break", i]
        else:
            kind, start = pending
            bars_since = i - start
            if kind == "long_break" and c < dc["mid"].iloc[i]:
                signal.iloc[i] = -1
                pending = None
            elif kind == "short_break" and c > dc["mid"].iloc[i]:
                signal.iloc[i] = 1
                pending = None
            elif bars_since > confirm_bars:
                pending = None
    return signal.replace(0, np.nan).ffill().fillna(0)


def s34_support_resistance_bounce(df, window=5, tolerance_pct=0.5):
    import patterns as pat
    piv_high, piv_low = ind.rolling_pivots(df["close"], window)
    resistance_levels = df["close"].where(piv_high).ffill()
    support_levels = df["close"].where(piv_low).ffill()
    near_support = (df["close"] - support_levels).abs() / support_levels * 100 < tolerance_pct
    near_resistance = (df["close"] - resistance_levels).abs() / resistance_levels * 100 < tolerance_pct
    bullish_confirm = df["close"] > df["open"]
    bearish_confirm = df["close"] < df["open"]
    signal = pd.Series(0, index=df.index)
    signal[near_support & bullish_confirm] = 1
    signal[near_resistance & bearish_confirm] = -1
    return signal


def s35_triangle_breakout(df, window=5, lookback=100):
    import patterns as pat
    return pat.triangle_wedge_breakout(df, window, lookback)


def s36_flag_pennant_continuation(df, flagpole_lookback=10, flagpole_move_pct=5.0,
                                   consolidation_bars=8, consolidation_range_pct=2.0):
    move_pct = (df["close"] - df["close"].shift(flagpole_lookback)) / df["close"].shift(flagpole_lookback) * 100
    recent_range_pct = (df["high"].rolling(consolidation_bars).max() -
                         df["low"].rolling(consolidation_bars).min()) / df["close"] * 100
    tight_consolidation = recent_range_pct < consolidation_range_pct
    strong_up_move = move_pct.shift(consolidation_bars) > flagpole_move_pct
    strong_down_move = move_pct.shift(consolidation_bars) < -flagpole_move_pct
    breakout_up = df["close"] > df["high"].rolling(consolidation_bars).max().shift(1)
    breakout_down = df["close"] < df["low"].rolling(consolidation_bars).min().shift(1)
    signal = pd.Series(0, index=df.index)
    signal[tight_consolidation.shift(1).fillna(False) & strong_up_move & breakout_up] = 1
    signal[tight_consolidation.shift(1).fillna(False) & strong_down_move & breakout_down] = -1
    return signal


def s37_round_number_levels(df, increment=1.0, tolerance_pct=0.1):
    """Generates synthetic S/R levels at fixed increments, then reuses the
    support/resistance bounce logic (#34) against those levels."""
    nearest_level = (df["close"] / increment).round() * increment
    dist_pct = (df["close"] - nearest_level).abs() / nearest_level * 100
    near_level = dist_pct < tolerance_pct
    bullish_confirm = df["close"] > df["open"]
    bearish_confirm = df["close"] < df["open"]
    above_level = df["close"] > nearest_level
    signal = pd.Series(0, index=df.index)
    signal[near_level & bullish_confirm & ~above_level] = 1
    signal[near_level & bearish_confirm & above_level] = -1
    return signal


def s38_volume_breakout_confirmation(base_signal: pd.Series, volume: pd.Series, lookback=20, mult=1.5):
    """Filter-only: apply on top of any breakout signal (#29,#30,#35) to
    require above-average volume on the breakout bar."""
    confirmed = eng.volume_confirms(volume, lookback, mult)
    return eng.apply_filter(base_signal, confirmed)
