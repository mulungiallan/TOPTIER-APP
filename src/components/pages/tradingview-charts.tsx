'use client';

import React, { useEffect, useRef, useState } from 'react';
import { LineChart, BarChart3, CandlestickChart, Activity } from 'lucide-react';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';

const CHART_SYMBOLS = [
  { label: 'BTC/USD', tv: 'BINANCE:BTCUSDT' },
  { label: 'ETH/USD', tv: 'BINANCE:ETHUSDT' },
  { label: 'EUR/USD', tv: 'FX:EURUSD' },
  { label: 'GBP/USD', tv: 'FX:GBPUSD' },
  { label: 'USD/JPY', tv: 'FX:USDJPY' },
  { label: 'GOLD', tv: 'OANDA:XAUUSD' },
  { label: 'AAPL', tv: 'NASDAQ:AAPL' },
  { label: 'TSLA', tv: 'NASDAQ:TSLA' },
  { label: 'NVDA', tv: 'NASDAQ:NVDA' },
  { label: 'SPX500', tv: 'SP:SPX' },
  { label: 'NAS100', tv: 'NASDAQ:NDX' },
  { label: 'DOW', tv: 'DJ:DJI' },
];

const INTERVALS = [
  { label: '1m', value: '1' },
  { label: '5m', value: '5' },
  { label: '15m', value: '15' },
  { label: '1H', value: '60' },
  { label: '4H', value: '240' },
  { label: '1D', value: 'D' },
  { label: '1W', value: 'W' },
];

function TradingViewChart({ symbol, interval, style }: { symbol: string; interval: string; style: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      theme: 'dark',
      style,
      timezone: 'Etc/UTC',
      locale: 'en',
      backgroundColor: '#0a0e14',
      gridColor: 'rgba(237,241,245,0.05)',
      allow_symbol_change: true,
      hide_side_toolbar: false,
      withdateranges: true,
      hide_legend: false,
      details: true,
      hotlist: true,
      calendar: true,
      save_image: true,
      studies: [],
    });
    el.appendChild(script);

    return () => {
      el.innerHTML = '';
    };
  }, [symbol, interval, style]);

  return (
    <div className="tradingview-widget-container h-full w-full">
      <div ref={ref} className="tradingview-widget-container__widget h-full w-full" />
    </div>
  );
}

function TradingViewMarketOverview({ title, symbols }: { title: string; symbols: { s: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      colorTheme: 'dark',
      dateRange: '1D',
      showChart: true,
      locale: 'en',
      isTransparent: true,
      showSymbolLogo: true,
      showFloatingTooltip: true,
      width: '100%',
      height: '360',
      plotLineColorGrowing: 'rgba(47,191,113,1)',
      plotLineColorFalling: 'rgba(229,72,77,1)',
      gridLineColor: 'rgba(237,241,245,0.05)',
      scaleFontColor: 'rgba(137,150,168,0.9)',
      belowLineFillColorGrowing: 'rgba(47,191,113,0.10)',
      belowLineFillColorFalling: 'rgba(229,72,77,0.10)',
      tabs: [{ title, symbols }],
    });
    el.appendChild(script);

    return () => {
      el.innerHTML = '';
    };
  }, [title, symbols]);

  return (
    <div className="tradingview-widget-container w-full">
      <div ref={ref} className="tradingview-widget-container__widget w-full" />
    </div>
  );
}

// A single row of pill buttons that scrolls horizontally instead of wrapping
// into a cramped multi-line mess on narrow phones — the fix for the control
// bar overflow bug in the original.
function ScrollingButtonGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-1 overflow-x-auto scrollbar-none -mx-1 px-1 sm:mx-0 sm:px-0 sm:overflow-visible sm:flex-wrap">
      {children}
    </div>
  );
}

