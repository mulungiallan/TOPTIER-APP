'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
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
  X,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Capacitor } from '@capacitor/core'

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
  ledger: { balanced: boolean; unbalancedTransactions: string[] }
  assets: { cash: string[]; crypto: string[] }
  cryptoDepositsEnabled: boolean
  transactions: WalletTx[]
  payments: PaymentRecord[]
}

interface PaymentRecord {
  id: string
  amount: number
  currency: string
  planType: string
  paymentMethod: string | null
  paymentProvider: string | null
  status: string
  description: string | null
  createdAt: string
}

interface CryptoDeposit {
  id: string
  asset: string
  amount: number
  payAddress: string
  payAmount: number | null
  paymentId: string
  status: string
  creditedAt: string | null
  createdAt: string
}

const CASH_ASSETS = ['USD', 'EUR', 'KES', 'UGX', 'GBP']
const CRYPTO_ASSETS = ['BTC', 'ETH', 'USDT', 'SOL']

const DEPOSIT_TERMINAL = ['finished', 'expired', 'failed', 'refunded', 'cancelled']
function isOpenDeposit(status?: string): boolean {
  return !!status && !DEPOSIT_TERMINAL.includes(status)
}

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

function paymentLabel(tx: PaymentRecord): string {
  const m = (tx.description || '').match(/^WALLET_FUND\|([A-Z]{3})\|([\d.]+)/)
  if (m) {
    const asset = m[1]
    const tokens = Number(m[2])
    return `Wallet top-up · ${fmt(tokens, asset)} ${asset}`
  }
  const plan = (tx.planType || 'payment').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return plan === 'Payment' ? `Payment${tx.paymentProvider ? ` (${tx.paymentProvider})` : ''}` : plan
}

function paymentBadge(status: string) {
  switch (status) {
    case 'completed':
      return <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">Completed</Badge>
    case 'pending':
      return <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15">Pending</Badge>
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>
    case 'refunded':
      return <Badge variant="secondary">Refunded</Badge>
    default:
      return <Badge variant="secondary" className="capitalize">{status}</Badge>
  }
}

