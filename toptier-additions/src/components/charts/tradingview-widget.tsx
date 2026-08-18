"use client";

/**
 * TradingView Advanced Chart Widget
 * Drop into: src/components/charts/tradingview-widget.tsx
 *
 * Free TradingView widget — no API key needed.
 * Supports 50+ indicators, drawing tools, multiple timeframes.
 */

import { useEffect, useRef, useState } from "react";

interface TradingViewWidgetProps {
  symbol?: string;        // e.g. "FX:EURUSD", "NASDAQ:AAPL", "BINANCE:BTCUSDT"
  interval?: string;      // 1, 5, 15, 60, 240, D, W
  theme?: "light" | "dark";
  height?: number | string;
  studies?: string[];     // e.g. ["STD;RSI", "STD;MACD", "STD;BB"]
  hideSideToolbar?: boolean;
  allowSymbolChange?: boolean;
  watchlist?: string[];
}

declare global {
  interface Window {
    TradingView?: any;
  }
}

let scriptLoading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.TradingView) return Promise.resolve();
  if (scriptLoading) return scriptLoading;

  scriptLoading = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
  return scriptLoading;
}

export function TradingViewWidget({
  symbol = "FX:EURUSD",
  interval = "60",
  theme = "dark",
  height = 500,
  studies = ["STD;RSI", "STD;MACD"],
  hideSideToolbar = false,
  allowSymbolChange = true,
  watchlist = ["FX:EURUSD", "FX:GBPUSD", "FX:USDJPY", "NASDAQ:AAPL", "BINANCE:BTCUSDT"],
}: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadScript().then(() => {
      if (cancelled || !containerRef.current || !window.TradingView) return;

      // Clear previous widget
      containerRef.current.innerHTML = "";

      widgetRef.current = new window.TradingView.widget({
        container_id: containerRef.current.id,
        symbol,
        interval,
        theme,
        locale: "en",
        toolbar_bg: theme === "dark" ? "#0a0a0f" : "#f1f3f6",
        enable_publishing: false,
        allow_symbol_change: allowSymbolChange,
        hide_side_toolbar: hideSideToolbar,
        withdateranges: true,
        studies,
        watchlist,
        details: true,
        hotlist: true,
        calendar: true,
        autosize: true,
        style: "1",
        backgroundColor: theme === "dark" ? "#0a0a0f" : "#ffffff",
        gridColor: theme === "dark" ? "#1a1a25" : "#e1e1e1",
        overrides: theme === "dark" ? {
          "paneProperties.background": "#0a0a0f",
          "paneProperties.vertGridProperties.color": "#1a1a25",
          "paneProperties.horzGridProperties.color": "#1a1a25",
          "scalesProperties.textColor": "#888",
        } : {},
        popup_width: "1000",
        popup_height: "650",
      });

      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [symbol, interval, theme, studies.join(","), watchlist.join(",")]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-white/10 bg-[#0a0a0f]" style={{ height }}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-muted-foreground">Loading chart...</div>
        </div>
      )}
      <div id={`tv-${Math.random().toString(36).slice(2, 8)}`} ref={containerRef} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}

// ---------- Mini Chart (for dashboard cards) ----------
export function TradingViewMiniChart({
  symbol = "FX:EURUSD",
  height = 200,
  theme = "dark",
}: { symbol?: string; height?: number; theme?: "light" | "dark" }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadScript().then(() => {
      if (!containerRef.current || !window.TradingView) return;
      containerRef.current.innerHTML = "";

      new window.TradingView.MiniWidget({
        container_id: containerRef.current.id,
        symbol,
        width: "100%",
        height,
        locale: "en",
        dateRange: "3M",
        colorTheme: theme,
        isTransparent: true,
        autosize: true,
        largeChartUrl: "",
      });
    });
  }, [symbol, theme]);

  return (
    <div
      ref={containerRef}
      style={{ height, width: "100%" }}
    />
  );
}

// ---------- Symbol Info Ticker ----------
export function TradingViewTicker({ symbol = "FX:EURUSD" }: { symbol?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadScript().then(() => {
      if (!containerRef.current || !window.TradingView) return;
      containerRef.current.innerHTML = "";

      new window.TradingView.TickerTape({
        symbols: [{ proName: symbol, title: symbol.replace(":", " / ") }],
        showSymbolLogo: true,
        colorTheme: "dark",
        isTransparent: true,
        displayMode: "adaptive",
        locale: "en",
        container_id: containerRef.current.id,
      });
    });
  }, [symbol]);

  return <div ref={containerRef} style={{ width: "100%" }} />;
}

// ---------- Symbol Overview (multi-symbol comparison) ----------
export function TradingViewOverview({ symbols = [
  { s: "FX:EURUSD", d: "EUR/USD" },
  { s: "FX:GBPUSD", d: "GBP/USD" },
  { s: "FX:USDJPY", d: "USD/JPY" },
  { s: "NASDAQ:AAPL", d: "Apple" },
  { s: "BINANCE:BTCUSDT", d: "Bitcoin" },
] }: { symbols?: { s: string; d: string }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadScript().then(() => {
      if (!containerRef.current || !window.TradingView) return;
      containerRef.current.innerHTML = "";

      new window.TradingView.MiniSymbolOverview({
        symbols,
        width: "100%",
        height: 400,
        locale: "en",
        colorTheme: "dark",
        isTransparent: true,
        dateRange: "3M",
        container_id: containerRef.current.id,
      });
    });
  }, [symbols.map((s) => s.s).join(",")]);

  return <div ref={containerRef} style={{ width: "100%", height: 400 }} />;
}
