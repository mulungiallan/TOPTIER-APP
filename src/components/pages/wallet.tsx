'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Wallet as WalletIcon,
  Landmark,
  Bitcoin,
  ArrowDownToLine,
  ArrowUpFromLine,
  Copy,
  RefreshCw,
  ShieldCheck,
  Loader2,
  ClipboardCheck,
  Eye,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface WalletLeg {
  asset: string
  accountType: string
  amount: number
}

interface WalletTx {
  id: string
  txType: string
  reference: string | null
  status: string
  memo: string | null
  postedAt: string | null
  createdAt: string
  legs: WalletLeg[]
}

interface WalletData {
  balances: Record<string, number>
  addresses: Record<string, string>
  ledger: { balanced: boolean; unbalancedTransactions: string[] }
  assets: { cash: string[]; crypto: string[] }
  transactions: WalletTx[]
}

const CASH_ASSETS = ['USD', 'EUR', 'KES', 'UGX', 'GBP']
const CRYPTO_ASSETS = ['BTC', 'ETH', 'USDT', 'SOL']

// In-app bank-transfer branch list (mirrors src/lib/payments/bank.ts).
const BANKS = [
  'Absa Bank',
  'Bank of Africa',
  'Co-operative Bank',
  'Diamond Trust Bank',
  'Equity Bank',
  'Family Bank',
  'I&M Bank',
  'KCB Bank',
  'NCBA Bank',
  'Standard Chartered',
  'Stanbic Bank',
  'M-Pesa / M-Pesa Agent',
]

const TX_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  transfer: 'Transfer',
  trade_settlement: 'Trade Settlement',
  fee: 'Fee',
}

function fmt(n: number | undefined, asset: string): string {
  if (n === undefined || n === null) return '—'
  const decimals = asset === 'BTC' ? 8 : asset === 'ETH' ? 6 : 2
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals })
}

function assetSymbol(asset: string): string {
  if (asset === 'USD') return '$'
  if (asset === 'EUR') return '€'
  if (asset === 'GBP') return '£'
  if (asset === 'KES') return 'KSh '
  if (asset === 'UGX') return 'USh '
  return { BTC: '₿', ETH: 'Ξ', USDT: '₮', SOL: '◎' }[asset] || `${asset} `
}

function txSummary(tx: WalletTx): { label: string; color: string; amount: number; asset: string } {
  let userLeg: WalletLeg | undefined = tx.legs.find((l) => l.accountType === 'user')
  const houseLeg = tx.legs.filter((l) => l.accountType === 'user')
  userLeg = userLeg || houseLeg[0]
  const amount = userLeg?.amount || 0
  const positive = amount > 0
  return {
    label: TX_LABELS[tx.txType] || tx.txType.replace(/_/g, ' '),
    color: positive ? 'text-emerald-500' : 'text-rose-500',
    amount,
    asset: userLeg?.asset || 'USD',
  }
}

function iconFor(asset: string, className = 'size-5') {
  if (CRYPTO_ASSETS.includes(asset)) return <Bitcoin className={className} />
  return <Landmark className={className} />
}

export function WalletPage() {
  const setPage = useStore((s) => s.setPage)
  const [data, setData] = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(true)

  const [deposit, setDeposit] = useState({ asset: 'KES', amount: '', method: 'mpesa', phone: '', bank: '', reference: '' })
  const [withdraw, setWithdraw] = useState({ asset: 'USD', amount: '' })
  const [busy, setBusy] = useState<string | null>(null)

  const [cryptoAsset, setCryptoAsset] = useState('BTC')
  const [cryptoWithdraw, setCryptoWithdraw] = useState({ amount: '', toAddress: '' })
  const [cryptoRef, setCryptoRef] = useState({ txHash: '', amount: '' })

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      const res = await api.get<{ success: boolean; data: WalletData }>('/wallet', { signal })
      setData(res?.data || null)
    } catch {
      if (!signal?.aborted) toast.error('Failed to load wallet')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    fetchData(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchData])

  const runAction = async (key: string, body: Record<string, unknown>) => {
    setBusy(key)
    try {
      await api.post('/wallet', body)
      toast.success(`${key === 'deposit' ? 'Deposit' : key === 'withdraw' ? 'Withdrawal' : key === 'crypto-credit' ? 'Crypto credit' : 'Withdrawal'} recorded`)
      setDeposit((d) => ({ ...d, asset: body.asset as string, amount: '', phone: '', bank: '', reference: '' }))
      setWithdraw({ asset: body.asset as string, amount: '' })
      setCryptoRef({ txHash: '', amount: '' })
      await fetchData()
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/_/g, ' ') : 'Action failed'
      toast.error(msg)
    } finally {
      setBusy(null)
    }
  }

  const copyAddress = async (address: string) => {
    if (navigator.clipboard) await navigator.clipboard.writeText(address).catch(() => {})
    toast.success('Address copied')
  }

