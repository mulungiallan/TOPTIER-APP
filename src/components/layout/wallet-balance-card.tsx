'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Wallet, ArrowUpRight } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const CASH_ASSETS = ['USD', 'EUR', 'KES', 'UGX', 'GBP']
const CRYPTO_ASSETS = ['BTC', 'ETH', 'USDT', 'SOL']

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function WalletBalanceCard() {
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
      // keeps last known balance (market data may be offline)
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

  const b = balances || {}
  // USD-converted from the live usdRates snapshot (USD per 1 unit of each
  // asset), so non-USD cash and crypto all value correctly in dollars.
  const rates = usdRates || {}
  const rate = (a: string) => (typeof rates[a] === 'number' && rates[a] > 0 ? rates[a] : 0)
  const cashTotal = CASH_ASSETS.reduce((s, a) => s + (b[a] || 0) * rate(a), 0)
  const cryptoUsd = CRYPTO_ASSETS.reduce((s, a) => s + (b[a] || 0) * rate(a), 0)
  const total = cashTotal + cryptoUsd

  return (
    <Card className="overflow-hidden border-emerald-500/30">
      <CardContent className="p-0">
        <div className="relative overflow-hidden bg-gradient-to-r from-emerald-500/15 via-teal-500/8 to-transparent px-4 py-3 md:px-5">
          <div className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full bg-emerald-500/10 blur-2xl" />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-500">
                <Wallet className="size-4" />
                Available Balance
              </div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight leading-tight">
                ${fmtMoney(total)}
              </div>
              <div className="hidden text-[11px] text-muted-foreground sm:block">
                Cash ${fmtMoney(cashTotal)} &middot; Crypto ≈ ${fmtMoney(cryptoUsd)}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" className="gap-1.5" onClick={() => setPage('wallet')}>
                <ArrowUpRight className="size-4" />
                Top up
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage('wallet')}>
                View details
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}