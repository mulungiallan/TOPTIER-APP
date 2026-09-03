'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import {
  TrendingUp,
  TrendingDown,
  Filter,
  ThumbsUp,
  ThumbsDown,
  Check,
  X,
  Settings2,
  ChevronDown,
  ChevronUp,
  Clock,
  Target,
  ShieldAlert,
  Flame,
  SearchX,
  RotateCcw,
  Save,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { useLiveMarket, type LivePriceItem } from '@/hooks/use-live-market'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { NativeAd } from '@/components/ads'

// ─── Types ────────────────────────────────────────────────────────────────────────

type MarketType = 'All' | 'Forex' | 'Crypto' | 'Stocks' | 'Indices' | 'Commodities'
type Strategy = 'Scalp' | 'Swing' | 'Both'
type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | 'Daily' | 'Weekly'
type SignalDirection = 'BUY' | 'SELL'
type SignalStatus = 'Active' | 'Hit TP' | 'Hit SL' | 'Expired'

interface MockSignal {
  id: string
  asset: string
  market: MarketType
  direction: SignalDirection
  entryPrice: number
  stopLoss: number
  takeProfit1: number
  takeProfit2: number
  takeProfit3: number
  riskReward: string
  confidence: number
  strategy: 'Scalp' | 'Swing'
  timeframe: Timeframe
  session: string
  expiresAt: number // ms timestamp
  reason: string
  status: SignalStatus
  accepted: boolean
  ignored: boolean
  thumbsUp: boolean
  thumbsDown: boolean
}

// ─── Sub Components ───────────────────────────────────────────────────────────────

function ConfidenceCircle({ value, size = 44 }: { value: number; size?: number }) {
  const strokeWidth = 3.5
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference

  const color =
    value >= 70
      ? '#10b981'
      : value >= 50
      ? '#eab308'
      : '#ef4444'

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="oklch(0.88 0.02 162 / 0.3)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <span
        className="absolute text-[11px] font-bold"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  )
}

function computeRemaining(expiresAt: number): string {
  const diff = expiresAt - Date.now()
  if (diff <= 0) return 'Expired'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function SignalExpiry({ expiresAt, status }: { expiresAt: number; status: SignalStatus }) {
  const isDone = status === 'Expired' || status === 'Hit TP' || status === 'Hit SL'
  const [remaining, setRemaining] = useState(() =>
    isDone ? (status === 'Expired' ? 'Expired' : status) : computeRemaining(expiresAt)
  )

  useEffect(() => {
    if (isDone) return

    const interval = setInterval(() => {
      setRemaining(computeRemaining(expiresAt))
    }, 1000)
    return () => clearInterval(interval)
  }, [expiresAt, isDone])

  return (
    <div className="flex items-center gap-1">
      <Clock className="size-3 text-muted-foreground" />
      <span className="text-[11px] font-mono text-muted-foreground">{remaining}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: SignalStatus }) {
  const variants: Record<SignalStatus, string> = {
    Active: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    'Hit TP': 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    'Hit SL': 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20',
    Expired: 'bg-muted text-muted-foreground border-muted',
  }

  return (
    <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px] font-semibold', variants[status])}>
      {status}
    </Badge>
  )
}

function PipDistance(entry: number, target: number, market: string): string {
  if (market === 'Crypto') {
    return `${((target - entry) / entry * 100).toFixed(2)}%`
  }
  if (market === 'Stocks' || market === 'Indices') {
    return `${(target - entry).toFixed(1)} pts`
  }
  if (market === 'Commodities') {
    return `${(target - entry).toFixed(1)}`
  }
  // Forex - pip calculation (4 decimal for most, 2 for JPY pairs)
  const isJpy = entry > 50
  const pips = isJpy
    ? ((target - entry) * 100).toFixed(0)
    : ((target - entry) * 10000).toFixed(0)
  return `${pips} pips`
}

// ─── Customize Dialog ─────────────────────────────────────────────────────────────

