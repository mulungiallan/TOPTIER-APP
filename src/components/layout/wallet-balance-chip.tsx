'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Wallet } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { useLiveMarket } from '@/hooks/use-live-market'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const CASH_ASSETS = ['USD', 'EUR', 'KES', 'UGX', 'GBP']
const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD', 'USDTUSD', 'SOLUSD']
const CRYPTO_TO_ASSET: Record<string, string> = {
  BTCUSD: 'BTC', ETHUSD: 'ETH', USDTUSD: 'USDT', SOLUSD: 'SOL',
}

function fmt(n: number): string {
  if (n === 0) return '$0'
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  if (n >= 100) return `$${n.toFixed(0)}`
  return `$${n.toFixed(2)}`
}

export function WalletBalanceChip() {
  const setPage = useStore((s) => s.setPage)
  const token = useStore((s) => s.authToken)
  const [balances, setBalances] = useState<Record<string, number> | null>(null)
  const { prices } = useLiveMarket({
    symbols: CRYPTO_SYMBOLS,
    refreshMs: 60_000,
    enabled: true,
  })

  const priceMap: Record<string, number> = {}
  for (const p of prices) priceMap[p.symbol] = p.price

  const fetchBalance = useCallback(async (signal?: AbortSignal) => {
    if (!token) return
    try {
      const res = await api.get<{ success: boolean; data: { balances: Record<string, number> } }>('/wallet', { signal })
      setBalances(res?.data?.balances || null)
    } catch {
      // silently keeps the last known balance (market data may be offline)
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    const ctrl = new AbortController()
    const load = () => { fetchBalance(ctrl.signal).catch(() => {}) }
    const initialTimer = setTimeout(load, 0)
    const pollTimer = setInterval(load, 60_000)
    return () => { ctrl.abort(); clearTimeout(initialTimer); clearInterval(pollTimer) }
  }, [token, fetchBalance])

  if (!token) return null

  const cashTotal = CASH_ASSETS.reduce((s, a) => s + (balances?.[a] || 0), 0)
  const cryptoUsd = Object.entries(CRYPTO_TO_ASSET).reduce((s, [sym, asset]) => {
    return s + (balances?.[asset] || 0) * (priceMap[sym] || 0)
  }, 0)
  const total = cashTotal + cryptoUsd

  const hasAny = total > 0

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'gap-1.5 rounded-full border px-3 text-xs font-semibold',
        hasAny
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
          : 'border-border bg-background text-muted-foreground hover:bg-muted'
      )}
      onClick={() => setPage('wallet')}
      title="Open wallet"
    >
      <Wallet className="size-3.5" />
      {fmt(total)}
    </Button>
  )
}