// Real-money top-up fully in-app. M-Pesa uses the Daraja STK push (the
// customer approves on their phone — no redirect); Bank creates a manual,
// admin-confirmed transfer request. The wallet is credited on confirmation.
const handleTopup = async () => {
    if (!deposit.amount || Number(deposit.amount) <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (deposit.method === 'mpesa') {
      const digits = deposit.phone.replace(/[^0-9]/g, '')
      if (digits.length < 9) {
        toast.error('Enter a valid M-Pesa phone number')
        return
      }
    } else {
      if (!deposit.bank) {
        toast.error('Select your bank')
        return
      }
      if (!deposit.reference.trim()) {
        toast.error('Enter the payment reference')
        return
      }
    }
    setBusy('topup')
    try {
      const body: Record<string, unknown> = {
        asset: deposit.asset,
        amount: Number(deposit.amount),
        provider: deposit.method,
      }
      if (deposit.method === 'mpesa') {
        body.phone = deposit.phone.trim()
      } else {
        body.bank = deposit.bank
        body.reference = deposit.reference.trim()
      }
      const res = await api.post<{ success: boolean; data: { payment: { checkoutUrl?: string } } }>('/wallet/fund', body)
      const checkoutUrl = res?.data?.payment?.checkoutUrl
      if (checkoutUrl && deposit.method !== 'bank' && deposit.method !== 'mpesa') {
        // Legacy redirect gateways only — the in-app chooser never reaches this.
        window.location.href = checkoutUrl
      } else if (deposit.method === 'bank') {
        toast.success('Top-up request received! We will confirm once your transfer arrives.')
      } else {
        toast.success('Payment prompt sent! Enter your M-Pesa PIN on your phone to approve.')
      }
      setDeposit((d) => ({ ...d, amount: '', phone: '', bank: '', reference: '' }))
      await fetchData()
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/_/g, ' ') : 'Top-up failed'
      toast.error(msg)
    } finally {
      setBusy(null)
    }
  }

  const totalCash = (data?.assets.cash || CASH_ASSETS).reduce((s, a) => s + (data?.balances[a] || 0), 0)
  const hasLedgerIssue = data?.ledger && !data.ledger.balanced

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      {/* ─── Hero banner ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 rounded-2xl border bg-gradient-to-r from-emerald-500/10 via-card to-card p-5 md:flex-row md:items-center md:justify-between"
      >
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
            <WalletIcon className="size-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Wallet</h2>
            <p className="text-sm text-muted-foreground">
              Cash + crypto with a <span className="text-emerald-500">self-balancing double-entry ledger</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={hasLedgerIssue ? 'destructive' : 'outline'} className="gap-1.5">
            <ShieldCheck className="size-3.5" />
            {loading ? 'Checking ledger…' : hasLedgerIssue ? 'Ledger unbalanced' : 'Ledger balanced'}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </motion.div>

      {/* ─── Summary cards ───────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Cash', value: fmt(totalCash, 'USD'), icon: <Landmark className="size-5" />, hint: 'USD + EUR + KES + GBP' },
          { label: 'Bitcoin', value: cryptoAsset === 'BTC' ? fmt(data?.balances.BTC, 'BTC') : '—', icon: <Bitcoin className="size-5" />, hint: '₿ equivalent' },
          { label: 'Ethereum', value: fmt(data?.balances.ETH, 'ETH'), icon: <Bitcoin className="size-5" />, hint: 'Ξ equivalent' },
          { label: 'Stable + Sol', value: fmt((data?.balances.USDT || 0) + (data?.balances.SOL || 0), 'USDT'), icon: <WalletIcon className="size-5" />, hint: 'USDT + SOL' },
        ].map((s, i) => (
          <Card key={s.label} className={cn('relative overflow-hidden', i === 0 && 'border-emerald-500/30')}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                {s.icon}
              </div>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-24" />
              ) : (
                <p className="mt-1 text-2xl font-bold tracking-tight">{s.value}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="cash" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="cash" className="gap-1.5"><Landmark className="size-4" /> Cash</TabsTrigger>
          <TabsTrigger value="crypto" className="gap-1.5"><Bitcoin className="size-4" /> Crypto</TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1.5"><ClipboardCheck className="size-4" /> Ledger</TabsTrigger>
        </TabsList>

        {/* ─── Cash tab ─────────────────────────────────────────────── */}
        <TabsContent value="cash" className="space-y-4 pt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            {CASH_ASSETS.map((asset) => (
              <Card key={asset}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {iconFor(asset)} {asset}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-7 w-24" />
                  ) : (
                    <p className="text-2xl font-bold">{assetSymbol(asset)}{fmt(data?.balances[asset], asset)}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">spendable balance</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Top up (fully in-app) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><ArrowDownToLine className="size-4 text-emerald-500" /> Add funds</CardTitle>
                <CardDescription>Top up with M-Pesa (approve on your phone) or a bank transfer that we confirm manually.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Credit asset</Label>
                    <select
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      value={deposit.asset}
                      onChange={(e) => setDeposit({ ...deposit, asset: e.target.value })}
                    >
                      <option value="KES">KES</option>
                      <option value="UGX">UGX</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Amount</Label>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00"
                      value={deposit.amount}
                      onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Method</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['mpesa', 'bank'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDeposit({ ...deposit, method: m })}
                        className={cn(
                          'h-9 rounded-lg border px-3 text-sm font-medium transition-colors',
                          deposit.method === m
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input bg-background text-muted-foreground hover:border-primary/40'
                        )}
                      >
                        {m === 'mpesa' ? 'M-Pesa' : 'Bank Transfer'}
                      </button>
                    ))}
                  </div>
                </div>

                {deposit.method === 'mpesa' ? (
                  <div className="space-y-1.5">
                    <Label>M-Pesa phone number</Label>
                    <Input
                      type="tel"
                      placeholder="07XXXXXXXX"
                      value={deposit.phone}
                      onChange={(e) => setDeposit({ ...deposit, phone: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Approve with your M-Pesa PIN on your phone. No external site is opened.</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label>Send from bank</Label>
                      <select
                        className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                        value={deposit.bank}
                        onChange={(e) => setDeposit({ ...deposit, bank: e.target.value })}
                      >
                        <option value="">Select your bank…</option>
                        {BANKS.map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Payment reference</Label>
                      <Input
                        placeholder="Reference / code from your transfer"
                        value={deposit.reference}
                        onChange={(e) => setDeposit({ ...deposit, reference: e.target.value })}
                      />
                    </div>
                  </>
                )}

                {deposit.asset !== 'KES' && (
                  <p className="text-xs text-muted-foreground">You will be charged the {deposit.asset} → KES equivalent.</p>
                )}
                <Button
                  className="w-full gap-1.5"
                  disabled={busy === 'topup' || !deposit.amount || Number(deposit.amount) <= 0}
                  onClick={handleTopup}
                >
                  {busy === 'topup' ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" />}
                  {deposit.method === 'bank' ? 'Request Top-up' : 'Send Payment Prompt'}
                </Button>
              </CardContent>
            </Card>

            {/* Withdraw */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><ArrowUpFromLine className="size-4 text-rose-500" /> Withdraw cash</CardTitle>
                <CardDescription>Payout back to your bank — rejected if the balance is insufficient.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Asset</Label>
                    <select
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      value={withdraw.asset}
                      onChange={(e) => setWithdraw({ ...withdraw, asset: e.target.value })}
                    >
                      {CASH_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Amount</Label>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00"
                      value={withdraw.amount}
                      onChange={(e) => setWithdraw({ ...withdraw, amount: e.target.value })}
                    />
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full gap-1.5"
                  disabled={busy === 'withdraw' || !withdraw.amount || Number(withdraw.amount) <= 0}
                  onClick={() => runAction('withdraw', { action: 'withdraw', asset: withdraw.asset, amount: Number(withdraw.amount) })}
                >
                  {busy === 'withdraw' ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpFromLine className="size-4" />}
                  Withdraw
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Crypto tab ───────────────────────────────────────────── */}
        <TabsContent value="crypto" className="space-y-4 pt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Deposit address */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Bitcoin className="size-4 text-emerald-500" /> Deposit address</CardTitle>
                <CardDescription>Deterministic mock custody address for your asset.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-end">
                    <select
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      value={cryptoAsset}
                      onChange={(e) => setCryptoAsset(e.target.value)}
                    >
                      {CRYPTO_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Balance</Label>
                    <p className="h-9 flex items-center text-lg font-bold">
                      {assetSymbol(cryptoAsset)}{fmt(data?.balances[cryptoAsset], cryptoAsset)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
                  <code className="flex-1 truncate text-xs text-muted-foreground">
                    {loading ? 'generating…' : data?.addresses[cryptoAsset] || '—'}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={!data?.addresses[cryptoAsset]}
                    onClick={() => copyAddress(data?.addresses[cryptoAsset] || '')}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Crypto credit / withdraw */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Eye className="size-4" /> Balance actions</CardTitle>
                <CardDescription>Credit a confirmed on-chain deposit, or withdraw to any address.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="col-span-2 space-y-1.5">
                      <Label>Asset</Label>
                      <select
                        className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                        value={cryptoAsset}
                        onChange={(e) => setCryptoAsset(e.target.value)}
                      >
                        {CRYPTO_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2 space-y-1.5">
                      <Label>Amount</Label>
                      <Input type="number" min="0" step="any" placeholder="0.0" value={cryptoWithdraw.amount}
                        onChange={(e) => setCryptoWithdraw({ ...cryptoWithdraw, amount: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Destination address</Label>
                    <Input placeholder="bc1q… / 0x… / mock_…" value={cryptoWithdraw.toAddress}
                      onChange={(e) => setCryptoWithdraw({ ...cryptoWithdraw, toAddress: e.target.value })} />
                  </div>
                  <Button
                    className="w-full gap-1.5"
                    disabled={busy === 'crypto-withdraw' || !cryptoWithdraw.amount || Number(cryptoWithdraw.amount) <= 0 || !cryptoWithdraw.toAddress}
                    onClick={() =>
                      runAction('crypto-withdraw', {
                        action: 'crypto-withdraw',
                        asset: cryptoAsset,
                        amount: Number(cryptoWithdraw.amount),
                        toAddress: cryptoWithdraw.toAddress,
                      })
                    }
                  >
                    {busy === 'crypto-withdraw' ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpFromLine className="size-4" />}
                    Withdraw crypto
                  </Button>
                </div>

                <div className="border-t pt-4">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Credit confirmed on-chain deposit</p>
                  <div className="grid grid-cols-[1fr_auto] gap-3">
                    <Input placeholder="tx hash / reference" value={cryptoRef.txHash}
                      onChange={(e) => setCryptoRef({ ...cryptoRef, txHash: e.target.value })} />
                    <Input
                      className="w-28"
                      type="number"
                      step="any"
                      placeholder="amount"
                      value={cryptoRef.amount}
                      onChange={(e) => setCryptoRef({ ...cryptoRef, amount: e.target.value })}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full gap-1.5"
                    disabled={busy === 'crypto-credit' || !cryptoRef.txHash || !cryptoRef.amount}
                    onClick={() =>
                      runAction('crypto-credit', {
                        action: 'crypto-credit',
                        asset: cryptoAsset,
                        amount: Number(cryptoRef.amount),
                        txHash: cryptoRef.txHash,
                      })
                    }
                  >
                    {busy === 'crypto-credit' ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" />}
                    Credit deposit
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Ledger tab ───────────────────────────────────────────── */}
        <TabsContent value="ledger" className="space-y-4 pt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className={cn(hasLedgerIssue ? 'border-rose-500/40' : 'border-emerald-500/30')}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4" /> Double-entry health</CardTitle>
                <CardDescription>Every posting must net to exactly zero.</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-6 w-32" />
                ) : hasLedgerIssue ? (
                  <p className="text-sm font-semibold text-rose-500">
                    {data?.ledger.unbalancedTransactions.length} unbalanced posting(s)
                  </p>
                ) : (
                  <p className="text-sm font-semibold text-emerald-500">All postings balanced ✓</p>
                )}
                <Button variant="ghost" size="sm" className="mt-2 gap-1.5 text-muted-foreground" onClick={() => setPage('wallet')}>
                  <RefreshCw className="size-3.5" /> Recheck
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Transaction log */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transaction history</CardTitle>
              <CardDescription>The complete ledger of postings for this account.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : !data?.transactions.length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No transactions yet — make your first deposit.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Type</th>
                        <th className="pb-2 pr-4 font-medium">Asset</th>
                        <th className="pb-2 pr-4 text-right font-medium">Amount</th>
                        <th className="pb-2 pr-4 font-medium">Reference</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.transactions.map((tx) => {
                        const s = txSummary(tx)
                        return (
                          <tr key={tx.id} className="hover:bg-muted/30">
                            <td className="py-2.5 pr-4">{s.label}</td>
                            <td className="py-2.5 pr-4">{s.asset}</td>
                            <td className={cn('py-2.5 pr-4 text-right font-semibold', s.color)}>
                              {s.amount >= 0 ? '+' : ''}{assetSymbol(s.asset)}{fmt(Math.abs(s.amount), s.asset)}
                            </td>
                            <td className="py-2.5 pr-4">
                              <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{tx.reference || '—'}</code>
                            </td>
                            <td className="py-2.5 pr-4">
                              <Badge variant={tx.status === 'posted' ? 'outline' : 'secondary'}>{tx.status}</Badge>
                            </td>
                            <td className="py-2.5 text-xs text-muted-foreground">
                              {new Date(tx.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}