'use client'

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { LineChart, BarChart3, CandlestickChart, Activity } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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

export function TradingViewPage() {
  const [symbol, setSymbol] = useState(CHART_SYMBOLS[0])
  const [interval, setInterval] = useState(INTERVALS[5])
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [chartType, setChartType] = useState<'candles' | 'line' | 'area' | 'bars'>('candles')

  // Build TradingView embed URL
  const tvUrl = `https://s.tradingview.com/widgetembed/?frameElementId=tradingview_${symbol.label}&symbol=${encodeURIComponent(symbol.tv)}&interval=${interval.value}&theme=${theme}&style=${chartType === 'candles' ? '1' : chartType === 'line' ? '2' : chartType === 'area' ? '3' : '0'}&hideideas=1&saveimage=1&toolbarbg=f1f3f6&studies=[]&hidetoptoolbar=0&hid side-toolbar=0&allow_symbol_change=1&details=1&hotlist=1&calendar=1&width=100%25&height=100%25`

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
          <iframe
            key={`${symbol.tv}-${interval.value}-${chartType}-${theme}`}
            src={tvUrl}
            title={`TradingView ${symbol.label}`}
            className="w-full"
            style={{ height: '70vh', border: 'none' }}
            allow="clipboard-write; fullscreen"
          />
        </CardContent>
      </Card>

      {/* Market overview widget */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Crypto Market</CardTitle></CardHeader>
          <CardContent className="p-0">
            <iframe
              src="https://s.tradingview.com/embed-market-quotes/?theme=dark&width=100%25&height=400"
              title="Crypto Market"
              style={{ width: '100%', height: '400px', border: 'none' }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Forex Market</CardTitle></CardHeader>
          <CardContent className="p-0">
            <iframe
              src="https://s.tradingview.com/embed-market-quotes/?theme=dark&width=100%25&height=400"
              title="Forex Market"
              style={{ width: '100%', height: '400px', border: 'none' }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default TradingViewPage
