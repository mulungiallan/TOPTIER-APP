'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Bot,
  Play,
  Square,
  Trash2,
  RefreshCw,
  Loader2,
  Wallet,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  FileText,
  Activity,
  Plus,
  Link2,
  Landmark,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ReferralLockBanner } from '@/components/referral-lock'
import type { AccountTierInfo } from '@/lib/account-tiers'

interface BotConnection {
  id: string
  platform: string
  label: string
  brokerName: string | null
  login: string
  server: string
  providerSharePct: number
  realizedPnl: number
  grossProfit: number
  tradeCount: number
  runningInstance: boolean
  isCopyMaster?: boolean
  copyMasterHandle?: string | null
  accountBalance?: number | null
  accountCurrency?: string | null
  accountTier?: AccountTierInfo
  createdAt: string
  instances: BotInstance[]
  summary: {
    realizedPnl: number
    grossProfit: number
    providerSharePct: number
    dueAmount: number
    settledProviderAmount: number
  }
}

interface BotInstance {
  id: string
  status: string
  pid: number | null
  lastHeartbeatAt: string | null
  lastError: string | null
  startCount: number
  createdAt: string
}

interface BotTrade {
  id: string
  symbol: string
  timeframe: string | null
  direction: string
  lots: number
  entryPrice: number
  closePrice: number | null
  profit: number
  result: string | null
  openedAt: string
  closedAt: string | null
}

interface Settlement {
  id: string
  connectionId: string
  periodStart: string
  periodEnd: string
  grossProfit: number
  grossLoss: number
  netProfit: number
  providerSharePct: number
  providerAmount: number
  lossCarryforward: number
  status: string
  paidAt: string | null
}

interface OverviewData {
  connections: BotConnection[]
  totals: { totalRealizedPnl: number; totalDue: number; totalTrades: number; runningInstances: number; totalAccounts: number }
  serviceOnline: boolean
}

