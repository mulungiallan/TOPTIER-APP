"""
Chart generation: candlestick price chart with indicator overlays and
buy/sell markers from a strategy's signal series. Saves interactive HTML
(plotly) so it can be embedded directly in a web app, plus a static PNG
fallback.
"""

from __future__ import annotations
import pandas as pd


def plot_signals(
    df_with_indicators: pd.DataFrame,
    signal: pd.Series,
    title: str = "Price Chart with Signals",
    out_html: str | None = None,
    out_png: str | None = None,
):
    """
    df_with_indicators: OHLCV + indicator columns (from indicators.add_all_indicators)
    signal: series of -1/0/1 aligned to df_with_indicators.index
    """
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots

    df = df_with_indicators
    fig = make_subplots(
        rows=2,
        cols=1,
        shared_xaxes=True,
        row_heights=[0.75, 0.25],
        vertical_spacing=0.05,
        subplot_titles=(title, "RSI (14)"),
    )

    fig.add_trace(
        go.Candlestick(
            x=df.index, open=df["open"], high=df["high"], low=df["low"], close=df["close"], name="Price"
        ),
        row=1,
        col=1,
    )

    if "sma_20" in df:
        fig.add_trace(go.Scatter(x=df.index, y=df["sma_20"], line=dict(width=1), name="SMA 20"), row=1, col=1)
    if "sma_50" in df:
        fig.add_trace(go.Scatter(x=df.index, y=df["sma_50"], line=dict(width=1), name="SMA 50"), row=1, col=1)
    if "bb_upper" in df:
        fig.add_trace(
            go.Scatter(x=df.index, y=df["bb_upper"], line=dict(width=1, dash="dot"), name="BB Upper"), row=1, col=1
        )
        fig.add_trace(
            go.Scatter(x=df.index, y=df["bb_lower"], line=dict(width=1, dash="dot"), name="BB Lower"), row=1, col=1
        )

    buys = df.index[signal.reindex(df.index).fillna(0) == 1]
    sells = df.index[signal.reindex(df.index).fillna(0) == -1]
    fig.add_trace(
        go.Scatter(
            x=buys, y=df.loc[buys, "close"], mode="markers",
            marker=dict(symbol="triangle-up", size=10, color="green"), name="Buy",
        ),
        row=1, col=1,
    )
    fig.add_trace(
        go.Scatter(
            x=sells, y=df.loc[sells, "close"], mode="markers",
            marker=dict(symbol="triangle-down", size=10, color="red"), name="Sell",
        ),
        row=1, col=1,
    )

    if "rsi_14" in df:
        fig.add_trace(go.Scatter(x=df.index, y=df["rsi_14"], line=dict(width=1), name="RSI 14"), row=2, col=1)
        fig.add_hline(y=70, line=dict(dash="dash", color="red"), row=2, col=1)
        fig.add_hline(y=30, line=dict(dash="dash", color="green"), row=2, col=1)

    fig.update_layout(height=800, xaxis_rangeslider_visible=False, template="plotly_white")

    if out_html:
        fig.write_html(out_html)
    if out_png:
        fig.write_image(out_png)  # requires kaleido

    return fig