function CustomizeSignalDialog({
  signal,
  onSave,
}: {
  signal: MockSignal
  onSave: (id: string, custom: { entry: number; sl: number; tp1: number; tp2: number; tp3: number; trailingStop: boolean; trailingPips: number }) => void
}) {
  const [entry, setEntry] = useState(signal.entryPrice.toString())
  const [sl, setSl] = useState(signal.stopLoss.toString())
  const [tp1, setTp1] = useState(signal.takeProfit1.toString())
  const [tp2, setTp2] = useState(signal.takeProfit2.toString())
  const [tp3, setTp3] = useState(signal.takeProfit3.toString())
  const [trailingStop, setTrailingStop] = useState(false)
  const [trailingPips, setTrailingPips] = useState('50')
  const [open, setOpen] = useState(false)

  const handleReset = () => {
    setEntry(signal.entryPrice.toString())
    setSl(signal.stopLoss.toString())
    setTp1(signal.takeProfit1.toString())
    setTp2(signal.takeProfit2.toString())
    setTp3(signal.takeProfit3.toString())
    setTrailingStop(false)
    setTrailingPips('50')
  }

  const handleSave = () => {
    onSave(signal.id, {
      entry: parseFloat(entry),
      sl: parseFloat(sl),
      tp1: parseFloat(tp1),
      tp2: parseFloat(tp2),
      tp3: parseFloat(tp3),
      trailingStop,
      trailingPips: parseInt(trailingPips),
    })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-[11px]"
        >
          <Settings2 className="size-3" />
          Customize
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customize Signal — {signal.asset}</DialogTitle>
          <DialogDescription>
            Adjust entry, stop loss, and take profit levels for {signal.id}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Entry Price</Label>
              <Input
                type="number"
                step="any"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Stop Loss</Label>
              <Input
                type="number"
                step="any"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">TP1</Label>
              <Input
                type="number"
                step="any"
                value={tp1}
                onChange={(e) => setTp1(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">TP2</Label>
              <Input
                type="number"
                step="any"
                value={tp2}
                onChange={(e) => setTp2(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">TP3</Label>
              <Input
                type="number"
                step="any"
                value={tp3}
                onChange={(e) => setTp3(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={trailingStop} onCheckedChange={setTrailingStop} />
              <Label className="text-xs">Trailing Stop</Label>
            </div>
            {trailingStop && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  value={trailingPips}
                  onChange={(e) => setTrailingPips(e.target.value)}
                  className="h-7 w-16 text-xs text-center"
                />
                <span className="text-[10px] text-muted-foreground">pips</span>
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
            <RotateCcw className="size-3" />
            Reset to Original
          </Button>
          <Button size="sm" onClick={handleSave} className="gap-1.5">
            <Save className="size-3" />
            Save Custom Signal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Signal Card ───────────────────────────────────────────────────────────────────

function SignalCard({
  signal,
  onAccept,
  onIgnore,
  onThumbsUp,
  onThumbsDown,
  onCustomize,
  livePrice,
}: {
  signal: MockSignal
  onAccept: (id: string) => void
  onIgnore: (id: string) => void
  onThumbsUp: (id: string) => void
  onThumbsDown: (id: string) => void
  onCustomize: (id: string, custom: { entry: number; sl: number; tp1: number; tp2: number; tp3: number; trailingStop: boolean; trailingPips: number }) => void
  livePrice?: LivePriceItem
}) {
  const [reasonOpen, setReasonOpen] = useState(false)
  const isBuy = signal.direction === 'BUY'
  const isActive = signal.status === 'Active'

  // Live floating P/L vs entry, only meaningful if we have a live price and entry
  const livePips = livePrice && signal.entryPrice
    ? (isBuy ? livePrice.price - signal.entryPrice : signal.entryPrice - livePrice.price)
    : null
  const livePct = livePrice && signal.entryPrice
    ? ((livePrice.price - signal.entryPrice) / signal.entryPrice) * 100 * (isBuy ? 1 : -1)
    : null
  const liveProfitable = livePips !== null ? livePips > 0 : null

  return (
    <Card
      className={cn(
        'overflow-hidden transition-all duration-200',
        signal.ignored && 'opacity-50',
        'border-l-[3px]',
        isBuy ? 'border-l-emerald-500' : 'border-l-red-500'
      )}
    >
      <CardContent className="p-4">
        {/* Header: Asset + Direction + Status */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Badge
              className={cn(
                'shrink-0 px-2 py-0.5 text-xs font-bold',
                isBuy
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                  : 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20 hover:bg-red-500/20'
              )}
            >
              {isBuy ? (
                <ArrowUpRight className="mr-0.5 size-3" />
              ) : (
                <ArrowDownRight className="mr-0.5 size-3" />
              )}
              {signal.direction}
            </Badge>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold truncate">{signal.asset}</span>
                <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[9px]">
                  {signal.market}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground font-mono">{signal.id}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={signal.status} />
            <ConfidenceCircle value={signal.confidence} size={40} />
          </div>
        </div>

        {/* Price Levels */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Entry</span>
            <span className="font-mono font-medium">{signal.entryPrice}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              Live
              {livePrice?.source && (
                <span className="inline-block size-1 rounded-full bg-emerald-500 animate-pulse" title={`Source: ${livePrice.source}`} />
              )}
            </span>
            <span className={cn(
              'font-mono font-medium tabular-nums',
              livePrice ? (
                liveProfitable === true ? 'text-emerald-600 dark:text-emerald-400' :
                liveProfitable === false ? 'text-red-600 dark:text-red-400' :
                'text-foreground'
              ) : 'text-muted-foreground'
            )}>
              {livePrice ? formatSignalPrice(signal.asset, livePrice.price) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Stop Loss</span>
            <div className="flex items-center gap-1">
              <span className="font-mono font-medium text-red-500">{signal.stopLoss}</span>
              <span className="text-[9px] text-muted-foreground">
                ({PipDistance(signal.entryPrice, signal.stopLoss, signal.market)})
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Floating</span>
            <span
              className={cn(
                'font-mono font-medium tabular-nums',
                livePips === null ? 'text-muted-foreground' :
                liveProfitable === true ? 'text-emerald-600 dark:text-emerald-400' :
                'text-red-600 dark:text-red-400'
              )}
            >
              {livePips === null ? '—' : (
                <>
                  {liveProfitable === true ? '+' : ''}{livePips.toFixed(signal.asset.includes('/') ? 4 : 2)}
                  <span className="ml-1 text-[9px] opacity-70">
                    ({liveProfitable === true ? '+' : ''}{livePct?.toFixed(2)}%)
                  </span>
                </>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">TP1</span>
            <div className="flex items-center gap-1">
              <span className="font-mono font-medium text-emerald-500">{signal.takeProfit1}</span>
              <span className="text-[9px] text-muted-foreground">
                ({PipDistance(signal.entryPrice, signal.takeProfit1, signal.market)})
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">TP2</span>
            <div className="flex items-center gap-1">
              <span className="font-mono font-medium text-emerald-500">{signal.takeProfit2}</span>
              <span className="text-[9px] text-muted-foreground">
                ({PipDistance(signal.entryPrice, signal.takeProfit2, signal.market)})
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">TP3</span>
            <div className="flex items-center gap-1">
              <span className="font-mono font-medium text-emerald-500">{signal.takeProfit3}</span>
              <span className="text-[9px] text-muted-foreground">
                ({PipDistance(signal.entryPrice, signal.takeProfit3, signal.market)})
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">R:R</span>
            <span className="font-mono font-semibold text-primary">{signal.riskReward}</span>
          </div>
        </div>

        {/* Tags Row */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] gap-1">
            <Target className="size-2.5" />
            {signal.strategy}
          </Badge>
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {signal.timeframe}
          </Badge>
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {signal.session}
          </Badge>
          <div className="ml-auto">
            <SignalExpiry expiresAt={signal.expiresAt} status={signal.status} />
          </div>
        </div>

        {/* Collapsible Reason */}
        <div className="mt-2">
          <button
            onClick={() => setReasonOpen(!reasonOpen)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {reasonOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {reasonOpen ? 'Hide Analysis' : 'Show Analysis'}
          </button>
          {reasonOpen && (
            <div className="mt-1.5 rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground leading-relaxed">
              {signal.reason}
            </div>
          )}
        </div>

        {/* Actions Row */}
        {isActive && !signal.ignored && (
          <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-3">
            {!signal.accepted ? (
              <>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 text-[11px] bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => onAccept(signal.id)}
                >
                  <Check className="size-3" />
                  Accept
                </Button>
                <CustomizeSignalDialog signal={signal} onSave={onCustomize} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-[11px] text-muted-foreground hover:text-red-500"
                  onClick={() => onIgnore(signal.id)}
                >
                  <X className="size-3" />
                  Ignore
                </Button>
              </>
            ) : (
              <>
                <CustomizeSignalDialog signal={signal} onSave={onCustomize} />
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]">
                  <Check className="mr-0.5 size-2.5" />
                  Accepted
                </Badge>
              </>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 w-7 p-0',
                  signal.thumbsUp && 'text-emerald-500'
                )}
                onClick={() => onThumbsUp(signal.id)}
              >
                <ThumbsUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 w-7 p-0',
                  signal.thumbsDown && 'text-red-500'
                )}
                onClick={() => onThumbsDown(signal.id)}
              >
                <ThumbsDown className="size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Non-active signal: show reaction only */}
        {!isActive && (
          <div className="mt-3 flex items-center justify-end border-t border-border/50 pt-3">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-7 w-7 p-0', signal.thumbsUp && 'text-emerald-500')}
                onClick={() => onThumbsUp(signal.id)}
              >
                <ThumbsUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-7 w-7 p-0', signal.thumbsDown && 'text-red-500')}
                onClick={() => onThumbsDown(signal.id)}
              >
                <ThumbsDown className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Empty State ───────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
        <SearchX className="size-8 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">No Signals Found</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        No signals match your current filters. Try adjusting the market type, strategy, timeframe, or confidence level.
      </p>
    </div>
  )
}

// ─── Loading Skeleton for Signal Cards ────────────────────────────────────────────

function SignalsLoadingSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-12 rounded" />
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-14 rounded" />
                <Skeleton className="size-10 rounded-full" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j} className="flex justify-between">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-5 w-14 rounded" />
              <Skeleton className="h-5 w-10 rounded" />
              <Skeleton className="h-5 w-14 rounded" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Error State ───────────────────────────────────────────────────────────────────

function SignalsErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-red-500/10">
        <AlertTriangle className="size-8 text-red-500" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">Failed to Load Signals</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{error}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-4 gap-1.5">
        <RefreshCw className="size-3.5" />
        Retry
      </Button>
    </div>
  )
}

// ─── Map API signal to local type ─────────────────────────────────────────────────

function formatSignalPrice(asset: string, price: number): string {
  if (asset.includes('BTC')) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (asset.includes('ETH')) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (asset.includes('/') && asset.includes('USD')) return price.toFixed(4)
  if (price > 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return price.toFixed(2)
}

function mapApiSignal(s: any): MockSignal {
  const now = Date.now()
  return {
    id: s.id || s.signalId || '',
    asset: s.asset || s.pair || '',
    market: s.market || s.marketType || 'Forex',
    direction: s.direction || (s.type === 'long' || s.type === 'buy' ? 'BUY' : 'SELL'),
    entryPrice: s.entryPrice || s.entry || 0,
    stopLoss: s.stopLoss || s.sl || 0,
    takeProfit1: s.takeProfit1 || s.tp1 || 0,
    takeProfit2: s.takeProfit2 || s.tp2 || 0,
    takeProfit3: s.takeProfit3 || s.tp3 || 0,
    riskReward: s.riskReward || s.rr || '1:2.0',
    confidence: s.confidence || 0,
    strategy: s.strategy === 'Swing' ? 'Swing' : 'Scalp',
    timeframe: s.timeframe || '1h',
    session: s.session || 'London',
    expiresAt: s.expiresAt || (s.expires ? new Date(s.expires).getTime() : now + 14400000),
    reason: s.reason || s.analysis || '',
    status: s.status || 'Active',
    accepted: s.accepted || false,
    ignored: s.ignored || false,
    thumbsUp: s.thumbsUp || false,
    thumbsDown: s.thumbsDown || false,
  }
}

// ─── Main Signals Page ─────────────────────────────────────────────────────────────

export function SignalsPage() {
  const [signals, setSignals] = useState<MockSignal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [marketFilter, setMarketFilter] = useState<MarketType>('All')
  const [strategyFilter, setStrategyFilter] = useState<Strategy>('Both')
  const [timeframeFilter, setTimeframeFilter] = useState<Timeframe | 'All'>('All')
  const [confidenceMin, setConfidenceMin] = useState(50)
  const [filterDialogOpen, setFilterDialogOpen] = useState(false)

  // Fetch signals from API
  const fetchSignals = useCallback(async (showRefreshLoader = false) => {
    try {
      if (showRefreshLoader) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      const params = new URLSearchParams()
      if (marketFilter !== 'All') params.set('market', marketFilter)
      if (strategyFilter !== 'Both') params.set('strategy', strategyFilter)
      if (timeframeFilter !== 'All') params.set('timeframe', timeframeFilter)
      params.set('confidenceMin', String(confidenceMin))

      const queryString = params.toString()
      const endpoint = `/signals${queryString ? `?${queryString}` : ''}`

      const result = await api.get(endpoint)
      const rawSignals = Array.isArray(result?.data) ? result.data : result?.data?.signals || result?.signals || []
      setSignals(rawSignals.map(mapApiSignal))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signals')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [marketFilter, strategyFilter, timeframeFilter, confidenceMin])

  // Fetch on mount
  useEffect(() => {
    fetchSignals()
  }, [fetchSignals])

  // Fetch live prices for every asset referenced by the visible signals
  const signalSymbols = useMemo(() => {
    const set = new Set<string>()
    signals.forEach(s => { if (s.asset) set.add(s.asset) })
    return Array.from(set)
  }, [signals])
  const { prices: livePrices, lastUpdated: liveUpdatedAt } = useLiveMarket({
    symbols: signalSymbols,
    refreshMs: 30_000,
    enabled: signalSymbols.length > 0,
  })
  const livePriceMap = useMemo(() => {
    const m = new Map<string, LivePriceItem>()
    livePrices.forEach(p => m.set(p.symbol, p))
    return m
  }, [livePrices])

  // Filtered signals (also apply client-side filters for fields not handled by API)
  const filteredSignals = useMemo(() => {
    return signals.filter((s) => {
      if (s.ignored) return false
      // These filters may have been applied server-side, but also filter client-side
      if (marketFilter !== 'All' && s.market !== marketFilter) return false
      if (strategyFilter !== 'Both' && s.strategy !== strategyFilter) return false
      if (timeframeFilter !== 'All' && s.timeframe !== timeframeFilter) return false
      if (s.confidence < confidenceMin) return false
      return true
    })
  }, [signals, marketFilter, strategyFilter, timeframeFilter, confidenceMin])

  // Stats
  const activeCount = signals.filter((s) => s.status === 'Active' && !s.ignored).length
  const todayCount = signals.length
  const winStreak = useMemo(() => {
    let streak = 0
    for (const s of [...signals].reverse()) {
      if (s.status === 'Hit TP') streak++
      else if (s.status === 'Hit SL') break
    }
    return streak
  }, [signals])

  // Handlers
  const handleAccept = async (id: string) => {
    // Optimistically update UI
    setSignals((prev) =>
      prev.map((s) => (s.id === id ? { ...s, accepted: true } : s))
    )
    // Call API in background
    try {
      await api.post('/community', { signalId: id, action: 'accept' })
    } catch {
      // Silently fail - local state already updated
    }
  }

  const handleIgnore = (id: string) => {
    // Update signal status locally
    setSignals((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ignored: true } : s))
    )
  }

  const handleThumbsUp = async (id: string) => {
    setSignals((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, thumbsUp: !s.thumbsUp, thumbsDown: s.thumbsUp ? s.thumbsDown : false } : s
      )
    )
    try {
      await api.post('/community', { signalId: id, action: 'react', reaction: 'thumbs_up' })
    } catch {
      // Silently fail
    }
  }

  const handleThumbsDown = async (id: string) => {
    setSignals((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, thumbsDown: !s.thumbsDown, thumbsUp: s.thumbsDown ? s.thumbsUp : false } : s
      )
    )
    try {
      await api.post('/community', { signalId: id, action: 'react', reaction: 'thumbs_down' })
    } catch {
      // Silently fail
    }
  }

  const handleCustomize = (id: string, custom: { entry: number; sl: number; tp1: number; tp2: number; tp3: number; trailingStop: boolean; trailingPips: number }) => {
    // Save customizations locally
    setSignals((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              entryPrice: custom.entry,
              stopLoss: custom.sl,
              takeProfit1: custom.tp1,
              takeProfit2: custom.tp2,
              takeProfit3: custom.tp3,
            }
          : s
      )
    )
  }

  const marketTabs: MarketType[] = ['All', 'Forex', 'Crypto', 'Stocks', 'Indices', 'Commodities']

  return (
    <div className="p-3 lg:p-4 space-y-4">
      {/* ── Signal Stats Bar ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-1.5">
          <Flame className="size-4 text-emerald-500" />
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{activeCount}</span>
          <span className="text-xs text-muted-foreground">Active</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5">
          <TrendingUp className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{todayCount}</span>
          <span className="text-xs text-muted-foreground">Today</span>
        </div>
        {winStreak > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-yellow-500/10 px-3 py-1.5">
            <ShieldAlert className="size-4 text-yellow-500" />
            <span className="text-sm font-semibold text-yellow-600 dark:text-yellow-400">{winStreak}</span>
            <span className="text-xs text-muted-foreground">Win Streak</span>
          </div>
        )}
        {/* Live price indicator */}
        {livePrices.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">LIVE PRICES</span>
            {liveUpdatedAt && (
              <span className="text-[10px] text-muted-foreground">
                · {liveUpdatedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
        )}
        {/* Refresh Button */}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 gap-1.5 text-[11px]"
          onClick={() => fetchSignals(true)}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          Refresh
        </Button>
      </div>

      {/* ── Signal Filters Bar ───────────────────────────────────────── */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-col gap-3">
            {/* Market Type Tabs */}
            <Tabs value={marketFilter} onValueChange={(v) => setMarketFilter(v as MarketType)}>
              <TabsList className="h-8">
                {marketTabs.map((m) => (
                  <TabsTrigger key={m} value={m} className="text-[11px] px-2.5 py-1">
                    {m}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {/* Second row: Strategy + Timeframe + Confidence + Settings */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Strategy Toggle */}
              <div className="flex items-center gap-1.5 rounded-lg bg-muted p-0.5">
                {(['Scalp', 'Swing', 'Both'] as Strategy[]).map((strat) => (
                  <button
                    key={strat}
                    onClick={() => setStrategyFilter(strat)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                      strategyFilter === strat
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {strat}
                  </button>
                ))}
              </div>

              {/* Timeframe Select */}
              <Select value={timeframeFilter} onValueChange={(v) => setTimeframeFilter(v as Timeframe | 'All')}>
                <SelectTrigger size="sm" className="w-[100px] h-8 text-[11px]">
                  <SelectValue placeholder="Timeframe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All" className="text-xs">All TFs</SelectItem>
                  <SelectItem value="1m" className="text-xs">1m</SelectItem>
                  <SelectItem value="5m" className="text-xs">5m</SelectItem>
                  <SelectItem value="15m" className="text-xs">15m</SelectItem>
                  <SelectItem value="1h" className="text-xs">1h</SelectItem>
                  <SelectItem value="4h" className="text-xs">4h</SelectItem>
                  <SelectItem value="Daily" className="text-xs">Daily</SelectItem>
                  <SelectItem value="Weekly" className="text-xs">Weekly</SelectItem>
                </SelectContent>
              </Select>

              {/* Confidence Slider */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">Min Confidence</span>
                <Slider
                  value={[confidenceMin]}
                  min={50}
                  max={100}
                  step={5}
                  onValueChange={(v) => setConfidenceMin(v[0])}
                  className="w-[120px]"
                />
                <span className="text-[11px] font-mono font-medium w-8 text-right">{confidenceMin}%</span>
              </div>

              {/* Settings / More Filters */}
              <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-8 gap-1.5 text-[11px]"
                  onClick={() => setFilterDialogOpen(true)}
                >
                  <Filter className="size-3" />
                  More Filters
                </Button>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Advanced Filters</DialogTitle>
                    <DialogDescription>
                      Fine-tune signal filtering with additional criteria
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-xs">Trading Session</Label>
                      <Select>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="All Sessions" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all" className="text-xs">All Sessions</SelectItem>
                          <SelectItem value="london" className="text-xs">London</SelectItem>
                          <SelectItem value="newyork" className="text-xs">New York</SelectItem>
                          <SelectItem value="asian" className="text-xs">Asian</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Signal Status</Label>
                      <Select>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="All Statuses" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
                          <SelectItem value="active" className="text-xs">Active</SelectItem>
                          <SelectItem value="hittp" className="text-xs">Hit TP</SelectItem>
                          <SelectItem value="hitsl" className="text-xs">Hit SL</SelectItem>
                          <SelectItem value="expired" className="text-xs">Expired</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Min Risk:Reward</Label>
                      <Select>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Any R:R" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any" className="text-xs">Any R:R</SelectItem>
                          <SelectItem value="1:2" className="text-xs">1:2+</SelectItem>
                          <SelectItem value="1:3" className="text-xs">1:3+</SelectItem>
                          <SelectItem value="1:4" className="text-xs">1:4+</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button size="sm" onClick={() => setFilterDialogOpen(false)}>
                      Apply Filters
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Signal Feed ──────────────────────────────────────────────── */}
      {loading ? (
        <SignalsLoadingSkeleton />
      ) : error ? (
        <SignalsErrorState error={error} onRetry={() => fetchSignals()} />
      ) : filteredSignals.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filteredSignals.map((signal, idx) => (
            <React.Fragment key={signal.id}>
              <SignalCard
                signal={signal}
                onAccept={handleAccept}
                onIgnore={handleIgnore}
                onThumbsUp={handleThumbsUp}
                onThumbsDown={handleThumbsDown}
                onCustomize={handleCustomize}
                livePrice={livePriceMap.get(signal.asset)}
              />
              {/* Native sponsored card every 3 signals */}
              {(idx + 1) % 3 === 0 && (
                <NativeAd className="lg:col-span-2" forceShow />
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
