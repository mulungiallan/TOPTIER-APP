'use client'

import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { LineChart, BarChart3, CandlestickChart, Activity } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

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
]

const INTERVALS = [
  { label: '1m', value: '1' },
  { label: '5m', value: '5' },
  { label: '15m', value: '15' },
  { label: '1H', value: '60' },
  { label: '4H', value: '240' },
  { label: '1D', value: 'D' },
  { label: '1W', value: 'W' },
]

const THEMES = ['light', 'dark'] as const

// ─── TradingView Advanced Chart widget (official, current embed) ─────────────
// Uses the supported s3.tradingview.com external-embedding widget instead of
// the deprecated generic `widgetembed` iframe URL, which frequently renders
// as a blank shell. Re-init on any config change by clearing the container and
// re-running the widget's JSON config script.
function TradingViewChart({
  symbol,
  interval,
  theme,
  style,
}: {
  symbol: string
  interval: string
  theme: string
  style: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Clear any previously rendered widget so config changes re-init cleanly.
    el.innerHTML = ''

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.async = true
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      theme,
      style,
      timezone: 'Etc/UTC',
      locale: 'en',
      backgroundColor: theme === 'dark' ? '#0b0f14' : '#ffffff',
      gridColor: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      allow_symbol_change: true,
      hide_side_toolbar: false,
      withdateranges: true,
      hide_legend: false,
      details: true,
      hotlist: true,
      calendar: true,
      save_image: true,
      studies: [],
    })
    el.appendChild(script)

    return () => {
      el.innerHTML = ''
    }
  }, [symbol, interval, theme, style])

  return (
    <div className="tradingview-widget-container" style={{ height: '100%', width: '100%' }}>
      <div ref={ref} className="tradingview-widget-container__widget" style={{ height: '100%', width: '100%' }} />
    </div>
  )
}

// ─── TradingView Market Overview widget (official, current embed) ───────────
function TradingViewMarketOverview({
  title,
  symbols,
}: {
  title: string
  symbols: { s: string }[]
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js'
    script.async = true
    script.innerHTML = JSON.stringify({
      colorTheme: 'dark',
      dateRange: '1D',
      showChart: true,
      locale: 'en',
      largeChartUrl: '',
      isTransparent: false,
      showSymbolLogo: true,
      showFloatingTooltip: true,
      width: '100%',
      height: '400',
      plotLineColorGrowing: 'rgba(16, 185, 129, 1)',
      plotLineColorFalling: 'rgba(239, 68, 68, 1)',
      gridLineColor: 'rgba(255, 255, 255, 0.06)',
      scaleFontColor: 'rgba(255, 255, 255, 0.8)',
      belowLineFillColorGrowing: 'rgba(16, 185, 129, 0.12)',
      belowLineFillColorFalling: 'rgba(239, 68, 68, 0.12)',
      tabs: [{ title, symbols }],
    })
    el.appendChild(script)

    return () => {
      el.innerHTML = ''
    }
  }, [title, symbols])

  return (
    <div className="tradingview-widget-container" style={{ width: '100%' }}>
      <div ref={ref} className="tradingview-widget-container__widget" style={{ width: '100%' }} />
    </div>
  )
}

export function TradingViewPage() {
  const [symbol, setSymbol] = useState(CHART_SYMBOLS[0])
  const [interval, setInterval] = useState(INTERVALS[5])
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [chartType, setChartType] = useState<'candles' | 'line' | 'area' | 'bars'>('candles')

  const chartStyle = chartType === 'candles' ? '1' : chartType === 'line' ? '2' : chartType === 'area' ? '3' : '0'

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <LineChart className="h-7 w-7 text-blue-500" />
          TradingView Charts
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Professional-grade charts powered by TradingView.</p>
      </motion.div>

      {/* Controls */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <select
              value={symbol.label}
              onChange={(e) => {
                const found = CHART_SYMBOLS.find((s) => s.label === e.target.value)
                if (found) setSymbol(found)
              }}
              className="text-sm px-2 py-1.5 rounded-md border bg-background"
            >
              {CHART_SYMBOLS.map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
            </select>
          </div>

          <div className="flex gap-1">
            {INTERVALS.map((i) => (
              <button
                key={i.value}
                onClick={() => setInterval(i)}
                className={cn(
                  'px-2 py-1.5 text-xs rounded-md border',
                  interval.value === i.value ? 'bg-blue-500 text-white border-blue-500' : 'hover:bg-accent'
                )}
              >{i.label}</button>
            ))}
          </div>

          <div className="flex gap-1">
            {(['candles', 'line', 'area', 'bars'] as const).map((t) => {
              const Icon = t === 'candles' ? CandlestickChart : t === 'line' ? LineChart : t === 'area' ? Activity : BarChart3
              return (
                <button
                  key={t}
                  onClick={() => setChartType(t)}
                  className={cn(
                    'p-1.5 rounded-md border',
                    chartType === t ? 'bg-blue-500 text-white border-blue-500' : 'hover:bg-accent'
                  )}
                  title={t}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              )
            })}
          </div>

          <div className="flex gap-1">
            {THEMES.map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={cn(
                  'px-2 py-1 text-xs rounded-md border capitalize',
                  theme === t ? 'bg-blue-500 text-white border-blue-500' : 'hover:bg-accent'
                )}
              >{t}</button>
            ))}
          </div>

          <Badge variant="outline" className="ml-auto text-[10px]">
            {symbol.tv}
          </Badge>
        </CardContent>
      </Card>

      {/* Chart */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div style={{ height: '70vh', width: '100%' }}>
            <TradingViewChart
              symbol={symbol.tv}
              interval={interval.value}
              theme={theme}
              style={chartStyle}
            />
          </div>
        </CardContent>
      </Card>

      {/* Market overview widget */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Crypto Market</CardTitle></CardHeader>
          <CardContent className="p-0">
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
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Forex Market</CardTitle></CardHeader>
          <CardContent className="p-0">
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
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default TradingViewPage