export function WalletPage() {
  const setPage = useStore((s) => s.setPage)
  const [data, setData] = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(true)

  const [deposit, setDeposit] = useState({ asset: 'KES', amount: '' })
  const [withdraw, setWithdraw] = useState({ currency: 'USD', amount: '', toAddress: '', network: 'TRC20', phone: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const [cryptoWithdraw, setCryptoWithdraw] = useState({ amount: '', toAddress: '', network: 'TRC20' })
  const [depositCrypto, setDepositCrypto] = useState({ asset: 'BTC', amount: '' })
  const [activeDeposit, setActiveDeposit] = useState<CryptoDeposit | null>(null)

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
    if (typeof window !== 'undefined' && window.location.search.includes('payment=success')) {
      toast.success('Wallet top-up successful!')
    }
    return () => ctrl.abort()
  }, [fetchData])

  // Poll wallet balance while the PesaPal checkout iframe is open
  useEffect(() => {
    if (!checkoutUrl) return
    let active = true
    const snapshot = data?.balances
    const poll = async () => {
      try {
        const res = await api.get<{ success: boolean; data: WalletData }>('/wallet')
        const fresh = res?.data
        if (!active || !fresh) return
        if (snapshot && JSON.stringify(fresh.balances) !== JSON.stringify(snapshot)) {
          setData(fresh)
          setCheckoutUrl(null)
          toast.success('Wallet top-up successful!')
        }
      } catch { /* keep polling */ }
    }
    const id = setInterval(poll, 4000)
    return () => { active = false; clearInterval(id) }
  }, [checkoutUrl, data?.balances])

  // On native the checkout opens in the system browser — refresh the wallet
  // when the user returns to the app so the new balance shows immediately.
  useEffect(() => {
    let removeAppListener: (() => void) | undefined
    const init = async () => {
      try {
        if (!Capacitor.isNativePlatform()) return
        const { App } = await import('@capacitor/app')
        const plugin = await App.addListener('resume', () => fetchData())
        removeAppListener = () => plugin.remove()
      } catch {
        // Not running inside Capacitor — nothing to listen to.
      }
    }
    init()
    return () => removeAppListener?.()
  }, [fetchData])

  const runAction = async (key: string, body: Record<string, unknown>) => {
    setBusy(key)
    try {
      await api.post('/wallet', body)
      if (key === 'withdraw' || key === 'crypto-withdraw') {
        const cur = key === 'withdraw' ? withdraw.currency : 'USDT'
        if (cur === 'KES') {
          toast.success('M-Pesa payout submitted — money arrives on your M-Pesa within minutes.')
        } else if (cur === 'UGX') {
          toast.success('MTN MoMo payout submitted — money arrives on your MoMo within minutes.')
        } else {
          toast.success('USDT payout submitted — funds are on their way via Binance.')
        }
        setWithdraw({ currency: withdraw.currency, amount: '', toAddress: '', network: 'TRC20', phone: '' })
        setCryptoWithdraw({ amount: '', toAddress: '', network: 'TRC20' })
      } else {
        toast.success(`${key === 'withdraw' ? 'Withdrawal' : 'Action'} recorded`)
      }
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

  const startCryptoDeposit = async () => {
    if (!depositCrypto.amount || Number(depositCrypto.amount) <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    setBusy('crypto-deposit')
    try {
      const res = await api.post<{ success: boolean; data: { deposit: CryptoDeposit } }>('/wallet/crypto-deposit', {
        asset: depositCrypto.asset,
        amount: Number(depositCrypto.amount),
      })
      const deposit = res?.data?.deposit
      if (deposit) {
        setActiveDeposit(deposit)
        setDepositCrypto((p) => ({ ...p, amount: '' }))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/_/g, ' ') : 'Failed to create crypto deposit'
      toast.error(msg)
    } finally {
      setBusy(null)
    }
  }

  // While a deposit is open, poll its status so a completed payment credits
  // the wallet even if the provider webhook was missed.
  useEffect(() => {
    if (!activeDeposit || !isOpenDeposit(activeDeposit.status) || activeDeposit.creditedAt) return
    let active = true
    const poll = async () => {
      try {
        const res = await api.get<{ success: boolean; data: { deposit: CryptoDeposit } }>(
          `/wallet/crypto-deposit/${activeDeposit.id}`
        )
        const fresh = res?.data?.deposit
        if (!active || !fresh) return
        setActiveDeposit((prev) => (prev ? { ...prev, ...fresh } : fresh))
        if (fresh.status === 'finished') {
          toast.success(`${fresh.amount} ${fresh.asset} deposited!`)
          fetchData()
        }
      } catch {
        /* keep polling */
      }
    }
    const id = setInterval(poll, 5000)
    return () => { active = false; clearInterval(id) }
  }, [activeDeposit, fetchData])

const handleTopup = async () => {
    if (!deposit.amount || Number(deposit.amount) <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    setBusy('topup')
    try {
      const res = await api.post<{ success: boolean; data: { payment: { checkoutUrl?: string } } }>('/wallet/fund', {
        asset: deposit.asset,
        amount: Number(deposit.amount),
        provider: 'pesapal',
      })
      const checkoutUrl = res?.data?.payment?.checkoutUrl
      if (checkoutUrl) {
        setDeposit({ asset: deposit.asset, amount: '' })
        if (Capacitor.isNativePlatform()) {
          // The Android/iOS WebView cannot render the third-party PesaPal
          // checkout inside an iframe ("web page not available"). Open it in
          // the system browser instead — the wallet still credits via the
          // callback/IPN and refreshes when the user returns.
          window.open(checkoutUrl, '_system')
          toast.success('Opening payment page — your wallet credits automatically when the payment completes.')
        } else {
          setCheckoutUrl(checkoutUrl)
        }
        return
      }
      toast.success('Top-up request received!')
      setDeposit({ asset: deposit.asset, amount: '' })
      await fetchData()
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/_/g, ' ') : 'Top-up failed'
      toast.error(msg)
    } finally {
      setBusy(null)
    }
  }

  const handleCheckoutLoaded = () => {
    // Payment completion is detected by the polling useEffect above, which
    // refreshes the wallet balance every 4 s while the dialog is open. The
    // iframe's onLoad is retained so we can close the dialog when the user
    // finishes and the page reloads to a same-origin response.
    let search: string | undefined
    try {
      search = iframeRef.current?.contentWindow?.location.search
    } catch {
      return
    }
    if (!search) return
    if (search.includes('payment=success')) {
      setCheckoutUrl(null)
      toast.success('Wallet top-up successful!')
      fetchData()
    } else if (search.includes('payment=failed')) {
      setCheckoutUrl(null)
      toast.error('Top-up was not completed.')
      fetchData()
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
          { label: 'Bitcoin', value: fmt(data?.balances.BTC, 'BTC'), icon: <Bitcoin className="size-5" />, hint: '₿ equivalent' },
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
            {/* Top up via PesaPal */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><ArrowDownToLine className="size-4 text-emerald-500" /> Add funds</CardTitle>
                <CardDescription>Pay with M-Pesa, card, or Airtel Money through PesaPal. Your wallet is credited automatically.</CardDescription>
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

                {deposit.asset !== 'KES' && (
                  <p className="text-xs text-muted-foreground">You will be charged the {deposit.asset} &rarr; KES equivalent via PesaPal.</p>
                )}
                <Button
                  className="w-full gap-1.5"
                  disabled={busy === 'topup' || !deposit.amount || Number(deposit.amount) <= 0}
                  onClick={handleTopup}
                >
                  {busy === 'topup' ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" />}
                  Top Up via PesaPal
                </Button>
              </CardContent>
            </Card>

            {/* Withdraw */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><ArrowUpFromLine className="size-4 text-rose-500" /> Withdraw cash</CardTitle>
                <CardDescription>
                  {withdraw.currency === 'KES' && 'Paid automatically to your M-Pesa (Kenya). You can only withdraw up to your balance.'}
                  {withdraw.currency === 'UGX' && 'Paid automatically to your MTN MoMo (Uganda). You can only withdraw up to your balance.'}
                  {withdraw.currency === 'USD' && 'Paid automatically as USDT (1 USDT = $1) to your wallet address via Binance. You can only withdraw up to your USD balance.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Wallet currency</Label>
                  <select
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    value={withdraw.currency}
                    onChange={(e) => setWithdraw({ ...withdraw, currency: e.target.value })}
                  >
                    <option value="USD">USD → USDT (Binance)</option>
                    <option value="KES">KES → M-Pesa</option>
                    <option value="UGX">UGX → MTN MoMo</option>
                  </select>
                </div>

                {withdraw.currency === 'USD' ? (
                  <>
                    <div className="space-y-1.5">
                      <Label>USDT receiving address (TRC20 or BEP20)</Label>
                      <Input placeholder="T… or 0x…" value={withdraw.toAddress}
                        onChange={(e) => setWithdraw({ ...withdraw, toAddress: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Network</Label>
                        <select
                          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                          value={withdraw.network}
                          onChange={(e) => setWithdraw({ ...withdraw, network: e.target.value })}
                        >
                          <option value="TRC20">TRC20 (TRON)</option>
                          <option value="BEP20">BEP20 (BSC)</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Amount (USD)</Label>
                        <Input
                          type="number" min="0" step="any" placeholder="0.00"
                          value={withdraw.amount}
                          onChange={(e) => setWithdraw({ ...withdraw, amount: e.target.value })}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>{withdraw.currency === 'KES' ? 'M-Pesa phone' : 'MTN MoMo phone'}</Label>
                      <Input
                        placeholder={withdraw.currency === 'KES' ? '0712 345 678' : '0772 345 678'}
                        inputMode="tel"
                        value={withdraw.phone}
                        onChange={(e) => setWithdraw({ ...withdraw, phone: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Amount ({withdraw.currency})</Label>
                      <Input
                        type="number" min="0" step="any" placeholder="0.00"
                        value={withdraw.amount}
                        onChange={(e) => setWithdraw({ ...withdraw, amount: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <Button
                  variant="outline"
                  className="w-full gap-1.5"
                  disabled={
                    busy === 'withdraw' ||
                    !withdraw.amount ||
                    Number(withdraw.amount) <= 0 ||
                    (withdraw.currency === 'USD' ? !withdraw.toAddress : !withdraw.phone)
                  }
                  onClick={() =>
                    withdraw.currency === 'USD'
                      ? runAction('withdraw', {
                          action: 'withdraw',
                          asset: 'USD',
                          amount: Number(withdraw.amount),
                          toAddress: withdraw.toAddress,
                          network: withdraw.network,
                        })
                      : runAction('withdraw', {
                          action: 'withdraw',
                          asset: withdraw.currency,
                          amount: Number(withdraw.amount),
                          phone: withdraw.phone,
                        })
                  }
                >
                  {busy === 'withdraw' ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpFromLine className="size-4" />}
                  Withdraw {withdraw.currency === 'USD' ? 'as USDT' : withdraw.currency}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Balance: {fmt(data?.balances[withdraw.currency], withdraw.currency)} {withdraw.currency}
                  {withdraw.currency === 'USD' ? ' — the full amount is paid, the network fee is covered by the platform.' : ' — the transfer fee is covered by the platform.'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Top-up & payment history */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top-up &amp; payment history</CardTitle>
              <CardDescription>Your recent wallet top-ups and payments. Funds reflect once the provider confirms them.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : !data?.payments?.length ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No payments yet — your first top-up will appear here.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Description</th>
                        <th className="pb-2 pr-4 text-right font-medium">Charged</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.payments.map((p) => (
                        <tr key={p.id} className="hover:bg-muted/30">
                          <td className="py-2.5 pr-4 font-medium">{paymentLabel(p)}</td>
                          <td className="py-2.5 pr-4 text-right">
                            {assetSymbol(p.currency)}{fmt(p.amount, p.currency)}
                          </td>
                          <td className="py-2.5 pr-4">{paymentBadge(p.status)}</td>
                          <td className="py-2.5 text-xs text-muted-foreground">
                            {new Date(p.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Crypto tab ───────────────────────────────────────────── */}
        <TabsContent value="crypto" className="space-y-4 pt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Deposit crypto */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><ArrowDownToLine className="size-4 text-emerald-500" /> Deposit crypto</CardTitle>
                <CardDescription>Send crypto to the generated address — your wallet is credited automatically once the network confirms.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {data && !data.cryptoDepositsEnabled ? (
                  <p className="text-sm text-muted-foreground">
                    Crypto deposits aren't available yet — use the cash top-up above.
                  </p>
                ) : !activeDeposit ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Asset</Label>
                        <select
                          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                          value={depositCrypto.asset}
                          onChange={(e) => setDepositCrypto({ ...depositCrypto, asset: e.target.value })}
                        >
                          {CRYPTO_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Amount</Label>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="0.0"
                          value={depositCrypto.amount}
                          onChange={(e) => setDepositCrypto({ ...depositCrypto, amount: e.target.value })}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {depositCrypto.asset === 'USDT' ? 'Received on TRON (TRC-20).' : `${depositCrypto.asset} on its native network.`} Only send the network's own asset to the address.
                    </p>
                    <Button
                      className="w-full gap-1.5"
                      disabled={busy === 'crypto-deposit' || !depositCrypto.amount || Number(depositCrypto.amount) <= 0}
                      onClick={startCryptoDeposit}
                    >
                      {busy === 'crypto-deposit' ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" />}
                      Start crypto deposit
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2 rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Send to this address</Label>
                        <Badge variant={activeDeposit.status === 'finished' ? 'outline' : 'secondary'} className="capitalize">
                          {activeDeposit.creditedAt ? 'credited' : activeDeposit.status.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
                        <code className="flex-1 break-all text-xs text-muted-foreground">{activeDeposit.payAddress}</code>
                        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => copyAddress(activeDeposit.payAddress)}>
                          <Copy className="size-3.5" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Send exactly{' '}
                        <span className="font-semibold text-foreground">
                          {activeDeposit.payAmount != null ? activeDeposit.payAmount : activeDeposit.amount} {activeDeposit.asset}
                        </span>
                        {activeDeposit.asset === 'USDT' ? ' on TRON (TRC-20)' : ` on the ${activeDeposit.asset} network`}.
                      </p>
                    </div>

                    {isOpenDeposit(activeDeposit.status) && !activeDeposit.creditedAt ? (
                      <p className="text-center text-xs text-muted-foreground">
                        Waiting for your payment to be confirmed — this refreshes automatically.
                      </p>
                    ) : activeDeposit.creditedAt ? (
                      <p className="text-center text-xs text-emerald-500">Deposit credited ✓</p>
                    ) : (
                      <p className="text-center text-xs text-rose-500">Deposit {activeDeposit.status.replace(/_/g, ' ')}.</p>
                    )}

                    <Button variant="outline" className="w-full gap-1.5" onClick={() => setActiveDeposit(null)}>
                      <ArrowDownToLine className="size-4" /> Make another deposit
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Withdraw crypto */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><ArrowUpFromLine className="size-4 text-rose-500" /> Withdraw USDT</CardTitle>
                <CardDescription>Sent automatically to your address via Binance. BTC/ETH/SOL withdrawals are not available yet.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Network</Label>
                    <select
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      value={cryptoWithdraw.network}
                      onChange={(e) => setCryptoWithdraw({ ...cryptoWithdraw, network: e.target.value })}
                    >
                      <option value="TRC20">TRC20 (TRON)</option>
                      <option value="BEP20">BEP20 (BSC)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Amount (USDT)</Label>
                    <Input type="number" min="0" step="any" placeholder="0.0" value={cryptoWithdraw.amount}
                      onChange={(e) => setCryptoWithdraw({ ...cryptoWithdraw, amount: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Destination address</Label>
                  <Input placeholder="T… or 0x…" value={cryptoWithdraw.toAddress}
                    onChange={(e) => setCryptoWithdraw({ ...cryptoWithdraw, toAddress: e.target.value })} />
                </div>
                <Button
                  className="w-full gap-1.5"
                  disabled={busy === 'crypto-withdraw' || !cryptoWithdraw.amount || Number(cryptoWithdraw.amount) <= 0 || !cryptoWithdraw.toAddress}
                  onClick={() =>
                    runAction('crypto-withdraw', {
                      action: 'crypto-withdraw',
                      asset: 'USDT',
                      amount: Number(cryptoWithdraw.amount),
                      toAddress: cryptoWithdraw.toAddress,
                      network: cryptoWithdraw.network,
                    })
                  }
                >
                  {busy === 'crypto-withdraw' ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpFromLine className="size-4" />}
                  Withdraw USDT
                </Button>
                <p className="text-xs text-muted-foreground">
                  Balance: {fmt(data?.balances.USDT, 'USDT')} — send the full balance or less, the network fee is covered by the platform.
                </p>
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

      {/* ─── PesaPal payment sheet (in-app, no redirect) ─────────── */}
      <Dialog
        open={!!checkoutUrl}
        onOpenChange={(open) => {
          if (!open) setCheckoutUrl(null)
        }}
      >
        <DialogContent
          showCloseButton={false}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="max-h-[92vh] w-full max-w-xl gap-0 overflow-hidden border bg-background p-0 sm:max-w-xl"
        >
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
              <p className="truncate text-sm font-semibold">Secure payment — PesaPal</p>
            </div>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => setCheckoutUrl(null)}>
              <X className="size-4" />
            </Button>
          </div>
          <iframe
            ref={iframeRef}
            src={checkoutUrl || undefined}
            title="PesaPal checkout"
            className="h-[68vh] w-full bg-background"
            onLoad={handleCheckoutLoaded}
          />
          <p className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
            A payment prompt may appear on your phone — enter your PIN to complete. You can close this window; your wallet still gets credited.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}