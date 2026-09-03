'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  TrendingUp,
  TrendingDown,
  Camera,
  Eye,
  Bell,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Zap,
  CreditCard,
  ArrowRight,
  BarChart3,
  Target,
  AlertTriangle,
  RefreshCw,
  Activity,
  DollarSign,
  Shield,
  ChevronRight,
  Sparkles,
  Users,
  Globe,
} from 'lucide-react'
import {
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { useLiveMarket, type LivePriceItem } from '@/hooks/use-live-market'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────────────────

interface DashboardSignal {
  id: string
  asset: string
  direction: 'BUY' | 'SELL'
  entry: number
  stopLoss?: number
  takeProfit1?: number
  confidence: number
  timeAgo: string
  market: string
  strategy?: string
  timeframe?: string
  status?: string
}

interface PerformanceStats {
  winRate: number
  totalSignals: number
  activeSignals: number
  wins: number
  losses: number
  trendWinRate: string
  trendSignals: string
  trendActive: string
  screenshotsUsed: number
  screenshotsLimit: number
  dailyPnl: number
  performanceData: { date: string; pnl: number }[]
}

interface EconomicEvent {
  id: string
  name: string
  currency: string
  impact: 'high' | 'medium' | 'low'
  countdown: string
  date?: string
  actual?: string | null
  forecast?: string | null
  previous?: string | null
}

interface MarketItem {
  asset: string
  price: number
  change: number
  direction: 'up' | 'down' | 'neutral'
  source?: 'finnhub' | 'yahoo'
}

// ─── Live price formatting helpers ─────────────────────────────────────────────

function formatMarketPrice(asset: string, price: number): string {
  if (asset.includes('BTC') && price > 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (asset.includes('ETH') && price > 100) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (asset.includes('/') && asset.includes('USD') && !asset.includes('BTC') && !asset.includes('ETH')) {
    // Forex pair: 4-5 decimals
    return price.toFixed(4)
  }
  if (price > 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (price > 1) {
    return price.toFixed(2)
  }
  return price.toFixed(4)
}

function livePriceToMarketItem(p: LivePriceItem): MarketItem {
  return {
    asset: p.symbol,
    price: p.price,
    change: p.changePercent,
    direction: p.change > 0 ? 'up' : p.change < 0 ? 'down' : 'neutral',
    source: p.source === 'mock' ? undefined : p.source,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function formatCountdown(targetMs: number): string {
  const diff = targetMs - Date.now()
  if (diff <= 0) return 'Now'
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  if (d > 0) return `${d}d ${h}h ${m.toString().padStart(2, '0')}m`
  return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`
}

function formatTimeAgo(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    const diff = Date.now() - date.getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
  } catch {
    return dateStr
  }
}

// ─── Sub Components ──────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  trendValue,
  subtitle,
  iconColor = 'text-primary',
}: {
  title: string
  value: string
  icon: React.ElementType
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  subtitle?: string
  iconColor?: string
}) {
  return (
    <Card className="relative overflow-hidden group hover:shadow-md transition-shadow duration-200">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
          </div>
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/15 transition-colors">
            <Icon className={cn('size-4', iconColor)} />
          </div>
        </div>
        {(trend || subtitle) && (
          <div className="mt-2 flex items-center gap-1.5">
            {trend && trendValue && (
              <Badge
                variant="outline"
                className={cn(
                  'gap-0.5 px-1.5 py-0 text-[10px] font-medium',
                  trend === 'up' && 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
                  trend === 'down' && 'border-red-500/30 text-red-600 dark:text-red-400',
                  trend === 'neutral' && 'border-muted-foreground/30 text-muted-foreground'
                )}
              >
                {trend === 'up' && <ArrowUpRight className="size-3" />}
                {trend === 'down' && <ArrowDownRight className="size-3" />}
                {trendValue}
              </Badge>
            )}
            {subtitle && (
              <span className="text-[11px] text-muted-foreground">{subtitle}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PerformanceChart({ data, pnlTotal }: { data: { date: string; pnl: number }[]; pnlTotal: number }) {
  const isPositive = pnlTotal >= 0

  return (
    <Card className="col-span-full lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Daily Performance (30D)</CardTitle>
            <CardDescription className="text-[11px] mt-0.5">Cumulative P&L across all signals</CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] font-semibold',
              isPositive
                ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : 'border-red-500/30 text-red-600 dark:text-red-400'
            )}
          >
            {isPositive ? '+' : ''}${Math.abs(pnlTotal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-[260px] w-full">
          {data.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="pnlGradientPositive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="pnlGradientNegative" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.88 0.02 162 / 0.3)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: 'oklch(0.5 0.02 162)' }}
                  tickLine={false}
                  axisLine={false}
                  interval={4}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'oklch(0.5 0.02 162)' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${v}`}
                />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: 'oklch(0.155 0.008 162)',
                    border: '1px solid oklch(1 0 0 / 10%)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: 'oklch(0.955 0.01 162)',
                  }}
                  formatter={(value: number) => [
                    `$${value.toFixed(2)}`,
                    'P&L',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="pnl"
                  stroke={isPositive ? '#10b981' : '#ef4444'}
                  strokeWidth={2}
                  fill={isPositive ? 'url(#pnlGradientPositive)' : 'url(#pnlGradientNegative)'}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No performance data available
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function RecentSignalsList({ signals, loading }: { signals: DashboardSignal[]; loading: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Fetch live prices for every asset referenced by the recent signals
  const signalSymbols = React.useMemo(() => {
    const set = new Set<string>()
    signals.forEach(s => { if (s.asset) set.add(s.asset) })
    return Array.from(set)
  }, [signals])
  const { prices: livePrices } = useLiveMarket({
    symbols: signalSymbols,
    refreshMs: 30_000,
    enabled: signalSymbols.length > 0,
  })
  const livePriceMap = React.useMemo(() => {
    const m = new Map<string, number>()
    livePrices.forEach(p => m.set(p.symbol, p.price))
    return m
  }, [livePrices])

  if (loading) {
    return (
      <Card className="col-span-full lg:col-span-1">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Recent Signals</CardTitle>
            <Skeleton className="h-5 w-12" />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="col-span-full lg:col-span-1">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Recent Signals</CardTitle>
          <Badge variant="outline" className="text-[10px]">
            {signals.length} new
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2 max-h-[340px] overflow-y-auto custom-scrollbar pr-1">
          {signals.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Activity className="size-8 mx-auto mb-2 opacity-40" />
              No recent signals
            </div>
          ) : (
            signals.map((signal) => {
              const isBuy = signal.direction === 'BUY'
              const isExpanded = expandedId === signal.id
              const confidenceColor = signal.confidence >= 70
                ? 'text-emerald-600 dark:text-emerald-400'
                : signal.confidence >= 50
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-red-600 dark:text-red-400'
              const confidenceDot = signal.confidence >= 70
                ? 'bg-emerald-500'
                : signal.confidence >= 50
                ? 'bg-yellow-500'
                : 'bg-red-500'

              const livePrice = livePriceMap.get(signal.asset)
              const hasLive = livePrice !== undefined
              const livePips = hasLive && signal.entry
                ? (isBuy ? livePrice! - signal.entry : signal.entry - livePrice!)
                : null
              const liveProfitable = livePips !== null ? livePips > 0 : null

              return (
                <button
                  key={signal.id}
                  onClick={() => setExpandedId(isExpanded ? null : signal.id)}
                  className={cn(
                    'w-full text-left rounded-lg border-l-[3px] p-3 transition-all duration-200',
                    'hover:bg-muted/50',
                    isBuy
                      ? 'border-l-emerald-500 bg-emerald-500/5'
                      : 'border-l-red-500 bg-red-500/5'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge
                        className={cn(
                          'px-1.5 py-0 text-[10px] font-bold',
                          isBuy
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                            : 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20 hover:bg-red-500/20'
                        )}
                      >
                        {signal.direction}
                      </Badge>
                      <span className="text-sm font-semibold">{signal.asset}</span>
                      {hasLive && (
                        <span
                          className="inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse"
                          title="Live price"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">{signal.timeAgo}</span>
                      <ChevronRight className={cn(
                        'size-3 text-muted-foreground transition-transform duration-200',
                        isExpanded && 'rotate-90'
                      )} />
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Entry: <span className="font-mono">{signal.entry}</span>
                      {hasLive && (
                        <span
                          className={cn(
                            'ml-1.5 font-mono tabular-nums',
                            liveProfitable === true
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : liveProfitable === false
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-muted-foreground'
                          )}
                        >
                          · Live: {formatMarketPrice(signal.asset, livePrice!)}
                          {livePips !== null && (
                            <span className="ml-1 text-[10px] opacity-80">
                              ({liveProfitable === true ? '+' : ''}
                              {livePips.toFixed(signal.asset.includes('/') ? 4 : 2)})
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <div className={cn('size-1.5 rounded-full', confidenceDot)} />
                      <span className={cn('text-[11px] font-medium', confidenceColor)}>
                        {signal.confidence}%
                      </span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2">
                      {signal.stopLoss && (
                        <div className="flex justify-between text-[11px]">
                          <span className="text-muted-foreground">Stop Loss</span>
                          <span className="font-mono text-red-500">{signal.stopLoss}</span>
                        </div>
                      )}
                      {signal.takeProfit1 && (
                        <div className="flex justify-between text-[11px]">
                          <span className="text-muted-foreground">Take Profit</span>
                          <span className="font-mono text-emerald-500">{signal.takeProfit1}</span>
                        </div>
                      )}
                      {signal.strategy && (
                        <div className="flex justify-between text-[11px]">
                          <span className="text-muted-foreground">Strategy</span>
                          <span>{signal.strategy}</span>
                        </div>
                      )}
                      {signal.timeframe && (
                        <div className="flex justify-between text-[11px]">
                          <span className="text-muted-foreground">Timeframe</span>
                          <span>{signal.timeframe}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-[11px]">
                        <span className="text-muted-foreground">Market</span>
                        <span>{signal.market}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-muted-foreground">Signal ID</span>
                        <span className="font-mono text-[10px]">{signal.id}</span>
                      </div>
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function QuickActions() {
  const setPage = useStore((s) => s.setPage)

  const actions = [
    { label: 'Analyze Screenshot', icon: Camera, page: 'screenshot' as const, color: 'text-primary', bg: 'bg-primary/10' },
    { label: 'View All Signals', icon: TrendingUp, page: 'signals' as const, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { label: 'Economic Calendar', icon: Calendar, page: 'calendar' as const, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
    { label: 'Set Price Alert', icon: Bell, page: 'alerts' as const, color: 'text-orange-500', bg: 'bg-orange-500/10' },
  ]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="outline"
              className="h-auto flex-col gap-2 py-3 text-xs hover:bg-muted/50 transition-colors"
              onClick={() => setPage(action.page)}
            >
              <div className={cn('flex size-8 items-center justify-center rounded-lg', action.bg)}>
                <action.icon className={cn('size-4', action.color)} />
              </div>
              {action.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * PlanUsageCard — shows the user's current plan and analyses quota.
 * Fetches from /api/packages on mount.
 */
function PlanUsageCard() {
  const setPage = useStore((s) => s.setPage)
  const [plan, setPlan] = useState<{
    plan: string
    analysesLimit: number
    analysesUsed: number
    planExpiresAt: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const ctrl = new AbortController()
    let token: string | null = null
    try {
      const stored = localStorage.getItem('toptier-store')
      if (stored) token = JSON.parse(stored)?.state?.authToken || null
    } catch {
      // ignore
    }
    fetch('/api/packages', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((json) => {
        if (json?.data?.userPlan) setPlan(json.data.userPlan)
      })
      .catch(() => {
        // silent fail — dashboard still works
      })
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [])

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Loading plan...
        </CardContent>
      </Card>
    )
  }

  const planName = plan?.plan || 'free'
  const limit = plan?.analysesLimit ?? 5
  const used = plan?.analysesUsed ?? 0
  const isUnlimited = limit === 0
  const remaining = isUnlimited ? Infinity : Math.max(0, limit - used)
  const usedPct = isUnlimited ? 0 : Math.min(100, (used / limit) * 100)
  const isFree = planName === 'free'

  return (
    <Card className={cn('overflow-hidden', isFree && 'ring-1 ring-primary/30')}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            Your Plan
          </CardTitle>
          <Badge variant={isFree ? 'secondary' : 'default'} className="capitalize">
            {planName.replace(/_/g, ' ')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">Analyses used</span>
            <span className="font-medium">
              {used} {isUnlimited ? '' : `/ ${limit}`}
            </span>
          </div>
          {!isUnlimited && (
            <>
              <Progress value={usedPct} className="h-2 mt-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {remaining} remaining this month
              </p>
            </>
          )}
          {isUnlimited && (
            <p className="text-xs text-emerald-500 mt-1 font-medium">
              Unlimited analyses available
            </p>
          )}
        </div>

        {isFree ? (
          <Button
            className="w-full"
            size="sm"
            onClick={() => setPage('pricing')}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Upgrade Plan
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            size="sm"
            onClick={() => setPage('pricing')}
          >
            Manage Subscription
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function UpcomingEvents({ events, loading, onRetry }: { events: EconomicEvent[]; loading: boolean; onRetry: () => void }) {
  const [countdowns, setCountdowns] = useState<Record<string, string>>({})

  useEffect(() => {
    if (events.length === 0) return

    const targets: Record<string, number> = {}
    events.forEach((evt) => {
      // Try to use the date field first for more accurate countdown
      if (evt.date) {
        targets[evt.name] = new Date(evt.date).getTime()
      } else {
        // Parse from countdown string
        const parts = evt.countdown.match(/(\d+)h\s*(\d+)m/)
        const days = evt.countdown.match(/(\d+)d/)
        const h = parts ? parseInt(parts[1]) : 0
        const m = parts ? parseInt(parts[2]) : 0
        const d = days ? parseInt(days[1]) : 0
        targets[evt.name] = Date.now() + d * 86400000 + h * 3600000 + m * 60000
      }
    })

    const update = () => {
      const c: Record<string, string> = {}
      Object.entries(targets).forEach(([name, target]) => {
        c[name] = formatCountdown(target)
      })
      setCountdowns(c)
    }

    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [events])

  const impactColor = (impact: 'high' | 'medium' | 'low') => {
    switch (impact) {
      case 'high': return 'bg-red-500'
      case 'medium': return 'bg-yellow-500'
      case 'low': return 'bg-emerald-500'
    }
  }

  const impactLabel = (impact: 'high' | 'medium' | 'low') => {
    switch (impact) {
      case 'high': return 'High'
      case 'medium': return 'Med'
      case 'low': return 'Low'
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Upcoming Events</CardTitle>
            <Skeleton className="h-5 w-16" />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Upcoming Events</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] text-muted-foreground"
            onClick={() => useStore.getState().setPage('calendar')}
          >
            View All <ArrowRight className="ml-1 size-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-3">
          {events.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              <Calendar className="size-8 mx-auto mb-2 opacity-40" />
              No upcoming high-impact events
            </div>
          ) : (
            events.map((evt) => (
              <div
                key={evt.name}
                className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={cn('size-2 shrink-0 rounded-full', impactColor(evt.impact))} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{evt.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{evt.currency}</span>
                      <Badge variant="outline" className="px-1 py-0 text-[9px]">
                        {impactLabel(evt.impact)}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Clock className="size-3 text-muted-foreground" />
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {countdowns[evt.name] || evt.countdown}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function MarketOverviewTable() {
  const { prices, loading, lastUpdated, refresh, source } = useLiveMarket({
    overview: true,
    refreshMs: 30_000,
  })

  // Map live prices to the table's expected shape. If none arrive, show an
  // honest "unavailable" state instead of fabricated numbers.
  const items: MarketItem[] = prices.map(livePriceToMarketItem)

  const isLive = source === 'finnhub' || source === 'yahoo' || source === 'mixed'
  const sourceLabel =
    source === 'finnhub' ? 'Finnhub' :
    source === 'yahoo' ? 'Yahoo Finance' :
    source === 'mixed' ? 'Finnhub + Yahoo' :
    'No data source configured'
  const lastUpdatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'

  return (
    <Card className="col-span-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              Market Overview
              {isLive && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-[11px] mt-0.5">
              Major pairs &amp; assets · {sourceLabel} · Updated {lastUpdatedLabel}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-muted-foreground"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw className={cn('size-3 mr-1', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] text-muted-foreground"
              onClick={() => useStore.getState().setPage('watchlist')}
            >
              View Watchlist <ArrowRight className="ml-1 size-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50">
                <th className="pb-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Asset</th>
                <th className="pb-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Price</th>
                <th className="pb-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Change</th>
                <th className="pb-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dir</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-xs text-muted-foreground">
                    Market data is currently unavailable. Try refreshing in a moment.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                <tr key={item.asset} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="py-2.5 text-sm font-medium">
                    {item.asset}
                    {item.source && (
                      <span className="ml-1 inline-block size-1.5 rounded-full bg-emerald-500/70" title={`Source: ${item.source}`} />
                    )}
                  </td>
                  <td className="py-2.5 text-right text-sm font-mono tabular-nums">
                    {loading && !item.price ? '—' : formatMarketPrice(item.asset, item.price)}
                  </td>
                  <td
                    className={cn(
                      'py-2.5 text-right text-sm font-medium tabular-nums',
                      item.change > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : item.change < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-muted-foreground'
                    )}
                  >
                    {item.change > 0 ? '+' : ''}{item.change.toFixed(2)}%
                  </td>
                  <td className="py-2.5 text-right">
                    {item.direction === 'up' ? (
                      <ArrowUpRight className="ml-auto size-4 text-emerald-500" />
                    ) : item.direction === 'down' ? (
                      <ArrowDownRight className="ml-auto size-4 text-red-500" />
                    ) : (
                      <span className="ml-auto block text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function SubscriptionBanner() {
  const user = useStore((s) => s.user)
  const setPage = useStore((s) => s.setPage)
  const isFree = !user?.subscriptionTier || user?.subscriptionTier === 'free'

  if (!isFree) return null

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
            <Zap className="size-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              You&apos;re on the Free plan.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upgrade to Pro or Premium for real-time signals, unlimited screenshot analysis, and priority support.
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => setPage('subscriptions')}
          >
            <CreditCard className="size-3.5" />
            Upgrade
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function WinLossBar({ wins, losses, total }: { wins: number; losses: number; total: number }) {
  const winPct = total > 0 ? (wins / total) * 100 : 0

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Win / Loss Ratio</span>
        <span className="font-medium">
          <span className="text-emerald-600 dark:text-emerald-400">{wins}W</span>
          {' / '}
          <span className="text-red-600 dark:text-red-400">{losses}L</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden flex">
        <div
          className="bg-emerald-500 transition-all duration-500 rounded-l-full"
          style={{ width: `${winPct}%` }}
        />
        <div
          className="bg-red-500 transition-all duration-500 rounded-r-full"
          style={{ width: `${100 - winPct}%` }}
        />
      </div>
    </div>
  )
}

function ScreenshotUsageCard({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? (used / limit) * 100 : 0
  const isExceeded = used >= limit

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Screenshot Analysis</CardTitle>
          <Badge variant={isExceeded ? 'destructive' : 'outline'} className="text-[10px]">
            {used}/{limit} used
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <Progress value={pct} className="h-2" />
        <p className="text-[11px] text-muted-foreground">
          {isExceeded
            ? 'You have reached your free analysis limit. Upgrade for unlimited access.'
            : `${limit - used} free analyses remaining this month.`
          }
        </p>
        {isExceeded && (
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1.5"
            onClick={() => useStore.getState().setPage('subscriptions')}
          >
            <Sparkles className="size-3.5" />
            Upgrade for Unlimited
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function CommunityStats() {
  const [stats, setStats] = useState<{ traders: number; countries: number; totalSignals: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    api.get('/platform/stats')
      .then((res: any) => {
        if (!cancelled) setStats(res?.data ?? res ?? null)
      })
      .catch(() => { /* leave stats null — shows honest placeholders */ })
    return () => { cancelled = true }
  }, [])

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Community</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] text-muted-foreground"
            onClick={() => useStore.getState().setPage('community')}
          >
            Join <ArrowRight className="ml-1 size-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="flex items-center justify-center mb-1">
              <Users className="size-4 text-primary" />
            </div>
            <p className="text-sm font-bold">{stats ? stats.traders.toLocaleString() : '—'}</p>
            <p className="text-[10px] text-muted-foreground">Traders</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center mb-1">
              <Globe className="size-4 text-primary" />
            </div>
            <p className="text-sm font-bold">{stats ? stats.countries.toLocaleString() : '—'}</p>
            <p className="text-[10px] text-muted-foreground">Countries</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center mb-1">
              <Shield className="size-4 text-primary" />
            </div>
            <p className="text-sm font-bold">{stats ? stats.totalSignals.toLocaleString() : '—'}</p>
            <p className="text-[10px] text-muted-foreground">Signals</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────────

function DashboardLoadingSkeleton() {
  return (
    <div className="p-3 lg:p-4 space-y-4 lg:space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-8 w-16" />
                </div>
                <Skeleton className="size-9 rounded-lg" />
              </div>
              <Skeleton className="mt-2 h-4 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Skeleton className="col-span-full lg:col-span-2 h-[320px] rounded-xl" />
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-[200px] rounded-xl" />
        <Skeleton className="h-[200px] rounded-xl" />
        <Skeleton className="h-[200px] rounded-xl" />
      </div>
      <Skeleton className="h-[240px] rounded-xl" />
    </div>
  )
}

// ─── Error State ─────────────────────────────────────────────────────────────────

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="p-4 lg:p-6">
      <Card className="border-red-500/20 bg-red-500/5">
        <CardContent className="p-6">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle className="size-6 text-red-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Failed to load dashboard data</h3>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────────

export function DashboardPage() {
  const user = useStore((s) => s.user)
  const [signals, setSignals] = useState<DashboardSignal[]>([])
  const [stats, setStats] = useState<PerformanceStats | null>(null)
  const [events, setEvents] = useState<EconomicEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDashboardData = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)

      // Fetch all data in parallel — NOTE: api client already prepends /api
      const [signalsRes, perfRes, eventsRes] = await Promise.allSettled([
        api.get('/signals?status=active&limit=5', { signal }),
        api.get('/performance', { signal }),
        api.get('/calendar?impact=high&limit=3', { signal }),
      ])

      if (signal?.aborted) return

      // Process signals — API returns { data: { signals: [...] } }
      if (signalsRes.status === 'fulfilled' && signalsRes.value) {
        const res = signalsRes.value as any
        const rawSignals = Array.isArray(res?.data)
          ? res.data
          : res?.data?.signals
            ? Array.isArray(res.data.signals) ? res.data.signals : []
            : Array.isArray(res?.signals) ? res.signals : []

        setSignals(
          rawSignals.map((s: any) => ({
            id: s.id || s.signalId || '',
            asset: s.asset || s.pair || '',
            direction: s.direction || (s.type === 'long' || s.type === 'BUY' ? 'BUY' : 'SELL'),
            entry: s.entryPrice || s.entry || 0,
            stopLoss: s.stopLoss || undefined,
            takeProfit1: s.takeProfit1 || s.takeProfit || undefined,
            confidence: s.confidence || 0,
            timeAgo: s.timeAgo || formatTimeAgo(s.createdAt) || '',
            market: s.market || s.marketType || '',
            strategy: s.strategy || undefined,
            timeframe: s.timeframe || undefined,
            status: s.status || 'active',
          }))
        )
      }

      // Process performance — API returns { data: { overview: { winRate, totalSignals, ... }, marketBreakdown, ... } }
      if (perfRes.status === 'fulfilled' && perfRes.value) {
        const res = perfRes.value as any
        const d = res?.data?.overview || res?.data || res?.overview || {}
        const perfData = res?.data?.performanceData || res?.performanceData || []

        setStats({
          winRate: d.winRate ?? 0,
          totalSignals: d.totalSignals ?? 0,
          activeSignals: d.activeSignals ?? d.monthlySignals ?? 0,
          wins: d.wins ?? 0,
          losses: d.losses ?? 0,
          trendWinRate: d.trendWinRate ?? '+0%',
          trendSignals: d.trendSignals ?? '+0',
          trendActive: d.trendActive ?? '+0',
          screenshotsUsed: d.screenshotsUsed ?? 0,
          screenshotsLimit: d.screenshotsLimit ?? (user?.subscriptionTier === 'pro' || user?.subscriptionTier === 'premium' ? 999 : 2),
          dailyPnl: d.dailyPnl ?? 0,
          performanceData: perfData,
        })
      }

      // Process events — API returns { data: [...] } or { data: { events: [...] } }
      if (eventsRes.status === 'fulfilled' && eventsRes.value) {
        const res = eventsRes.value as any
        const rawEvents = Array.isArray(res?.data)
          ? res.data
          : res?.data?.events
            ? Array.isArray(res.data.events) ? res.data.events : []
            : Array.isArray(res?.events) ? res.events : []

        setEvents(
          rawEvents.map((e: any) => ({
            id: e.id || '',
            name: e.name || e.event || e.title || '',
            currency: e.currency || '',
            impact: e.impact || e.impactLevel || 'medium',
            countdown: e.countdown || e.timeUntil || '',
            date: e.date || e.eventDate || undefined,
            actual: e.actual ?? null,
            forecast: e.forecast ?? null,
            previous: e.previous ?? null,
          }))
        )
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err)
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }, [user?.subscriptionTier])

  useEffect(() => {
    const controller = new AbortController()
    fetchDashboardData(controller.signal)
    return () => controller.abort()
  }, [fetchDashboardData])

  if (loading) return <DashboardLoadingSkeleton />

  // Show error state only if there's truly no data
  if (error && !stats && signals.length === 0) return <ErrorState error={error} onRetry={fetchDashboardData} />

  const performanceData = stats?.performanceData || []
  const pnlTotal = performanceData.reduce((sum, d) => sum + d.pnl, 0)

  return (
    <div className="p-3 lg:p-4 space-y-4 lg:space-y-5">
      {/* Subscription Banner */}
      <SubscriptionBanner />

      {/* Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            Welcome back, {user?.name?.split(' ')[0] || 'Trader'}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Here&apos;s your trading overview for today
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => fetchDashboardData()}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {/* Top Stats Row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Signals"
          value={String(stats?.totalSignals ?? 0)}
          icon={TrendingUp}
          trend="up"
          trendValue={stats?.trendSignals ?? '+0%'}
          subtitle="vs last month"
          iconColor="text-emerald-500"
        />
        <StatCard
          title="Win Rate"
          value={`${stats?.winRate?.toFixed(1) ?? 0}%`}
          icon={Target}
          trend={(stats?.winRate ?? 0) >= 50 ? 'up' : 'down'}
          trendValue={stats?.trendWinRate ?? '+0%'}
          subtitle="last 30 days"
          iconColor="text-primary"
        />
        <StatCard
          title="Active Signals"
          value={String(stats?.activeSignals ?? 0)}
          icon={BarChart3}
          trend="up"
          trendValue={stats?.trendActive ?? '+0'}
          subtitle="being monitored"
          iconColor="text-blue-500"
        />
        <StatCard
          title="Daily P&L"
          value={`${(stats?.dailyPnl ?? 0) >= 0 ? '+' : ''}$${Math.abs(stats?.dailyPnl ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={DollarSign}
          trend={(stats?.dailyPnl ?? 0) >= 0 ? 'up' : 'down'}
          trendValue={((stats?.dailyPnl ?? 0) >= 0 ? '+' : '') + `${stats?.dailyPnl?.toFixed(2) ?? '0.00'}`}
          subtitle="today's performance"
          iconColor={(stats?.dailyPnl ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}
        />
      </div>

      {/* Win/Loss Bar */}
      <WinLossBar
        wins={stats?.wins ?? 0}
        losses={stats?.losses ?? 0}
        total={stats?.totalSignals ?? 0}
      />

      {/* Performance Chart + Recent Signals */}
      <div className="grid gap-3 lg:grid-cols-3">
        <PerformanceChart data={performanceData} pnlTotal={pnlTotal} />
        <RecentSignalsList signals={signals} loading={false} />
      </div>

      {/* Quick Actions + Upcoming Events + Screenshot Usage */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <QuickActions />
        <UpcomingEvents events={events} loading={false} onRetry={fetchDashboardData} />
        <div className="space-y-3">
          <PlanUsageCard />
          <ScreenshotUsageCard
            used={stats?.screenshotsUsed ?? 0}
            limit={stats?.screenshotsLimit ?? 2}
          />
          <CommunityStats />
        </div>
      </div>

      {/* Market Overview */}
      <MarketOverviewTable />
    </div>
  )
}
