'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Wallet, ArrowUpRight } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { useLiveMarket } from '@/hooks/use-live-market'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const CASH_ASSETS = ['USD', 'EUR', 'KES', 'UGX', 'GBP']
const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD', 'USDTUSD', 'SOLUSD']
const CRYPTO_TO_ASSET: Record<string, string> = {
  BTCUSD: 'BTC', ETHUSD: 'ETH', USDTUSD: 'USDT', SOLUSD: 'SOL',
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtQty(n: number): string {
  if (n === 0) return '0.00'
  return n.toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? 2 : 6 })
}

export function WalletBalanceCard() {
  const setPage = useStore((s) => s.setPage)
  const token = useStore((s) => s.authToken)
  const [balances, setBalances] = useState<Record<string, number> | null>(null)
  const { prices } = useLiveMarket({
    symbols: CRYPTO_SYMBOLS,
    refreshMs: 60_000,
    enabled: !!token,
  })

  const priceMap: Record<string, number> = {}
  for (const p of prices) priceMap[p.symbol] = p.price

  const fetchBalance = useCallback(async (signal?: AbortSignal) => {
    if (!token) return
    try {
      const res = await api.get<{ success: boolean; data: { balances: Record<string, number> } }>('/wallet', { signal })
      setBalances(res?.data?.balances || null)
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
  const cashTotal = CASH_ASSETS.reduce((s, a) => s + (b[a] || 0), 0)
  const cryptoUsd = Object.entries(CRYPTO_TO_ASSET).reduce((s, [sym, asset]) => {
    return s + (b[asset] || 0) * (priceMap[sym] || 0)
  }, 0)
  const total = cashTotal + cryptoUsd

  const rows = [
    ...CASH_ASSETS.map((asset) => ({ asset, qty: b[asset] || 0, usd: b[asset] || 0 })),
    ...Object.entries(CRYPTO_TO_ASSET).map(([sym, asset]) => ({
      asset,
      qty: b[asset] || 0,
      usd: (b[asset] || 0) * (priceMap[sym] || 0),
    })),
  ]

  return (
    <Card className="overflow-hidden border-emerald-500/30">
      <CardContent className="p-0">
        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500/15 via-teal-500/8 to-transparent p-4 md:p-5">
          <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-emerald-500/10 blur-2xl" />
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-500">
                <Wallet className="size-4" />
                Available Balance
              </div>
              <div className="mt-1 text-3xl font-bold tabular-nums tracking-tight">
                ${fmtMoney(total)}
              </div>
              <p className="text-xs text-muted-foreground">
                Cash &amp; crypto across {rows.filter((r) => r.qty > 0).length || 0} of {rows.length} assets
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => setPage('wallet')}>
                <ArrowUpRight className="size-4" />
                Top up
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage('wallet')}>
                View details
              </Button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {rows.map(({ asset, qty, usd }) => (
              <div key={asset} className="rounded-lg border bg-background/60 p-2.5 backdrop-blur-sm">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{asset}</div>
                <div className="mt-0.5 truncate text-sm font-semibold tabular-nums">{fmtQty(qty)}</div>
                <div className="truncate text-[10px] text-muted-foreground tabular-nums">≈ ${fmtMoney(usd)}</div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}