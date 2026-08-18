'use client'

import { useState, useCallback, useEffect } from 'react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import type { AdSettings } from '@/lib/ads'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertTriangle, Copy, Landmark, ShieldAlert, Wallet, Bitcoin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const AD_GRADIENTS = [
  'from-indigo-500 via-purple-500 to-pink-500',
  'from-emerald-500 via-teal-500 to-cyan-500',
  'from-orange-500 via-amber-500 to-yellow-400',
  'from-rose-500 via-red-500 to-orange-500',
  'from-blue-600 via-indigo-600 to-violet-600',
  'from-slate-700 via-slate-600 to-zinc-800',
]

interface Balance {
  available: number
  paid: number
  currency: string
}

interface Earning {
  id: string
  source: string
  amount: number
  currency: string
  status: string
  reference?: string | null
  createdAt: string
}

interface PayoutAccount {
  id: string
  method: string
  details: string
  isDefault: boolean
}

interface PayoutRequest {
  id: string
  method: string
  destination: string
  amount: number
  currency: string
  status: string
  txHash?: string | null
  failureReason?: string | null
  createdAt: string
  account: { method: string }
}

interface EarningsBySource {
  source: string
  total: number
  available: number
  paid: number
}

const sourceLabel: Record<string, string> = {
  premium_payment: 'Premium payment',
  copy_fee: 'Copy trading fee (10%)',
  referral_revenue: 'Referral revenue',
  bot_profit_share: 'Bot profit share',
  ads_revenue: 'Ad revenue',
}

const sourceSummary: Record<string, { title: string; subtitle: string; gradient: string }> = {
  copy_fee: { title: 'Copy Trading', subtitle: 'Platform fee on copied trades', gradient: 'from-violet-500 to-purple-600' },
  referral_revenue: { title: 'Referrals', subtitle: 'Referred members’ premium payments', gradient: 'from-emerald-500 to-teal-600' },
  bot_profit_share: { title: 'Bot', subtitle: 'Profit share from trading bots', gradient: 'from-sky-500 to-indigo-600' },
  premium_payment: { title: 'Premium', subtitle: 'Direct premium subscriptions', gradient: 'from-amber-500 to-orange-600' },
  ads_revenue: { title: 'Ads', subtitle: 'Ad placements', gradient: 'from-rose-500 to-pink-600' },
}

const statusBadge: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-500',
  processing: 'bg-sky-500/15 text-sky-500',
  paid: 'bg-emerald-500/15 text-emerald-500',
  failed: 'bg-red-500/15 text-red-500',
  cancelled: 'bg-muted text-muted-foreground',
  available: 'bg-emerald-500/15 text-emerald-500',
  due: 'bg-amber-500/15 text-amber-500',
}