export function TradingBotPage() {
  const user = useStore((s) => s.user)
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [trades, setTrades] = useState<BotTrade[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [loading, setLoading] = useState(true)
  const [refStatus, setRefStatus] = useState<{ lockEnabled: boolean; unlocked: boolean; referralUrl?: string | null; message?: string | null } | null>(null)
  const [showLink, setShowLink] = useState(false)
  const [linking, setLinking] = useState(false)
  const [busyConnection, setBusyConnection] = useState<string | null>(null)
  const [detailInstance, setDetailInstance] = useState<BotInstance & { label: string; login: string } | null>(null)
  const [instanceDetail, setInstanceDetail] = useState<{ snapshot: any; logs: string[]; online: boolean } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BotConnection | null>(null)
  const [settling, setSettling] = useState<string | null>(null)

  const [form, setForm] = useState({
    platform: 'mt5',
    label: '',
    brokerName: '',
    login: '',
    password: '',
    server: '',
    terminalPath: '',
    riskPerTradePct: 1,
    providerSharePct: 50,
    forexBaseLot: 0.08,
    cryptoBaseLot: 0.04,
    highVolBaseLot: 0.02,
    maxOpenPositions: 3,
  })

  const fetchAll = useCallback(async (signal?: AbortSignal) => {
    try {
      const [ov, tr, ps] = await Promise.all([
        api.get<{ success: boolean; data: OverviewData }>('/bot', { signal }),
        api.get<{ success: boolean; data: { trades: BotTrade[] } }>('/bot/trades?limit=50', { signal }),
        api.get<{ success: boolean; data: { settlements: Settlement[] } }>('/bot/profit-share', { signal }),
      ])
      setOverview(ov?.data || null)
      setTrades(tr?.data?.trades || [])
      setSettlements(ps?.data?.settlements || [])
    } catch {
      if (!signal?.aborted) setOverview((p) => (p ? { ...p, serviceOnline: false } : p))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    fetchAll(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchAll])

  // Referral-gated feature status (bot + copy trading are invite-only)
  useEffect(() => {
    api.get<{ success: boolean; data: any }>('/referral/status')
      .then((res) => setRefStatus(res?.data || null))
      .catch(() => setRefStatus(null))
  }, [])

  const refLocked = !!refStatus && refStatus.lockEnabled && !refStatus.unlocked

  // Light auto-refresh while a bot is running
  const hasRunning = overview?.connections?.some((c) => c.runningInstance) ?? false
  useEffect(() => {
    if (!hasRunning) return
    const t = setInterval(() => { fetchAll() }, 15000)
    return () => clearInterval(t)
  }, [hasRunning, fetchAll])

  const handleLink = async () => {
    if (!form.label || !form.login || !form.password || !form.server) {
      toast.error('Label, login, password and server are required')
      return
    }
    setLinking(true)
    try {
      await api.post('/bot/connections', {
        platform: form.platform,
        label: form.label,
        brokerName: form.brokerName || undefined,
        login: form.login,
        password: form.password,
        server: form.server,
        terminalPath: form.terminalPath || undefined,
        riskPerTradePct: parseFloat(String(form.riskPerTradePct)),
        providerSharePct: parseFloat(String(form.providerSharePct)),
        settings: {
          FOREX_BASE_LOT_PER_100: parseFloat(String(form.forexBaseLot)),
          CRYPTO_BASE_LOT_PER_100: parseFloat(String(form.cryptoBaseLot)),
          HIGH_VOL_BASE_LOT_PER_100: parseFloat(String(form.highVolBaseLot)),
          MAX_OPEN_POSITIONS: parseInt(String(form.maxOpenPositions), 10),
        },
      })
      toast.success('MetaTrader account linked')
      setShowLink(false)
      setForm({ platform: 'mt5', label: '', brokerName: '', login: '', password: '', server: '', terminalPath: '', riskPerTradePct: 1, providerSharePct: 50, forexBaseLot: 0.08, cryptoBaseLot: 0.04, highVolBaseLot: 0.02, maxOpenPositions: 3 })
      fetchAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to link account')
    } finally {
      setLinking(false)
    }
  }

  const handleStart = async (conn: BotConnection) => {
    setBusyConnection(conn.id)
    try {
      await api.post('/bot/instances', { connectionId: conn.id })
      toast.success(`Bot started for ${conn.label}`)
      fetchAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to start bot')
    } finally {
      setBusyConnection(null)
    }
  }

  const handleStop = async (conn: BotConnection) => {
    const inst = conn.instances?.[0]
    if (!inst) return
    setBusyConnection(conn.id)
    try {
      await api.post(`/bot/instances/${inst.id}/stop`, {})
      toast.success(`Bot stopped for ${conn.label}`)
      fetchAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to stop bot')
    } finally {
      setBusyConnection(null)
    }
  }

  const openDetail = async (conn: BotConnection) => {
    const inst = conn.instances?.[0]
    if (!inst) return
    setDetailInstance({ ...inst, label: conn.label, login: conn.login })
    setInstanceDetail(null)
    try {
      const res = await api.get<{ success: boolean; data: { instance: BotInstance; snapshot: any; logs: string[]; online: boolean } }>(`/bot/instances/${inst.id}?tail=300`)
      setInstanceDetail(res?.data || null)
    } catch {
      setInstanceDetail({ snapshot: null, logs: [], online: false })
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.delete(`/bot/connections/${deleteTarget.id}`)
      toast.success('Account removed')
      setDeleteTarget(null)
      fetchAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  const handleSettle = async (connId: string) => {
    setSettling(connId)
    try {
      const res = await api.post<{ success: boolean; data: { settlement: Settlement } }>('/bot/profit-share', { connectionId: connId })
      toast.success('Profit share settled for the current period')
      fetchAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to settle')
    } finally {
      setSettling(null)
    }
  }

  const totals = overview?.totals
  const running = overview?.connections?.filter((c) => c.runningInstance).length ?? 0
  const due = overview?.connections?.reduce((a, c) => a + (c.summary?.dueAmount ?? 0), 0) ?? 0
  const realized = overview?.connections?.reduce((a, c) => a + (c.summary?.realizedPnl ?? 0), 0) ?? 0

  if (refLocked) {
    return (
      <div className="space-y-5 p-3 md:p-4 max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-7 w-7 text-[#1b4f9c]" />
            Trading Bot
          </h1>
        </motion.div>
        <ReferralLockBanner message={refStatus?.message} referralUrl={refStatus?.referralUrl} />
      </div>
    )
  }

  return (
    <div className="space-y-5 p-3 md:p-4 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-7 w-7 text-[#1b4f9c]" />
            Trading Bot
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Link your MetaTrader 5/4 account and let the AI bot trade it 24/7. You keep 100% of the account — TOPTIER earns a {overview?.connections?.[0]?.providerSharePct ?? 50}% share of every winning trade, long and short.
          </p>
        </div>
        <Button onClick={() => setShowLink(true)}>
          <Link2 className="h-4 w-4 mr-1.5" />
          Link MT5 / MT4
        </Button>
      </motion.div>

      {overview && !overview.serviceOnline && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300/50 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Bot service is offline.</span>{' '}
            The app cannot reach the trading bot service. Make sure the bot service is running on the server and that <code className="font-mono text-xs">BOT_SERVICE_URL</code> in the app&apos;s environment points to it (see <code className="font-mono text-xs">deploy/bot/README.md</code>), then refresh.
          </div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <StatCard label="Accounts Linked" value={String(totals?.totalAccounts ?? overview?.connections?.length ?? 0)} />
        <StatCard label="Bots Running" value={String(running)} highlight={running > 0 ? 'good' : undefined} />
        <StatCard label="Realized P&L" value={`$${realized.toFixed(2)}`} highlight={realized >= 0 ? 'good' : 'bad'} />
        <StatCard label="Profit Share Due" value={`$${due.toFixed(2)}`} highlight={due > 0 ? 'good' : undefined} />
      </div>

      {loading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (overview?.connections?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <Bot className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p className="font-medium text-foreground">No MetaTrader accounts linked yet</p>
            <p className="text-sm mt-1">Link your MT5 or MT4 account to let the bot trade for you.</p>
            <div className="flex flex-col items-center gap-2 mt-4">
              <Button onClick={() => setShowLink(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> Link your first account
              </Button>
              <a
                href={process.env.NEXT_PUBLIC_BROKER_REFERRAL_URL || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#1b4f9c] hover:underline inline-flex items-center gap-1"
              >
                Don&apos;t have an MT5 account? Open one here <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Linked Accounts</CardTitle>
              <Button variant="outline" size="sm" onClick={() => fetchAll()} disabled={loading}>
                <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} />
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview?.connections?.map((conn) => (
                <ConnectionCard
                  key={conn.id}
                  conn={conn}
                  busy={busyConnection === conn.id}
                  onStart={() => handleStart(conn)}
                  onStop={() => handleStop(conn)}
                  onDetail={() => openDetail(conn)}
                  onDelete={() => setDeleteTarget(conn)}
                  onSettle={() => handleSettle(conn.id)}
                  settling={settling === conn.id}
                />
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Recent Trades</CardTitle></CardHeader>
              <CardContent>
                {trades.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No closed trades yet.</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {trades.map((t) => <TradeRow key={t.id} trade={t} />)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4 text-emerald-500" /> Profit Share</CardTitle></CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">
                  TOPTIER gets {overview?.connections?.[0]?.summary?.providerSharePct ?? 50}% of the profit on every winning trade — both long and short. Losses do not offset future winnings.
                </p>
                {settlements.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No settlements yet. Finalize the current period from any account card.</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {settlements.map((s) => (
                      <div key={s.id} className="flex items-center justify-between p-2.5 rounded-lg border bg-card/50 text-sm">
                        <div>
                          <div className="font-medium">
                            {new Date(s.periodStart).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Wins ${s.grossProfit.toFixed(2)} · {s.providerSharePct}% share
                          </div>
                        </div>
                        <Badge variant={s.providerAmount > 0 ? 'default' : 'outline'} className="tabular-nums">
                          {s.providerAmount > 0 ? `$${s.providerAmount.toFixed(2)} due` : '$0.00'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card className="border-violet-300/40 bg-violet-50/50 dark:bg-violet-500/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2 text-sm font-medium text-foreground">
            <ShieldCheck className="h-4 w-4 text-violet-500" /> Account-size risk rules
          </div>
          <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
            <li>
              <span className="font-semibold text-foreground">≤ $50:</span> max 3 open entries, every trade capped at 0.02 lots, all instruments — the bot can take as many sequential trades as possible.
            </li>
            <li>
              <span className="font-semibold text-foreground">$50–$100:</span> max 2 open entries, lots capped at 0.01–0.02, metals enabled, mostly scalping.
            </li>
            <li>
              <span className="font-semibold text-foreground">&gt; $100:</span> present rules — per-asset-class sizing, no tier lot cap.
            </li>
            <li>
              <span className="font-semibold text-foreground">One account, one use:</span> an account running the bot can&apos;t be a copy-trading MASTER and vice versa.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="border-amber-300/40 bg-amber-50/50 dark:bg-amber-500/5">
        <CardContent className="p-4 text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Risk disclosure:</span> Trading MetaTrader accounts involves substantial risk of loss and is not suitable for every investor. Past performance is not indicative of future results. The bot trades automatically — set risk limits before starting, and test on a demo account first. TOPTIER does not guarantee any profit. The profit share is recorded here for settlement between you and your broker; TOPTIER never accesses or moves funds in your trading account.
        </CardContent>
      </Card>

      {/* Link account dialog */}
      <Dialog open={showLink} onOpenChange={setShowLink}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link MetaTrader Account</DialogTitle>
          </DialogHeader>
          {process.env.NEXT_PUBLIC_BROKER_REFERRAL_URL && (
            <a
              href={process.env.NEXT_PUBLIC_BROKER_REFERRAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#1b4f9c] hover:underline inline-flex items-center gap-1 -mt-1 mb-2"
            >
              Don&apos;t have an account yet? Open one with our broker partner <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Platform</Label>
              <Select value={form.platform} onValueChange={(v) => setForm((p) => ({ ...p, platform: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mt5">MetaTrader 5</SelectItem>
                  <SelectItem value="mt4">MetaTrader 4 (needs the ToptierBridge EA)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Label</Label>
              <Input value={form.label} onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))} placeholder="e.g. My JustMarkets demo" />
            </div>
            <div>
              <Label>Broker (optional)</Label>
              <Input value={form.brokerName} onChange={(e) => setForm((p) => ({ ...p, brokerName: e.target.value }))} placeholder="JustMarkets" />
            </div>
            <div>
              <Label>Login</Label>
              <Input value={form.login} onChange={(e) => setForm((p) => ({ ...p, login: e.target.value }))} placeholder="Account number" />
            </div>
            <div>
              <Label>Password</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} placeholder="Investor/trader password" />
            </div>
            <div className="col-span-2">
              <Label>Server</Label>
              <Input value={form.server} onChange={(e) => setForm((p) => ({ ...p, server: e.target.value }))} placeholder="JustMarkets-Demo" />
            </div>
            <div className="col-span-2">
              <Label>Terminal path (MT4 only, optional)</Label>
              <Input value={form.terminalPath} onChange={(e) => setForm((p) => ({ ...p, terminalPath: e.target.value }))} placeholder="C:\Program Files\MetaTrader 4\terminal.exe" />
            </div>
            <div className="col-span-2">
              <Label>Base lots per $100 equity — Forex (0.08), Crypto (0.04), Metals/Oil/Indices (0.02)</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input type="number" step="0.01" min="0" value={form.forexBaseLot} onChange={(e) => setForm((p) => ({ ...p, forexBaseLot: parseFloat(e.target.value) || 0 }))} placeholder="0.08" />
                <Input type="number" step="0.01" min="0" value={form.cryptoBaseLot} onChange={(e) => setForm((p) => ({ ...p, cryptoBaseLot: parseFloat(e.target.value) || 0 }))} placeholder="0.04" />
                <Input type="number" step="0.01" min="0" value={form.highVolBaseLot} onChange={(e) => setForm((p) => ({ ...p, highVolBaseLot: parseFloat(e.target.value) || 0 }))} placeholder="0.02" />
              </div>
            </div>
            <div>
              <Label>Max open positions (entries)</Label>
              <Input type="number" step="1" min="1" value={form.maxOpenPositions} onChange={(e) => setForm((p) => ({ ...p, maxOpenPositions: parseInt(e.target.value, 10) || 0 }))} />
            </div>
            <div>
              <Label>Profit share %</Label>
              <Input type="number" step="1" value={form.providerSharePct} onChange={(e) => setForm((p) => ({ ...p, providerSharePct: parseFloat(e.target.value) || 0 }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLink(false)}>Cancel</Button>
            <Button onClick={handleLink} disabled={linking}>
              {linking && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Link Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Instance detail / logs */}
      <Dialog open={!!detailInstance} onOpenChange={(o) => { if (!o) setDetailInstance(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#1b4f9c]" />
              {detailInstance?.label} — logs
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {instanceDetail && (
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg border p-2">
                  <div className="text-xs text-muted-foreground">Status</div>
                  <Badge variant={instanceDetail.online ? 'default' : 'outline'} className="mt-1">
                    {instanceDetail.online ? 'Online' : 'Offline'}
                  </Badge>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-xs text-muted-foreground">Start count</div>
                  <div className="font-semibold">{detailInstance?.startCount ?? 0}</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-xs text-muted-foreground">PID</div>
                  <div className="font-mono">{detailInstance?.pid ?? '—'}</div>
                </div>
              </div>
            )}
            {instanceDetail?.snapshot?.bot_status && (
              <div className="rounded-lg border p-3 text-sm">
                <div className="text-xs text-muted-foreground mb-1">Latest snapshot</div>
                <div className="font-mono text-xs whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {JSON.stringify(instanceDetail.snapshot, null, 2)}
                </div>
              </div>
            )}
            <div className="rounded-lg border bg-black/90 text-green-400 p-3 font-mono text-xs max-h-72 overflow-y-auto whitespace-pre-wrap">
              {instanceDetail?.logs?.length ? instanceDetail.logs.join('\n') : 'No log output yet.'}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.label}?</AlertDialogTitle>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            The bot will be stopped and this account unlinked. Closed trade history for it is also removed. This cannot be undone.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700 text-white">
              <Trash2 className="h-4 w-4 mr-1.5" /> Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: 'good' | 'bad' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn(
          'text-2xl font-bold tabular-nums mt-1',
          highlight === 'good' && 'text-emerald-500',
          highlight === 'bad' && 'text-rose-500'
        )}>{value}</div>
      </CardContent>
    </Card>
  )
}

function ConnectionCard({
  conn, busy, onStart, onStop, onDetail, onDelete, onSettle, settling,
}: {
  conn: BotConnection
  busy: boolean
  onStart: () => void
  onStop: () => void
  onDetail: () => void
  onDelete: () => void
  onSettle: () => void
  settling: boolean
}) {
  const inst = conn.instances?.[0]
  const status = inst?.status ?? 'stopped'
  const running = status === 'running' || status === 'starting'
  const isUp = (conn.summary?.realizedPnl ?? 0) >= 0

  return (
    <div className="rounded-xl border bg-card/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', running ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-muted-foreground')}>
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold truncate">{conn.label}</span>
              <Badge variant={conn.platform === 'mt4' ? 'secondary' : 'default'} className="text-[10px]">
                {conn.platform.toUpperCase()}
              </Badge>
              {running && <Badge className="text-[10px] bg-emerald-500/15 text-emerald-600 border-emerald-500/30">LIVE</Badge>}
              {conn.isCopyMaster && (
                <Badge className="text-[10px] bg-violet-500/15 text-violet-600 border-violet-500/30">
                  <Landmark className="h-3 w-3 mr-1" /> Copy MASTER
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              Login {conn.login} · {conn.server}
              {inst?.lastError && <span className="text-rose-500"> · {inst.lastError}</span>}
            </div>
            {conn.accountTier?.tier && (
              <div className="text-[11px] mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {conn.accountTier.tier === 'small' ? 'Account ≤ $50' : conn.accountTier.tier === 'mid' ? 'Account $50–$100' : 'Account $100+'}
                </Badge>
                <span className="text-muted-foreground">{conn.accountTier.summary}</span>
                {conn.accountBalance != null && (
                  <span className="text-muted-foreground font-mono">
                    balance {conn.accountCurrency ? `${conn.accountCurrency} ` : ''}{conn.accountBalance.toFixed(2)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onDetail}>
            <FileText className="h-3.5 w-3.5 mr-1" /> Logs
          </Button>
          {running ? (
            <Button size="sm" variant="outline" className="border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10" disabled={busy} onClick={onStop}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5 mr-1" />} Stop
            </Button>
          ) : conn.isCopyMaster ? (
            <Button size="sm" disabled title="This account is your copy-trading MASTER. One account is used for one thing at a time — unlink it on the Copy Trading page (Manage tab) before running the bot here.">
              <Play className="h-3.5 w-3.5 mr-1" /> Start
            </Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={onStart}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />} Start
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-rose-500" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="rounded-lg border p-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Status</div>
          <Badge variant={status === 'error' ? 'destructive' : status === 'running' ? 'default' : 'outline'} className="mt-0.5 capitalize">{status}</Badge>
        </div>
        <div className="rounded-lg border p-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Trades</div>
          <div className="font-semibold tabular-nums">{conn.tradeCount}</div>
        </div>
        <div className="rounded-lg border p-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Realized P&L</div>
          <div className={cn('font-semibold tabular-nums', isUp ? 'text-emerald-500' : 'text-rose-500')}>
            {isUp ? '+' : ''}${(conn.summary?.realizedPnl ?? 0).toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg border p-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Share due</div>
          <div className="flex items-center justify-between gap-1">
            <span className={cn('font-semibold tabular-nums', (conn.summary?.dueAmount ?? 0) > 0 ? 'text-emerald-500' : 'text-muted-foreground')}>
              ${(conn.summary?.dueAmount ?? 0).toFixed(2)}
            </span>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={onSettle} disabled={settling}>
              {settling ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Settle'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TradeRow({ trade }: { trade: BotTrade }) {
  const positive = trade.profit >= 0
  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg border bg-card/50">
      <div className="flex items-center gap-2 min-w-0">
        {trade.direction === 'BUY' ? (
          <TrendingUp className="h-4 w-4 text-emerald-500 shrink-0" />
        ) : (
          <TrendingDown className="h-4 w-4 text-rose-500 shrink-0" />
        )}
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">
            {trade.symbol} <Badge variant={trade.direction === 'BUY' ? 'default' : 'destructive'} className="text-[10px] ml-1">{trade.direction}</Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {trade.lots} lots · ${trade.entryPrice}{trade.closePrice != null ? ` → $${trade.closePrice}` : ''}
            {trade.closedAt && ` · ${new Date(trade.closedAt).toLocaleDateString()}`}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={cn('font-semibold tabular-nums text-sm', positive ? 'text-emerald-500' : 'text-rose-500')}>
          {positive ? '+' : ''}${trade.profit.toFixed(2)}
        </div>
        {trade.result && <div className="text-[10px] text-muted-foreground uppercase">{trade.result}</div>}
      </div>
    </div>
  )
}

export default TradingBotPage
