'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import {
  Clock,
  Flame,
  Target,
  Gauge,
  Timer,
  Activity,
  BarChart3,
  TrendingUp,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { t } from '@/lib/i18n/config'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'

// ─── Types ──────────────────────────────────────────────────────────────────────

interface UsageSummary {
  todayMinutes: number
  todaySessions: number
  weekMinutes: number
  weekSessions: number
  allTimeMinutes: number
  totalSessions: number
  avgSessionMinutes: number
  streakDays: number
}

interface WinRateData {
  botTrades: number
  botWinRate: number
  paperTrades: number
  paperWinRate: number
  total: number
  overallWinRate: number
}

interface SeriesPoint {
  date: string
  minutes: number
  sessions: number
  trades: number
  winRate?: number
}

interface FeatureCount {
  feature: string
  count: number
}

interface SummaryResponse {
  optedOut: boolean
  usage: UsageSummary
  winRate: WinRateData
  topFeatures: FeatureCount[]
}

// ─── Chart config ──────────────────────────────────────────────────────────────

const chartConfig: ChartConfig = {
  minutes: { label: 'Active minutes', color: '#1b4f9c' },
  winRate: { label: 'Win rate %', color: '#10b981' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function featureLabel(feature: string): string {
  const known = t(`page.${feature}`)
  if (known !== `page.${feature}`) return known
  return feature
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function formatMinutes(mins: number): string {
  if (mins >= 60) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m ? `${h}h ${m}m` : `${h}h`
  }
  return `${mins}m`
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 font-display text-3xl font-bold text-foreground">{value}</p>
            {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
          </div>
          <div className="rounded-lg bg-[#1b4f9c]/10 p-2 text-[#1b4f9c] dark:text-[#7aa7e6]">
            <Icon className="size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function StatsPage() {
  const user = useStore((s) => s.user)
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [series, setSeries] = useState<SeriesPoint[]>([])
  const [range, setRange] = useState<'7d' | '30d'>('7d')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      setError(null)
      const [summaryResult, seriesResult] = await Promise.all([
        api.get<{ success: boolean; data: SummaryResponse }>('/tracking/summary'),
        api.get<{ success: boolean; data: { series: SeriesPoint[] } }>(`/tracking/timeseries?range=${range}`),
      ])
      const s = (summaryResult as any)?.data ?? summaryResult
      const ser = (seriesResult as any)?.data ?? seriesResult
      setSummary(s)
      setSeries((ser.series || []).map((p: any) => ({ ...p, winRate: p.winRate ?? undefined })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity data')
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    setLoading(true)
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!live) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchData()
    }, 30000)
    return () => window.clearInterval(id)
  }, [live, fetchData])

  if (loading && !summary) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-9 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-[320px] w-full" />
      </div>
    )
  }

  const usage = summary?.usage
  const winRate = summary?.winRate

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
            {t('page.stats')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time tracking of your time in the app, feature usage and trading win rate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`gap-1.5 ${live ? 'text-emerald-500 border-emerald-500/40' : 'text-muted-foreground'}`}
          >
            <span className={`relative flex size-2 ${live ? '' : 'opacity-40'}`}>
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 ${live ? '' : 'hidden'}`} />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            {live ? 'LIVE' : 'PAUSED'}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLive((v) => !v)}
            className="gap-1.5"
          >
            {live ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {live ? 'Pause' : 'Resume'}
          </Button>
        </div>
      </div>

      {/* Opt-out notice */}
      {summary?.optedOut ? (
        <Card className="border-amber-500/40">
          <CardContent className="flex items-start gap-3 p-5">
            <EyeOff className="mt-0.5 size-5 text-amber-500" />
            <div>
              <p className="font-medium text-foreground">Tracking is turned off</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your privacy setting disables app-usage tracking. Enable it in Settings → Privacy to see your activity here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card className="border-red-500/40">
          <CardContent className="p-5 text-sm text-red-500">{error}</CardContent>
        </Card>
      ) : null}

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Timer}
          label="Today"
          value={formatMinutes(usage?.todayMinutes ?? 0)}
          sub={`${usage?.todaySessions ?? 0} sessions`}
        />
        <StatCard
          icon={Clock}
          label="This Week"
          value={formatMinutes(usage?.weekMinutes ?? 0)}
          sub={`${usage?.weekSessions ?? 0} sessions`}
        />
        <StatCard
          icon={Gauge}
          label="All Time"
          value={formatMinutes(usage?.allTimeMinutes ?? 0)}
          sub={`${usage?.totalSessions ?? 0} sessions · ${usage?.avgSessionMinutes ?? 0} min avg`}
        />
        <StatCard
          icon={Target}
          label="Win Rate"
          value={`${winRate?.overallWinRate ?? 0}%`}
          sub={`${winRate?.total ?? 0} closed trades`}
        />
      </div>

      {/* Live graph */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-[#1b4f9c]" />
              Live Activity
            </CardTitle>
            <CardDescription>
              Active minutes per day with your daily win rate overlaid.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            {(['7d', '30d'] as const).map((r) => (
              <Button
                key={r}
                variant={range === r ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRange(r)}
              >
                {r}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[320px] w-full">
            <ComposedChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-muted/40" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v: string) => v.slice(5)}
                className="text-xs"
              />
              <YAxis yAxisId="minutes" tickLine={false} axisLine={false} className="text-xs" />
              <YAxis yAxisId="winRate" orientation="right" domain={[0, 100]} tickLine={false} axisLine={false} className="text-xs" />
              <Tooltip
                contentStyle={{ borderRadius: '12px' }}
                labelFormatter={(label) => label as string}
                formatter={(value: any, name: any) => [
                  name === 'winRate' ? `${value}%` : `${value} min`,
                  name === 'winRate' ? 'Win rate' : 'Active minutes',
                ]}
              />
              <Area
                yAxisId="minutes"
                type="monotone"
                dataKey="minutes"
                stroke="#1b4f9c"
                fill="url(#statsMinutes)"
                strokeWidth={2}
              />
              <Line
                yAxisId="winRate"
                type="monotone"
                dataKey="winRate"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
              <defs>
                <linearGradient id="statsMinutes" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1b4f9c" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#1b4f9c" stopOpacity={0} />
                </linearGradient>
              </defs>
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Win rate breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4 text-[#1b4f9c]" />
              Win Rate Breakdown
            </CardTitle>
            <CardDescription>
              Closed trades across your bot and paper trading.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Overall</span>
                <span className="font-mono font-semibold">{winRate?.overallWinRate ?? 0}%</span>
              </div>
              <Progress value={winRate?.overallWinRate ?? 0} className="h-2.5" />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Trading bot ({winRate?.botTrades ?? 0} trades)</span>
                <span className="font-mono font-semibold">{winRate?.botWinRate ?? 0}%</span>
              </div>
              <Progress value={winRate?.botWinRate ?? 0} className="h-2.5" />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Paper trading ({winRate?.paperTrades ?? 0} trades)</span>
                <span className="font-mono font-semibold">{winRate?.paperWinRate ?? 0}%</span>
              </div>
              <Progress value={winRate?.paperWinRate ?? 0} className="h-2.5" />
            </div>
            <p className="text-xs text-muted-foreground">
              Win rate only counts closed trades with a clear win or loss outcome.
            </p>
          </CardContent>
        </Card>

        {/* Feature usage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="size-4 text-[#1b4f9c]" />
              Most Used Features
            </CardTitle>
            <CardDescription>Last 30 days of feature usage.</CardDescription>
          </CardHeader>
          <CardContent>
            {summary && summary.topFeatures.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No usage yet — start exploring the app and it will show up here.
              </p>
            ) : (
              <div className="space-y-4">
                {(summary?.topFeatures || []).map((f, i) => {
                  const max = summary!.topFeatures[0].count || 1
                  return (
                    <div key={f.feature}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                          {featureLabel(f.feature)}
                        </span>
                        <span className="font-mono text-muted-foreground">{f.count}</span>
                      </div>
                      <Progress value={(f.count / max) * 100} className="h-2" />
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Flame className="size-4 text-orange-500" />
        {usage?.streakDays ? (
          <span>{usage.streakDays}-day active streak — keep it going!</span>
        ) : (
          <span>Your active streak starts the first day you use the app.</span>
        )}
        {user?.name ? ` · Signed in as ${user.name}` : null}
      </div>
    </div>
  )
}
