// src/hooks/use-live-market.ts
// React hook for fetching live market prices via /api/market/live.
// Polls every 30s by default and gracefully degrades to the caller's
// fallback data if the API is unavailable.

'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

export interface LivePriceItem {
  symbol: string
  price: number
  change: number
  changePercent: number
  high?: number
  low?: number
  open?: number
  previousClose?: number
  volume?: number
  timestamp: string | Date
  source?: 'finnhub' | 'yahoo' | 'mock'
}

interface UseLiveMarketOptions {
  symbols?: string[] // If provided, fetches these symbols via action=quotes
  overview?: boolean // If true, fetches market overview symbols
  refreshMs?: number // Polling interval (default 30s)
  enabled?: boolean // Toggle to pause polling
}

interface UseLiveMarketResult {
  prices: LivePriceItem[]
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
  source: 'finnhub' | 'yahoo' | 'mock' | 'mixed' | null
}

export function useLiveMarket({
  symbols,
  overview = false,
  refreshMs = 30_000,
  enabled = true,
}: UseLiveMarketOptions = {}): UseLiveMarketResult {
  const [prices, setPrices] = useState<LivePriceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchPrices = useCallback(async () => {
    try {
      setError(null)
      let url = '/api/market/live'
      if (overview) {
        url += '?action=market'
      } else if (symbols && symbols.length > 0) {
        url += `?action=quotes&symbols=${encodeURIComponent(symbols.join(','))}`
      } else {
        return
      }

      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = await res.json()
      const items: LivePriceItem[] = json?.data?.prices || []
      setPrices(items)
      setLastUpdated(new Date())
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch live prices')
    } finally {
      setLoading(false)
    }
  }, [overview, symbols?.join(',')])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    fetchPrices()
    timerRef.current = setInterval(fetchPrices, refreshMs)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [enabled, refreshMs, fetchPrices])

  const source: UseLiveMarketResult['source'] = (() => {
    if (prices.length === 0) return null
    const sources = new Set(prices.map(p => p.source).filter(Boolean) as string[])
    if (sources.size === 1) return sources.values().next().value as any
    if (sources.size > 1) return 'mixed'
    return null
  })()

  return {
    prices,
    loading,
    error,
    lastUpdated,
    refresh: fetchPrices,
    source,
  }
}