export function TradingViewPage() {
  const [symbol, setSymbol] = useState(CHART_SYMBOLS[0]);
  const [interval, setInterval] = useState(INTERVALS[5]);
  const [chartType, setChartType] = useState<'candles' | 'line' | 'area' | 'bars'>('candles');

  const chartStyle = chartType === 'candles' ? '1' : chartType === 'line' ? '2' : chartType === 'area' ? '3' : '0';

  return (
    <PageContainer maxWidth="7xl">
      <PageHeader icon={LineChart} title="Charts" description="Professional-grade charting, powered by TradingView." />

      <div className="mt-5 rounded-xl border border-line bg-slate p-3 flex flex-col gap-2.5 md:flex-row md:items-center md:gap-4">
        <select
          value={symbol.label}
          onChange={(e) => {
            const found = CHART_SYMBOLS.find((s) => s.label === e.target.value);
            if (found) setSymbol(found);
          }}
          className="shrink-0 text-sm font-mono px-3 py-1.5 rounded-lg border border-line bg-ink text-text"
        >
          {CHART_SYMBOLS.map((s) => (
            <option key={s.label} value={s.label}>
              {s.label}
            </option>
          ))}
        </select>

        <div className="h-px w-full md:h-6 md:w-px bg-line shrink-0" />

        <ScrollingButtonGroup>
          {INTERVALS.map((i) => (
            <button
              key={i.value}
              onClick={() => setInterval(i)}
              className={cn(
                'shrink-0 px-2.5 py-1.5 text-xs font-mono rounded-md transition-colors',
                interval.value === i.value ? 'bg-brass text-brass-ink' : 'text-mist hover:bg-slate-hover hover:text-text'
              )}
            >
              {i.label}
            </button>
          ))}
        </ScrollingButtonGroup>

        <div className="h-px w-full md:h-6 md:w-px bg-line shrink-0" />

        <ScrollingButtonGroup>
          {(['candles', 'line', 'area', 'bars'] as const).map((t) => {
            const Icon = t === 'candles' ? CandlestickChart : t === 'line' ? LineChart : t === 'area' ? Activity : BarChart3;
            return (
              <button
                key={t}
                onClick={() => setChartType(t)}
                title={t}
                className={cn(
                  'shrink-0 p-1.5 rounded-md transition-colors',
                  chartType === t ? 'bg-brass text-brass-ink' : 'text-mist hover:bg-slate-hover hover:text-text'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </ScrollingButtonGroup>

        <span className="hidden md:inline-block ml-auto text-[11px] font-mono text-mist-faint shrink-0">
          {symbol.tv}
        </span>
      </div>

      <div className="mt-4 rounded-xl border border-line overflow-hidden" style={{ height: 'min(70dvh, 640px)', minHeight: '360px' }}>
        <TradingViewChart symbol={symbol.tv} interval={interval.value} style={chartStyle} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-slate p-4">
          <h2 className="font-display text-sm font-medium text-text mb-3">Crypto market</h2>
          <TradingViewMarketOverview
            title="Crypto"
            symbols={[
              { s: 'BINANCE:BTCUSDT' },
              { s: 'BINANCE:ETHUSDT' },
              { s: 'BINANCE:SOLUSDT' },
              { s: 'BINANCE:BNBUSDT' },
              { s: 'BINANCE:XRPUSDT' },
              { s: 'BINANCE:ADAUSDT' },
            ]}
          />
        </div>
        <div className="rounded-xl border border-line bg-slate p-4">
          <h2 className="font-display text-sm font-medium text-text mb-3">Forex market</h2>
          <TradingViewMarketOverview
            title="Forex"
            symbols={[
              { s: 'FX:EURUSD' },
              { s: 'FX:GBPUSD' },
              { s: 'FX:USDJPY' },
              { s: 'FX:USDCHF' },
              { s: 'FX:AUDUSD' },
              { s: 'FX:USDCAD' },
            ]}
          />
        </div>
      </div>
    </PageContainer>
  );
}

export default TradingViewPage;