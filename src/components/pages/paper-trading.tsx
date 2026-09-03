'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { NotebookPen, TrendingUp, TrendingDown, Loader2, DollarSign, Target, Bitcoin, Plug, ShieldCheck, Zap } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface PaperTrade {
  id: string
  symbol: string
  direction: string
  quantity: number
  entryPrice: number
  exitPrice: number | null
  pnl: number | null
  pnlPercent: number | null
  status: string
  openedAt: string
  closedAt: string | null
}

interface Stats {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnL: number
  avgWin: number
  avgLoss: number
}

export function PaperTradingPage() {
  const user = useStore((s) => s.user)
  const [trades, setTrades] = useState<PaperTrade[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [showOpen, setShowOpen] = useState(false)
  const [closing, setClosing] = useState<string | null>(null)
  const [form, setForm] = useState({ symbol: 'BTC/USD', direction: 'BUY', quantity: 0.1, entryPrice: 0, stopLoss: 0, takeProfit: 0, notes: '' })
  const [opening, setOpening] = useState(false)
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all')

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      const res = await api.get<{ success: boolean; data: { trades: PaperTrade[]; stats: Stats } }>('/trading/paper', { signal })
      setTrades(res?.data?.trades || [])
      setStats(res?.data?.stats || null)
    } catch {
      if (!signal?.aborted) setTrades([])
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    fetchData(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchData])

  const handleOpen = async () => {
    if (!form.symbol || !form.quantity || !form.entryPrice) {
      toast.error('Fill in symbol, quantity, and entry price')
      return
    }
    setOpening(true)
    try {
      await api.post('/trading/paper', {
        symbol: form.symbol, direction: form.direction, quantity: parseFloat(String(form.quantity)),
        entryPrice: parseFloat(String(form.entryPrice)),
        stopLoss: form.stopLoss ? parseFloat(String(form.stopLoss)) : undefined,
        takeProfit: form.takeProfit ? parseFloat(String(form.takeProfit)) : undefined,
        notes: form.notes || undefined,
      })
      toast.success('Paper trade opened!')
      setShowOpen(false)
      setForm({ symbol: 'BTC/USD', direction: 'BUY', quantity: 0.1, entryPrice: 0, stopLoss: 0, takeProfit: 0, notes: '' })
      fetchData()
    } catch {
      toast.error('Failed to open trade')
    } finally {
      setOpening(false)
    }
  }

  const handleClose = async (id: string, exitPrice: number) => {
    if (!exitPrice) {
      toast.error('Enter an exit price')
      return
    }
    setClosing(id)
    try {
      await api.post('/trading/paper/close', { tradeId: id, exitPrice })
      toast.success('Trade closed')
      fetchData()
    } catch (err) {
      toast.error('Failed to close trade')
    } finally {
      setClosing(null)
    }
  }

  const filtered = filter === 'all' ? trades : trades.filter((t) => t.status === filter)

  return (
    <div className="space-y-5 p-3 md:p-4 max-w-6xl mx-auto">
      <Tabs defaultValue="paper" className="w-full">
        <TabsList className="mb-4 flex flex-wrap h-auto">
          <TabsTrigger value="paper" className="gap-1.5 text-xs">
            <NotebookPen className="size-4 text-emerald-500" />
            Paper Trading
          </TabsTrigger>
          <TabsTrigger value="binance" className="gap-1.5 text-xs">
            <Bitcoin className="size-4 text-[#f0b90b]" />
            Binance Live
          </TabsTrigger>
        </TabsList>

        <TabsContent value="paper" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <NotebookPen className="h-7 w-7 text-emerald-500" />
            Paper Trading
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Practice trading with virtual capital — no real money at risk.</p>
        </div>
        <Button onClick={() => setShowOpen(true)}>
          <TrendingUp className="h-4 w-4 mr-1.5" />
          New Trade
        </Button>
      </motion.div>

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <StatCard label="Total Trades" value={stats?.totalTrades?.toString() || '0'} />
        <StatCard label="Win Rate" value={`${stats?.winRate || 0}%`} highlight={(stats?.winRate || 0) >= 50 ? 'good' : 'bad'} />
        <StatCard label="Total P&L" value={`$${(stats?.totalPnL || 0).toFixed(2)}`} highlight={(stats?.totalPnL || 0) >= 0 ? 'good' : 'bad'} />
        <StatCard label="Open Positions" value={trades.filter((t) => t.status === 'open').length.toString()} />
      </div>

      <div className="flex gap-2">
        {(['all', 'open', 'closed'] as const).map((f) => (
          <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => setFilter(f)} className="capitalize">{f}</Button>
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <NotebookPen className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p>No {filter !== 'all' ? filter : ''} trades yet. Open your first trade!</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Trade History</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {filtered.map((t) => (
              <TradeRow key={t.id} trade={t} closing={closing === t.id} onClose={handleClose} />
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={showOpen} onOpenChange={setShowOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open Paper Trade</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Symbol</Label>
              <Input value={form.symbol} onChange={(e) => setForm((p) => ({ ...p, symbol: e.target.value }))} />
            </div>
            <div>
              <Label>Direction</Label>
              <div className="flex gap-2 mt-1">
                {(['BUY', 'SELL'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setForm((p) => ({ ...p, direction: d }))}
                    className={cn(
                      'flex-1 py-2 rounded-md border text-sm font-medium',
                      form.direction === d
                        ? d === 'BUY' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-rose-500 text-white border-rose-500'
                        : 'hover:bg-accent'
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Quantity</Label>
              <Input type="number" step="0.001" value={form.quantity} onChange={(e) => setForm((p) => ({ ...p, quantity: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <Label>Entry Price</Label>
              <Input type="number" step="0.0001" value={form.entryPrice} onChange={(e) => setForm((p) => ({ ...p, entryPrice: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <Label>Stop Loss (optional)</Label>
              <Input type="number" step="0.0001" value={form.stopLoss || ''} onChange={(e) => setForm((p) => ({ ...p, stopLoss: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div>
              <Label>Take Profit (optional)</Label>
              <Input type="number" step="0.0001" value={form.takeProfit || ''} onChange={(e) => setForm((p) => ({ ...p, takeProfit: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Why this trade?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOpen(false)}>Cancel</Button>
            <Button onClick={handleOpen} disabled={opening}>
              {opening && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Open Trade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </TabsContent>

        <TabsContent value="binance" className="space-y-6">
          <BinanceLiveTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface BrokerAccount {
  broker: string
  connected: boolean
  accountId: string
  balance: number
  currency: string
  leverage: string
}

interface LiveOrderResult {
  orderId: number
  status: string
  symbol: string
  side: string
  size: number
  type: string
  price: number
  filled: number
  protective?: Array<{ orderId: number; side: string; type: string; price: number; status?: string }>
}

function BinanceLiveTab() {
  const [account, setAccount] = useState<BrokerAccount | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [checking, setChecking] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [form, setForm] = useState({
    symbol: 'BTC/USD',
    direction: 'BUY',
    orderType: 'market',
    size: 0.001,
    price: 0,
    stopLoss: 0,
    takeProfit: 0,
  })
  const [placing, setPlacing] = useState(false)
  const [lastOrder, setLastOrder] = useState<LiveOrderResult | null>(null)

  // Auto-connect using server-side keys (.env) on first load, if present.
  const tryConnect = useCallback(async (key?: string, secret?: string) => {
    setConnecting(true)
    try {
      const res = await api.post<{ success: boolean; data: { account: BrokerAccount } }>(
        '/trading/live',
        {
          action: 'connect',
          brokerId: 'binance',
          apiKey: key || undefined,
          apiSecret: secret || undefined,
        }
      )
      const acc = res?.data?.account
      if (acc?.connected) {
        setAccount(acc)
        toast.success(`Connected to Binance — ${acc.balance.toFixed(2)} USDT available`)
      }
      return acc
    } catch (err: any) {
      setAccount(null)
      const msg = err?.message || 'Connection failed'
      // "not configured" is expected when no keys exist yet — show setup form.
      if (!msg.includes('not configured')) toast.error(msg)
      return null
    } finally {
      setConnecting(false)
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    tryConnect()
  }, [tryConnect])

  const handleConnect = () => {
    if (!apiKey || !apiSecret) {
      toast.error('Enter your Binance API key and secret')
      return
    }
    tryConnect(apiKey.trim(), apiSecret.trim())
  }

  const handlePlaceOrder = async () => {
    if (!account) {
      toast.error('Connect your Binance account first')
      return
    }
    if (!form.symbol || !form.size) {
      toast.error('Fill in symbol and size')
      return
    }
    setPlacing(true)
    try {
      const res = await api.post<{ success: boolean; data: { order: LiveOrderResult } }>('/trading/live', {
        action: 'order',
        accountId: account.accountId,
        order: {
          symbol: form.symbol,
          direction: form.direction,
          size: parseFloat(String(form.size)),
          orderType: form.orderType,
          price: form.price ? parseFloat(String(form.price)) : undefined,
          stopLoss: form.stopLoss ? parseFloat(String(form.stopLoss)) : undefined,
          takeProfit: form.takeProfit ? parseFloat(String(form.takeProfit)) : undefined,
        },
      })
      const order = res?.data?.order
      setLastOrder(order || null)
      toast.success(`Order ${order?.status || 'placed'}${order?.price ? ` @ $${order.price}` : ''}`)
    } catch (err: any) {
      toast.error(err?.message || 'Order failed')
    } finally {
      setPlacing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ─── Connection status ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bitcoin className="size-5 text-[#f0b90b]" />
            Binance Exchange Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {checking ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking connection…
            </div>
          ) : account ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-full bg-emerald-500/10">
                  <ShieldCheck className="size-5 text-emerald-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{account.broker}</p>
                    <Badge className="bg-emerald-500/15 text-emerald-600 text-[10px]">Connected</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{account.accountId}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums">
                  {account.balance.toFixed(2)} <span className="text-sm font-medium text-muted-foreground">{account.currency}</span>
                </p>
                <p className="text-xs text-muted-foreground">Available balance · leverage {account.leverage}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => { setAccount(null); setLastOrder(null) }}>
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 text-xs text-muted-foreground">
                No Binance connection yet. Create an API key in Binance (Settings → API Management) with
                “Enable Spot &amp; Spot Margin Trading” and read permissions, then enter it here or set
                <code className="mx-1 rounded bg-muted px-1.5 py-0.5">BINANCE_API_KEY</code> /
                <code className="mx-1 rounded bg-muted px-1.5 py-0.5">BINANCE_API_SECRET</code> in your server .env.
                Keys entered here are validated live and are never stored by the app.
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>API Key</Label>
                  <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="your Binance API key" />
                </div>
                <div className="space-y-1.5">
                  <Label>API Secret</Label>
                  <Input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="your Binance API secret" />
                </div>
              </div>
              <Button onClick={handleConnect} disabled={connecting || !apiKey || !apiSecret} className="gap-1.5">
                <Plug className="size-4" />
                {connecting ? <Loader2 className="size-4 animate-spin" /> : 'Connect Binance'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Live order form ───────────────────────────────────────── */}
      {account ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="size-4 text-[#f0b90b]" />
              Place Live Order
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Symbol</Label>
                <Input value={form.symbol} onChange={(e) => setForm((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))} placeholder="BTC/USD" />
              </div>
              <div className="space-y-1.5">
                <Label>Direction</Label>
                <div className="flex gap-2 pt-1">
                  {(['BUY', 'SELL'] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setForm((p) => ({ ...p, direction: d }))}
                      className={cn(
                        'flex-1 py-2 rounded-md border text-sm font-medium',
                        form.direction === d
                          ? d === 'BUY' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-rose-500 text-white border-rose-500'
                          : 'hover:bg-accent'
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Order Type</Label>
                <Select value={form.orderType} onValueChange={(v) => setForm((p) => ({ ...p, orderType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="market">Market</SelectItem>
                    <SelectItem value="limit">Limit</SelectItem>
                    <SelectItem value="stop">Stop</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Size</Label>
                <Input type="number" step="0.0001" value={form.size || ''} onChange={(e) => setForm((p) => ({ ...p, size: parseFloat(e.target.value) || 0 }))} />
              </div>
              {form.orderType !== 'market' && (
                <div className="space-y-1.5">
                  <Label>Price</Label>
                  <Input type="number" step="0.01" value={form.price || ''} onChange={(e) => setForm((p) => ({ ...p, price: parseFloat(e.target.value) || 0 }))} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Stop Loss (optional)</Label>
                <Input type="number" step="0.01" value={form.stopLoss || ''} onChange={(e) => setForm((p) => ({ ...p, stopLoss: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Take Profit (optional)</Label>
                <Input type="number" step="0.01" value={form.takeProfit || ''} onChange={(e) => setForm((p) => ({ ...p, takeProfit: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>

            <Button onClick={handlePlaceOrder} disabled={placing} className="w-full gap-1.5">
              {placing ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
              {placing ? 'Placing order…' : `Place ${form.orderType} ${form.direction} Order`}
            </Button>

            {lastOrder ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{lastOrder.side} {lastOrder.type}</Badge>
                  <span className="font-semibold">{lastOrder.symbol}</span>
                  <Badge className={cn('text-[10px]', lastOrder.status === 'FILLED' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-yellow-500/15 text-yellow-600')}>
                    {lastOrder.status}
                  </Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Order #{lastOrder.orderId} · size {lastOrder.size} · fill price ${lastOrder.price.toFixed(4)} · filled {lastOrder.filled}
                  {lastOrder.protective?.length ? ` · protective orders: ${lastOrder.protective.map((o) => `${o.type}@${o.price}`).join(', ')}` : ''}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
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

function TradeRow({ trade, closing, onClose }: { trade: PaperTrade; closing: boolean; onClose: (id: string, price: number) => void }) {
  const [exitPrice, setExitPrice] = useState<number>(0)
  const isBuy = trade.direction === 'BUY'
  const isPositive = (trade.pnl || 0) >= 0
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card/50">
      <div className="flex items-center gap-3">
        <Badge variant={isBuy ? 'default' : 'destructive'} className="text-[10px]">{trade.direction}</Badge>
        <div>
          <div className="font-medium text-sm">{trade.symbol}</div>
          <div className="text-xs text-muted-foreground">
            {trade.quantity} @ ${trade.entryPrice}
            {trade.exitPrice && ` → $${trade.exitPrice}`}
            {' · '}{new Date(trade.openedAt).toLocaleDateString()}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {trade.status === 'closed' ? (
          <div className="text-right">
            <Badge variant="outline" className="text-[10px]">Closed</Badge>
            <div className={cn('text-sm font-semibold tabular-nums', isPositive ? 'text-emerald-500' : 'text-rose-500')}>
              {isPositive ? '+' : ''}${(trade.pnl || 0).toFixed(2)} ({trade.pnlPercent?.toFixed(2)}%)
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              step="0.0001"
              placeholder="Exit $"
              value={exitPrice || ''}
              onChange={(e) => setExitPrice(parseFloat(e.target.value) || 0)}
              className="w-24 h-8 text-xs"
            />
            <Button size="sm" variant="outline" disabled={closing} onClick={() => onClose(trade.id, exitPrice)}>
              {closing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Close'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default PaperTradingPage
