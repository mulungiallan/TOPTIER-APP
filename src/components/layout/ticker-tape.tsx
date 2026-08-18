'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TickerData {
  tickers: Array<{ id: string; symbol: string; name: string; category: string; priority: number }>
  prices: Record<string, {
    price: number
    change: number
    changePct: number
    direction: 'up' | 'down' | 'neutral'
    source: string
  }>
}

export function TickerTape() {
  const [data, setData] = useState<TickerData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/ticker?limit=20')
      const json = await res.json()
      if (json?.data) setData(json.data)
    } catch {
      // Silent fail — ticker is non-critical
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    // Refresh every 60s
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading || !data || data.tickers.length === 0) {
    return null // Don't render anything while loading or empty
  }

  // Build the ticker items (duplicated for seamless infinite scroll)
  const items = data.tickers
    .map((t) => ({
      symbol: t.symbol,
      price: data.prices[t.symbol]?.price,
      changePct: data.prices[t.symbol]?.changePct,
      direction: data.prices[t.symbol]?.direction || 'neutral',
    }))
    .filter((i) => i.price !== undefined)

  if (items.length === 0) return null

  const renderItem = (item: typeof items[0], key: string) => (
    <div key={key} className="inline-flex items-center gap-1.5 px-4 py-1 text-xs whitespace-nowrap">
      <span className="font-medium">{item.symbol}</span>
      <span className="font-mono tabular-nums text-muted-foreground">
        ${item.price!.toLocaleString(undefined, { maximumFractionDigits: item.price! < 1 ? 5 : 2 })}
      </span>
      {item.direction !== 'neutral' && (
        <span className={cn(
          'inline-flex items-center gap-0.5 font-mono tabular-nums',
          item.direction === 'up' ? 'text-emerald-500' : 'text-rose-500'
        )}>
          {item.direction === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {item.changePct! >= 0 ? '+' : ''}{item.changePct!.toFixed(2)}%
        </span>
      )}
      <span className="text-muted-foreground/40">|</span>
    </div>
  )

  return (
    <div className="relative overflow-hidden border-y bg-card/50 backdrop-blur h-7 flex items-center">
      <div className="flex animate-ticker whitespace-nowrap">
        {items.map((i) => renderItem(i, `a-${i.symbol}`))}
        {items.map((i) => renderItem(i, `b-${i.symbol}`))}
      </div>
      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-ticker {
          animation: ticker 60s linear infinite;
        }
        .animate-ticker:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  )
}
