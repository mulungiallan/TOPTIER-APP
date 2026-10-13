"""Strategies #95-100 -- Behavioral, Seasonal & Niche."""
import numpy as np
import pandas as pd


def s95_sell_in_may(price: pd.Series):
    """Long equities Nov-Apr, flat May-Oct."""
    months = price.index.month
    in_favorable_window = (months >= 11) | (months <= 4)
    return pd.Series(np.where(in_favorable_window, 1, 0), index=price.index)


def s96_january_effect(small_cap_prices: pd.DataFrame):
    """small_cap_prices: wide DataFrame of small-cap tickers. Returns a
    boolean DataFrame: True for the window late-Dec through end-Jan."""
    idx = small_cap_prices.index
    in_window = ((idx.month == 12) & (idx.day >= 20)) | (idx.month == 1)
    weights = pd.DataFrame(0, index=idx, columns=small_cap_prices.columns)
    weights.loc[in_window, :] = 1
    return weights


def s97_santa_claus_rally(price: pd.Series):
    """Window = last 5 trading days of Dec + first 2 of Jan."""
    signal = pd.Series(0, index=price.index)
    years = sorted(set(price.index.year))
    for y in years:
        dec = price.index[(price.index.year == y) & (price.index.month == 12)]
        jan = price.index[(price.index.year == y + 1) & (price.index.month == 1)]
        if len(dec) >= 5:
            signal.loc[dec[-5:]] = 1
        if len(jan) >= 2:
            signal.loc[jan[:2]] = 1
    return signal


def s98_turn_of_month(price: pd.Series):
    """Long on last trading day of month through first 3-4 of next month."""
    signal = pd.Series(0, index=price.index)
    df = pd.DataFrame(index=price.index)
    df["month"] = price.index.to_period("M")
    for month, group in df.groupby("month"):
        idx = group.index
        signal.loc[idx[-1]] = 1  # last day of this month
    # first 3 trading days of each month
    for month, group in df.groupby("month"):
        idx = group.index
        signal.loc[idx[:3]] = 1
    return signal


def s99_insider_institutional_cloning(insider_transactions: pd.DataFrame, min_transaction_usd=100_000,
                                       lookback_days=10):
    """
    insider_transactions columns: date, ticker, transaction_type ('buy'/'sell'),
    value_usd. Returns a boolean Series (indexed by date) of "buy signal
    active" for each ticker where a qualifying insider buy occurred within
    lookback_days. NOTE: 13F institutional data is reported quarterly with a
    reporting lag -- factor that delay in when wiring a real feed.
    """
    buys = insider_transactions[
        (insider_transactions["transaction_type"] == "buy") &
        (insider_transactions["value_usd"] >= min_transaction_usd)
    ].copy()
    buys["signal_end"] = buys["date"] + pd.Timedelta(days=lookback_days)
    return buys[["ticker", "date", "signal_end"]]


def s100_contrarian_sentiment(sentiment_indicator: pd.Series, lookback=252,
                               low_percentile=10, high_percentile=90):
    """
    sentiment_indicator: e.g. VIX level or put/call ratio series. Buys when
    sentiment is at an extreme fear reading (low percentile for VIX-like
    "high=fear" indicators would actually be inverted -- pass whichever
    orientation matches your indicator and flip `invert` accordingly).
    """
    low_th = sentiment_indicator.rolling(lookback).apply(lambda x: np.percentile(x, low_percentile))
    high_th = sentiment_indicator.rolling(lookback).apply(lambda x: np.percentile(x, high_percentile))
    signal = pd.Series(0, index=sentiment_indicator.index)
    signal[sentiment_indicator > high_th] = 1   # extreme fear (e.g. VIX spike) -> contrarian buy
    signal[sentiment_indicator < low_th] = -1   # extreme complacency -> contrarian caution/short
    return signal
