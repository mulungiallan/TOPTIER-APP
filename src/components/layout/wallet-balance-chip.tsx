'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Wallet } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const CASH_ASSETS = ['USD', 'EUR', 'KES', 'UGX', 'GBP']
const CRYPTO_ASSETS = ['BTC', 'ETH', 'USDT', 'SOL']

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
  const [usdRates, setUsdRates] = useState<Record<string, number> | null>(null)

  const fetchBalance = useCallback(async (signal?: AbortSignal) => {
    if (!token) return
    try {
      const res = await api.get<{ success: boolean; data: { balances: Record<string, number>; usdRates: Record<string, number> } }>('/wallet', { signal })
      setBalances(res?.data?.balances || null)
      setUsdRates(res?.data?.usdRates || null)
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

  // Every asset is converted to its USD value at the current rate (USD per 1
  // unit) so EUR/KES/UGX/GBP no longer get summed as if they were dollars.
  const rates = usdRates || {}
  const rate = (a: string) => (typeof rates[a] === 'number' && rates[a] > 0 ? rates[a] : 0)
  const cashTotal = CASH_ASSETS.reduce((s, a) => s + (balances?.[a] || 0) * rate(a), 0)
  const cryptoUsd = CRYPTO_ASSETS.reduce((s, a) => s + (balances?.[a] || 0) * rate(a), 0)
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