export function MonetizationPage() {
  const { user } = useStore()
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'

  const [balance, setBalance] = useState<Balance>({ available: 0, paid: 0, currency: 'USD' })
  const [earnings, setEarnings] = useState<Earning[]>([])
  const [summaryBySource, setSummaryBySource] = useState<EarningsBySource[]>([])
  const [accounts, setAccounts] = useState<PayoutAccount[]>([])
  const [requests, setRequests] = useState<PayoutRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [ledgerFilter, setLedgerFilter] = useState<string>('all')

  // Payout form
  const [method, setMethod] = useState<'binance' | 'bank'>('binance')
  const [address, setAddress] = useState('')
  const [network, setNetwork] = useState('TRC20')
  const [memo, setMemo] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [bankName, setBankName] = useState('')
  const [swift, setSwift] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')

  // Ads
  const [ads, setAds] = useState<AdSettings | null>(null)

  const fetchPayouts = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: any }>('/payouts')
      const d = (res as any)?.data ?? res
      setBalance(d.balance)
      setEarnings(d.earnings || [])
      setAccounts(d.accounts || [])
      setRequests(d.requests || [])
      setSummaryBySource(d.summaryBySource || [])
    } catch (err: any) {
      setAccessError(err?.message || 'Failed to load payout data')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAds = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: AdSettings }>('/ads/config')
      const d = (res as any)?.data ?? res
      setAds(d)
    } catch {
      // ads config is optional
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    fetchPayouts()
    fetchAds()
  }, [isAdmin, fetchPayouts, fetchAds])

  if (!isAdmin) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
        <Card className="border-red-500/40">
          <CardContent className="flex items-start gap-3 p-5">
            <ShieldAlert className="mt-0.5 size-5 text-red-500" />
            <div>
              <p className="font-medium text-foreground">Admin access required</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Only platform admins can manage payouts and ad settings.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-2xl bg-muted" />
      </div>
    )
  }

  const filteredEarnings = ledgerFilter === 'all' ? earnings : earnings.filter((e) => e.source === ledgerFilter)

  const saveAccount = async () => {
    try {
      const details =
        method === 'binance' ? { address, network, memo } : { accountName, accountNumber, bankName, swift }
      await api.post('/payouts/account', { method, details })
      toast.success('Payout account saved')
      fetchPayouts()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save payout account')
    }
  }

  const withdraw = async () => {
    const amount = Number(withdrawAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    try {
      const res = await api.post<{ success: boolean; message?: string }>('/payouts/withdraw', { amount })
      const message = (res as any)?.message
      toast.success(message || 'Payout created')
      setWithdrawAmount('')
      fetchPayouts()
    } catch (err: any) {
      toast.error(err?.message || 'Withdrawal failed')
    }
  }

  const payoutAction = async (requestId: string, action: 'mark_paid' | 'cancel') => {
    try {
      await api.post('/payouts/action', { requestId, action })
      toast.success(action === 'mark_paid' ? 'Payout marked as paid' : 'Payout cancelled')
      fetchPayouts()
    } catch (err: any) {
      toast.error(err?.message || 'Action failed')
    }
  }

  const saveAds = async () => {
    if (!ads) return
    try {
      await api.put('/ads/config', {
        enabled: ads.enabled,
        provider: ads.provider,
        adSenseClientId: ads.adSenseClientId,
        adSenseSlotId: ads.adSenseSlotId,
        customBannerImage: ads.customBannerImage,
        customBannerLink: ads.customBannerLink,
        customBannerAlt: ads.customBannerAlt,
        bannerEnabled: ads.bannerEnabled,
        interstitialEnabled: ads.interstitialEnabled,
        stepFrequency: ads.stepFrequency,
        freeUsersOnly: ads.freeUsersOnly,
        rewardedEnabled: ads.rewardedEnabled,
        rewardedTitle: ads.rewardedTitle,
        rewardedDescription: ads.rewardedDescription,
        rewardedCta: ads.rewardedCta,
        rewardedLink: ads.rewardedLink,
        rewardedEmoji: ads.rewardedEmoji,
        rewardedGradient: ads.rewardedGradient,
        rewardedDuration: ads.rewardedDuration,
      })
      toast.success('Ad settings saved — live for free users')
      fetchAds()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save ad settings')
    }
  }

  const setAd = <K extends keyof AdSettings>(key: K, value: AdSettings[K]) => {
    setAds((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Monetization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your earnings, payout destination and ad placements.
        </p>
      </div>

      {accessError ? (
        <Card className="border-red-500/40">
          <CardContent className="p-5 text-sm text-red-500">{accessError}</CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="payouts" className="w-full">
        <TabsList className="flex flex-wrap gap-1 h-auto p-1">
          <TabsTrigger value="payouts" className="gap-1.5 text-xs">Payouts</TabsTrigger>
          <TabsTrigger value="ads" className="gap-1.5 text-xs">Ads</TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1.5 text-xs">Earnings Ledger</TabsTrigger>
        </TabsList>

        {/* ─── Payouts ─────────────────────────────────────────────── */}
        <TabsContent value="payouts" className="space-y-4 mt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="size-4 text-emerald-500" />
                  Available Balance
                </CardTitle>
                <CardDescription>Earnings ready to be paid out.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="font-display text-4xl font-bold">${balance.available.toFixed(2)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Includes all completed premium payments, copy-trading fees and ad revenue.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Already Paid Out</CardTitle>
                <CardDescription>Total earnings sent to your payout account.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="font-display text-4xl font-bold">${balance.paid.toFixed(2)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Earnings by category — copy trading, referrals and bot kept separate */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {summaryBySource.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                  No earnings yet — copy-trading fees, referral revenue and bot profit share will appear here automatically.
                </CardContent>
              </Card>
            ) : (
              summaryBySource.map((s) => {
                const meta = sourceSummary[s.source]
                return (
                  <Card key={s.source}>
                    <CardContent className="p-4">
                      <div className={`inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r ${meta?.gradient || 'from-slate-600 to-slate-700'} px-2.5 py-1 text-[11px] font-medium text-white`}>
                        {meta?.title || sourceLabel[s.source] || s.source}
                      </div>
                      <div className="mt-3 font-display text-2xl font-bold tabular-nums">
                        ${s.total.toFixed(2)}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{meta?.subtitle}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        ${s.available.toFixed(2)} available · ${s.paid.toFixed(2)} paid
                      </p>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Account setup */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Landmark className="size-4 text-[#1b4f9c]" />
                  Payout Destination
                </CardTitle>
                <CardDescription>
                  Choose where your platform earnings are sent. Binance (USDT) is instant and automatic — bank
                  is slower but regulated.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-1">
                  {(['binance', 'bank'] as const).map((m) => (
                    <Button
                      key={m}
                      variant={method === m ? 'default' : 'outline'}
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setMethod(m)}
                    >
                      {m === 'binance' ? <Bitcoin className="size-4" /> : <Landmark className="size-4" />}
                      {m === 'binance' ? 'Binance (USDT)' : 'Bank account'}
                    </Button>
                  ))}
                </div>

                {method === 'binance' ? (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">USDT receiving address</label>
                      <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="T... or 0x... (Binance deposit address)" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Network</label>
                      <Select value={network} onValueChange={setNetwork}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TRC20">TRC20 (Tron)</SelectItem>
                          <SelectItem value="BEP20">BEP20 (BNB Chain)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Memo / tag (optional)</label>
                      <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Only for exchange deposit memos" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Account name</label>
                      <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Full account holder name" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Account number / IBAN</label>
                      <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Bank name</label>
                      <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">SWIFT / routing (optional)</label>
                      <Input value={swift} onChange={(e) => setSwift(e.target.value)} />
                    </div>
                  </>
                )}

                <Button onClick={saveAccount} className="w-full">Save payout destination</Button>

                {accounts.length > 0 ? (
                  <div className="space-y-1.5">
                    {accounts.map((acc) => {
                      let d: Record<string, unknown> = {}
                      try { d = JSON.parse(acc.details || '{}') } catch { /* corrupted */ }
                      const label =
                        acc.method === 'binance'
                          ? `Binance · ${String(d.address).slice(0, 6)}...${String(d.address).slice(-4)} (${d.network})`
                          : `Bank · ${d.bankName} •••• ${String(d.accountNumber).slice(-4)}`
                      return (
                        <div key={acc.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                          <span className="flex items-center gap-2">
                            {acc.method === 'binance' ? <Bitcoin className="size-4 text-[#f0b90b]" /> : <Landmark className="size-4" />}
                            {label}
                          </span>
                          {acc.isDefault ? <Badge variant="outline">Default</Badge> : null}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No payout destination set yet — add one above to receive earnings.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Withdraw */}
            <Card>
              <CardHeader>
                <CardTitle>Withdraw Earnings</CardTitle>
                <CardDescription>
                  Payouts to Binance (USDT) are submitted to your Binance account automatically.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Amount (USD)</label>
                  <Input
                    type="number"
                    min={1}
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder={`Available: $${balance.available.toFixed(2)}`}
                  />
                </div>
                <Button onClick={withdraw} className="w-full" disabled={balance.available <= 0}>
                  {method === 'binance' ? 'Send USDT instantly' : 'Request bank payout'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Binance withdrawals run on the TRC20/BEP20 network configured above. To enable fully automatic
                  transfers set your Binance API keys (BINANCE_API_KEY / BINANCE_API_SECRET) on the server —
                  otherwise the payout request shows the destination for a one-tap manual transfer.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Payout history */}
          <Card>
            <CardHeader>
              <CardTitle>Payout History</CardTitle>
            </CardHeader>
            <CardContent>
              {requests.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No payouts yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Destination</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requests.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                          <TableCell className="capitalize">{r.method}</TableCell>
                          <TableCell className="text-xs font-mono">{r.destination}</TableCell>
                          <TableCell className="font-mono">${r.amount.toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusBadge[r.status] || ''}>
                              {r.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {r.status === 'pending' || r.status === 'processing' ? (
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="outline" onClick={() => payoutAction(r.id, 'mark_paid')}>
                                  Mark paid
                                </Button>
                                {r.status === 'pending' ? (
                                  <Button size="sm" variant="ghost" onClick={() => payoutAction(r.id, 'cancel')}>
                                    Cancel
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Ads ─────────────────────────────────────────────────── */}
        <TabsContent value="ads" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Copy className="size-4 text-[#1b4f9c]" />
                Ad Placements
              </CardTitle>
              <CardDescription>
                Ads run on every app step for free users: a persistent banner plus an interstitial every N
                pages. Your revenue opportunity while the app is free.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="text-sm font-medium">Ads enabled</p>
                  <p className="text-xs text-muted-foreground">Master switch for all ad placements.</p>
                </div>
                <Switch checked={ads?.enabled ?? false} onCheckedChange={(v) => setAd('enabled', v)} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Provider</label>
                  <Select value={ads?.provider || 'none'} onValueChange={(v) => setAd('provider', v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (no external ads)</SelectItem>
                      <SelectItem value="custom">Custom banner (your own ad)</SelectItem>
                      <SelectItem value="google">Google AdSense</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Interstitial frequency</label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={ads?.stepFrequency ?? 5}
                    onChange={(e) => setAd('stepFrequency', Math.max(1, Math.min(100, Number(e.target.value) || 5)))}
                  />
                  <p className="text-xs text-muted-foreground">Show a full-screen ad every N page steps.</p>
                </div>
              </div>

              {ads?.provider === 'google' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">AdSense client ID</label>
                    <Input value={ads.adSenseClientId || ''} onChange={(e) => setAd('adSenseClientId', e.target.value)} placeholder="ca-pub-XXXXXXXXXXXXXXXX" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Ad slot ID</label>
                    <Input value={ads.adSenseSlotId || ''} onChange={(e) => setAd('adSenseSlotId', e.target.value)} placeholder="1234567890" />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    AdSense fills ads automatically once your account is approved. Until then the reserved ad
                    units show an honest placeholder.
                  </p>
                </div>
              ) : null}

              {ads?.provider === 'custom' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Banner image URL</label>
                    <Input value={ads.customBannerImage || ''} onChange={(e) => setAd('customBannerImage', e.target.value)} placeholder="https://..." />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Click-through link</label>
                    <Input value={ads.customBannerLink || ''} onChange={(e) => setAd('customBannerLink', e.target.value)} placeholder="https://..." />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Alt text</label>
                    <Input value={ads.customBannerAlt || ''} onChange={(e) => setAd('customBannerAlt', e.target.value)} />
                  </div>
                </div>
              ) : null}

              <Separator />

              {/* ─── Rewarded AdFlow (analysis gate) ─────────────────────── */}
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div>
                    <p className="text-sm font-medium">Rewarded ads (analysis gate)</p>
                    <p className="text-xs text-muted-foreground">
                      Free users must watch 10 ad steps to unlock each Screenshot Analysis. The gate stays
                      off until you fill in a title and link below.
                    </p>
                  </div>
                  <Switch
                    checked={ads?.rewardedEnabled ?? false}
                    onCheckedChange={(v) => setAd('rewardedEnabled', v)}
                  />
                </div>

                {ads?.rewardedEnabled ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Ad title</label>
                      <Input value={ads.rewardedTitle || ''} onChange={(e) => setAd('rewardedTitle', e.target.value)} placeholder="Sponsored by ACME Trading" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">CTA label</label>
                      <Input value={ads.rewardedCta || ''} onChange={(e) => setAd('rewardedCta', e.target.value)} placeholder="Learn More" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Click-through link</label>
                      <Input value={ads.rewardedLink || ''} onChange={(e) => setAd('rewardedLink', e.target.value)} placeholder="https://..." />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Emoji</label>
                      <Input value={ads.rewardedEmoji || ''} onChange={(e) => setAd('rewardedEmoji', e.target.value)} placeholder="📈" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground">Description</label>
                      <Input value={ads.rewardedDescription || ''} onChange={(e) => setAd('rewardedDescription', e.target.value)} placeholder="Sponsored message shown during each ad step." />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Seconds per ad step</label>
                      <Input
                        type="number"
                        min={1}
                        max={60}
                        value={ads.rewardedDuration ?? 4}
                        onChange={(e) => setAd('rewardedDuration', Math.max(1, Math.min(60, Number(e.target.value) || 4)))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Gradient</label>
                      <div className="flex flex-wrap gap-1.5">
                        {AD_GRADIENTS.map((g) => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => setAd('rewardedGradient', g)}
                            className={cn(
                              'h-8 w-12 rounded-md bg-gradient-to-br transition',
                              g,
                              (ads.rewardedGradient || AD_GRADIENTS[0]) === g
                                ? 'ring-2 ring-ring ring-offset-2'
                                : 'opacity-70 hover:opacity-100'
                            )}
                            aria-label={`Gradient ${g}`}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="sm:col-span-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                      Live preview:{' '}
                      <span className="font-semibold text-foreground">{ads.rewardedTitle || 'Your ad title'}</span> —{' '}
                      {ads.rewardedDescription || 'Your sponsored message'} ({Math.max(1, ads.rewardedDuration ?? 4)}s
                      per step)
                    </div>
                  </div>
                ) : null}
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div>
                    <p className="text-sm font-medium">Bottom banner</p>
                    <p className="text-xs text-muted-foreground">Persistent strip visible on every step.</p>
                  </div>
                  <Switch checked={ads?.bannerEnabled ?? true} onCheckedChange={(v) => setAd('bannerEnabled', v)} />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div>
                    <p className="text-sm font-medium">Interstitials</p>
                    <p className="text-xs text-muted-foreground">Full-screen ads between steps.</p>
                  </div>
                  <Switch checked={ads?.interstitialEnabled ?? true} onCheckedChange={(v) => setAd('interstitialEnabled', v)} />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div>
                    <p className="text-sm font-medium">Free users only</p>
                    <p className="text-xs text-muted-foreground">Hide ads from paying users.</p>
                  </div>
                  <Switch checked={ads?.freeUsersOnly ?? true} onCheckedChange={(v) => setAd('freeUsersOnly', v)} />
                </div>
              </div>

              <Button onClick={saveAds} className="w-full">Save ad settings</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Ledger ───────────────────────────────────────────────── */}
        <TabsContent value="ledger" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="size-4 text-emerald-500" />
                Earnings Ledger
              </CardTitle>
              <CardDescription>Every earning your platform has accrued, automatically tracked.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Each money stream (copy trading, referrals, bot) is tracked in its own category.
                </p>
                <Select value={ledgerFilter} onValueChange={setLedgerFilter}>
                  <SelectTrigger className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {Array.from(new Set(earnings.map((e) => e.source))).map((src) => (
                      <SelectItem key={src} value={src}>{sourceLabel[src] || src}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {filteredEarnings.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No earnings in this category yet. Completed premium payments, referral revenue, copy-trading fees and bot profit share will appear here automatically.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEarnings.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="text-xs">{new Date(e.createdAt).toLocaleDateString()}</TableCell>
                          <TableCell>{sourceLabel[e.source] || e.source}</TableCell>
                          <TableCell className="font-mono">${e.amount.toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusBadge[e.status] || ''}>
                              {e.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <p className="text-muted-foreground">
              Earnings are tracked in-app. Crypto payouts to your Binance USDT address can run automatically the
              moment you configure your Binance API keys on the server. Bank payouts are processed outside the
              app via your bank portal.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
