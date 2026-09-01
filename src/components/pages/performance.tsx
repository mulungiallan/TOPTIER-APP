'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts'
import {
  Trophy,
  TrendingDown,
  Minus,
  BarChart3,
  Target,
  Flame,
  Snowflake,
  Brain,
  CheckCircle2,
  XCircle,
  Download,
  FileSpreadsheet,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'

// ─── Types ──────────────────────────────────────────────────────────────────────

interface PerformanceData {
  winRate: number
  lossRate: number
  breakevenRate: number
  avgRiskReward: string
  totalSignals: number
  monthlySignals: number
  consecutiveWins: number
  longestWinStreak: number
  consecutiveLosses: number
  longestLossStreak: number
  avgConfidence: number
  avgOutcome: number
  acceptedCount: number
  ignoredCount: number
  monthlyPerformance: { month: string; wins: number; losses: number }[]
  winRateTrend: { week: string; winRate: number }[]
  marketPerformance: { name: string; value: number; color: string }[]
  strategyBreakdown: { strategy: string; winRate: number; totalSignals: number; avgRR: string; profit: string }[]
  marketBreakdown: { market: string; winRate: number; totalSignals: number; avgRR: string; profit: string }[]
  assetBreakdown: { asset: string; winRate: number; totalSignals: number; avgRR: string }[]
  timeframeBreakdown: { timeframe: string; winRate: number; totalSignals: number; avgRR: string }[]
  sessionBreakdown: { session: string; winRate: number; totalSignals: number; avgRR: string; peakHours: string }[]
}

// ─── Chart configs ──────────────────────────────────────────────────────────────

const barChartConfig: ChartConfig = {
  wins: { label: 'Wins', color: '#10b981' },
  losses: { label: 'Losses', color: '#ef4444' },
}

const lineChartConfig: ChartConfig = {
  winRate: { label: 'Win Rate %', color: '#10b981' },
}

const pieChartConfig: ChartConfig = {
  Forex: { label: 'Forex', color: '#10b981' },
  Crypto: { label: 'Crypto', color: '#f59e0b' },
  Stocks: { label: 'Stocks', color: '#6366f1' },
  Indices: { label: 'Indices', color: '#ec4899' },
  Commodities: { label: 'Commodities', color: '#14b8a6' },
}

const defaultMarketColors = ['#10b981', '#f59e0b', '#6366f1', '#ec4899', '#14b8a6']

// ─── Circular Progress Component ────────────────────────────────────────────

function CircularProgress({
  value,
  size = 80,
  strokeWidth = 6,
  color = '#10b981',
  bgColor = 'rgba(255,255,255,0.1)',
}: {
  value: number
  size?: number
  strokeWidth?: number
  color?: string
  bgColor?: string
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (value / 100) * circumference

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={bgColor}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
    </svg>
  )
}

// ─── Loading Skeletons ─────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[300px] w-full rounded-lg" />
      </CardContent>
    </Card>
  )
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-48" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-4 flex-1" />
            ))}
          </div>
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex gap-4">
              {Array.from({ length: 5 }).map((_, j) => (
                <Skeleton key={j} className="h-6 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Error State ────────────────────────────────────────────────────────────────

function PerformanceErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="p-4 md:p-6">
      <Card className="border-red-500/20 bg-red-500/5">
        <CardContent className="p-6">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle className="size-6 text-red-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Failed to load performance data</h3>
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

// ─── Export Helpers (CSV + Excel) ───────────────────────────────────────────────

function buildExportRows(data: PerformanceData | null): string[][] {
  if (!data) return []

  const rows: string[][] = []

  // Overview stats
  rows.push(['Performance Overview'])
  rows.push(['Win Rate', `${data.winRate}%`])
  rows.push(['Loss Rate', `${data.lossRate}%`])
  rows.push(['Breakeven Rate', `${data.breakevenRate}%`])
  rows.push(['Avg Risk:Reward', data.avgRiskReward])
  rows.push(['Total Signals', String(data.totalSignals)])
  rows.push(['Monthly Signals', String(data.monthlySignals)])
  rows.push(['Consecutive Wins', String(data.consecutiveWins)])
  rows.push(['Longest Win Streak', String(data.longestWinStreak)])
  rows.push(['Consecutive Losses', String(data.consecutiveLosses)])
  rows.push(['Longest Loss Streak', String(data.longestLossStreak)])
  rows.push([])

  // Strategy breakdown
  rows.push(['Strategy Breakdown'])
  rows.push(['Strategy', 'Win Rate', 'Total Signals', 'Avg R:R', 'Net P&L'])
  data.strategyBreakdown.forEach((row) => {
    rows.push([row.strategy, `${row.winRate}%`, String(row.totalSignals), row.avgRR, row.profit])
  })
  rows.push([])

  // Market breakdown
  rows.push(['Market Breakdown'])
  rows.push(['Market', 'Win Rate', 'Total Signals', 'Avg R:R', 'Net P&L'])
  data.marketBreakdown.forEach((row) => {
    rows.push([row.market, `${row.winRate}%`, String(row.totalSignals), row.avgRR, row.profit])
  })
  rows.push([])

  // Asset breakdown
  rows.push(['Asset Breakdown'])
  rows.push(['Asset', 'Win Rate', 'Total Signals', 'Avg R:R'])
  data.assetBreakdown.forEach((row) => {
    rows.push([row.asset, `${row.winRate}%`, String(row.totalSignals), row.avgRR])
  })
  rows.push([])

  // Timeframe breakdown
  rows.push(['Timeframe Breakdown'])
  rows.push(['Timeframe', 'Win Rate', 'Total Signals', 'Avg R:R'])
  data.timeframeBreakdown.forEach((row) => {
    rows.push([row.timeframe, `${row.winRate}%`, String(row.totalSignals), row.avgRR])
  })
  rows.push([])

  // Session breakdown
  rows.push(['Session Breakdown'])
  rows.push(['Session', 'Win Rate', 'Total Signals', 'Avg R:R', 'Peak Hours'])
  data.sessionBreakdown.forEach((row) => {
    rows.push([row.session, `${row.winRate}%`, String(row.totalSignals), row.avgRR, row.peakHours])
  })

  return rows
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function exportToCSV(data: PerformanceData | null, range: string) {
  const rows = buildExportRows(data)
  if (!rows.length) return

  const csvContent = rows.map((r) => r.map((cell) => `"${cell}"`).join(',')).join('\n')
  downloadBlob(
    new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }),
    `performance_${range}_${new Date().toISOString().split('T')[0]}.csv`
  )
}

// Generates a real Excel .xls workbook (SpreadsheetML 2003 XML) without any
// third-party dependency. Excel/WPS/LibreOffice open this natively.
function exportToExcel(data: PerformanceData | null, range: string) {
  const rows = buildExportRows(data)
  if (!rows.length) return

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const cells = rows
    .map((row) => {
      if (row.length === 0) return '    <Row ss:AutoFitHeight="0"/>'
      const cellXml = row
        .map((cell) => `    <Cell><Data ss:Type="String">${esc(String(cell))}</Data></Cell>`)
        .join('\n')
      return `    <Row>\n${cellXml}\n    </Row>`
    })
    .join('\n')

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="Performance">
  <Table>
${cells}
  </Table>
 </Worksheet>
</Workbook>`

  downloadBlob(
    new Blob([xml], { type: 'application/vnd.ms-excel' }),
    `performance_${range}_${new Date().toISOString().split('T')[0]}.xls`
  )
}

// ─── Map API response to local data ────────────────────────────────────────────

function mapPerformanceData(raw: any): PerformanceData {
  const d = raw?.data || raw
  return {
    winRate: d.winRate ?? 0,
    lossRate: d.lossRate ?? 0,
    breakevenRate: d.breakevenRate ?? 0,
    avgRiskReward: d.avgRiskReward || d.avgRR || '1:0',
    totalSignals: d.totalSignals ?? 0,
    monthlySignals: d.monthlySignals ?? 0,
    consecutiveWins: d.consecutiveWins ?? 0,
    longestWinStreak: d.longestWinStreak ?? d.consecutiveWins ?? 0,
    consecutiveLosses: d.consecutiveLosses ?? 0,
    longestLossStreak: d.longestLossStreak ?? d.consecutiveLosses ?? 0,
    avgConfidence: d.avgConfidence ?? 0,
    avgOutcome: d.avgOutcome ?? d.winRate ?? 0,
    acceptedCount: d.acceptedVsIgnored?.accepted ?? d.acceptedCount ?? 0,
    ignoredCount: d.acceptedVsIgnored?.ignored ?? d.ignoredCount ?? 0,
    monthlyPerformance: d.monthlyPerformance || [
      { month: 'Jan', wins: 0, losses: 0 },
      { month: 'Feb', wins: 0, losses: 0 },
      { month: 'Mar', wins: 0, losses: 0 },
      { month: 'Apr', wins: 0, losses: 0 },
      { month: 'May', wins: 0, losses: 0 },
      { month: 'Jun', wins: 0, losses: 0 },
    ],
    winRateTrend: d.winRateTrend || [],
    marketPerformance: (d.marketBreakdown || d.marketPerformance || []).map((m: any, i: number) => ({
      name: m.name || m.market || '',
      value: m.value || m.winRate || 0,
      color: m.color || defaultMarketColors[i % defaultMarketColors.length],
    })),
    strategyBreakdown: (d.strategyBreakdown || []).map((s: any) => ({
      strategy: s.strategy || '',
      winRate: s.winRate ?? 0,
      totalSignals: s.totalSignals ?? 0,
      avgRR: s.avgRR || '1:0',
      profit: s.profit || '$0',
    })),
    marketBreakdown: (d.marketBreakdown || []).map((m: any) => ({
      market: m.market || m.name || '',
      winRate: m.winRate ?? m.value ?? 0,
      totalSignals: m.totalSignals ?? 0,
      avgRR: m.avgRR || '1:0',
      profit: m.profit || '$0',
    })),
    assetBreakdown: (d.assetBreakdown || []).map((a: any) => ({
      asset: a.asset || '',
      winRate: a.winRate ?? 0,
      totalSignals: a.totalSignals ?? 0,
      avgRR: a.avgRR || '1:0',
    })),
    timeframeBreakdown: (d.timeframeBreakdown || []).map((t: any) => ({
      timeframe: t.timeframe || '',
      winRate: t.winRate ?? 0,
      totalSignals: t.totalSignals ?? 0,
      avgRR: t.avgRR || '1:0',
    })),
    sessionBreakdown: (d.sessionBreakdown || []).map((s: any) => ({
      session: s.session || '',
      winRate: s.winRate ?? 0,
      totalSignals: s.totalSignals ?? 0,
      avgRR: s.avgRR || '1:0',
      peakHours: s.peakHours || '',
    })),
  }
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function PerformancePage() {
  const { user } = useStore()
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState('month')
  const [exportRange, setExportRange] = React.useState('6m')

  const fetchPerformance = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const result = await api.get(`/performance?period=${period}`)
      setData(mapPerformanceData(result))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    fetchPerformance()
  }, [fetchPerformance])

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-6 w-44" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-8 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="size-20 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-lg" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-6 w-20" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
        <ChartSkeleton />
        <TableSkeleton />
        <TableSkeleton />
        <TableSkeleton />
      </div>
    )
  }

  if (error) {
    return <PerformanceErrorState error={error} onRetry={fetchPerformance} />
  }

  if (!data) return null

  const winRate = data.winRate
  const lossRate = data.lossRate
  const breakevenRate = data.breakevenRate
  const avgRR = data.avgRiskReward

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Performance Analytics</h1>
          <p className="text-muted-foreground mt-1">Track your trading performance with detailed analytics</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period Selector */}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[130px]">
              <Calendar className="size-3.5 mr-1.5" />
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="text-sm">
            <Calendar className="size-3.5 mr-1.5" />
            Last updated: Today, {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC
          </Badge>
        </div>
      </div>

      {/* Overall Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Win Rate Card */}
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Win Rate</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-bold text-emerald-500">{winRate}%</span>
                  <ArrowUpRight className="size-4 text-emerald-500" />
                </div>
                <p className="text-xs text-emerald-500 mt-1">+3.2% from last month</p>
              </div>
              <div className="relative">
                <CircularProgress value={winRate} color="#10b981" size={80} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Trophy className="size-5 text-emerald-500" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Loss Rate Card */}
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Loss Rate</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-bold text-red-500">{lossRate}%</span>
                  <ArrowDownRight className="size-4 text-red-500" />
                </div>
                <p className="text-xs text-red-500 mt-1">-2.1% from last month</p>
              </div>
              <div className="relative">
                <CircularProgress value={lossRate} color="#ef4444" size={80} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <TrendingDown className="size-5 text-red-500" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Breakeven/Expired Rate Card */}
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Breakeven / Expired</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-bold text-yellow-500">{breakevenRate}%</span>
                  <Minus className="size-4 text-yellow-500" />
                </div>
                <p className="text-xs text-yellow-500 mt-1">-1.1% from last month</p>
              </div>
              <div className="relative">
                <CircularProgress value={breakevenRate} color="#eab308" size={80} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Minus className="size-5 text-yellow-500" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Avg R:R Card */}
        <Card className="border-l-4 border-l-primary">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg Risk-to-Reward</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-bold text-primary">{avgRR}</span>
                  <ArrowUpRight className="size-4 text-primary" />
                </div>
                <p className="text-xs text-primary mt-1">+0.3 from last month</p>
              </div>
              <div className="flex size-20 items-center justify-center rounded-full bg-primary/10">
                <Target className="size-8 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <BarChart3 className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Signals (All Time)</p>
                <p className="text-2xl font-bold">{data.totalSignals}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <Flame className="size-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">This Month&apos;s Signals</p>
                <p className="text-2xl font-bold">{data.monthlySignals}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <Flame className="size-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Consecutive Wins</p>
                <p className="text-2xl font-bold">{data.consecutiveWins} <span className="text-sm font-normal text-muted-foreground">/ {data.longestWinStreak} longest</span></p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-red-500/10">
                <Snowflake className="size-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Consecutive Losses</p>
                <p className="text-2xl font-bold">{data.consecutiveLosses} <span className="text-sm font-normal text-muted-foreground">/ {data.longestLossStreak} longest</span></p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-purple-500/10">
                <Brain className="size-5 text-purple-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Confidence vs Outcome</p>
                <p className="text-2xl font-bold">{data.avgConfidence}% <span className="text-sm font-normal text-muted-foreground">→ {data.avgOutcome}%</span></p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10">
                <CheckCircle2 className="size-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Signals Accepted / Ignored</p>
                <p className="text-2xl font-bold">{data.acceptedCount} <span className="text-sm font-normal text-muted-foreground">/ {data.ignoredCount}</span></p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Monthly Performance Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Monthly Performance</CardTitle>
            <CardDescription>Wins vs Losses over the last 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={barChartConfig} className="h-[300px] w-full">
              <BarChart data={data.monthlyPerformance} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend />
                <Bar dataKey="wins" fill="var(--color-wins)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="losses" fill="var(--color-losses)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Win Rate Trend Line Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Win Rate Trend</CardTitle>
            <CardDescription>Weekly win rate percentage over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={lineChartConfig} className="h-[300px] w-full">
              <AreaChart data={data.winRateTrend}>
                <defs>
                  <linearGradient id="winRateGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="week" tickLine={false} axisLine={false} />
                <YAxis domain={[50, 90]} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value: number) => [`${value}%`, 'Win Rate']}
                />
                <Area
                  type="monotone"
                  dataKey="winRate"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#winRateGradient)"
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Performance by Market Pie Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Performance by Market</CardTitle>
          <CardDescription>Win rate distribution across different markets</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-center gap-8">
            {data.marketPerformance.length > 0 ? (
              <>
                <ChartContainer config={pieChartConfig} className="h-[260px] w-full max-w-[300px] mx-auto md:mx-0">
                  <PieChart>
                    <Pie
                      data={data.marketPerformance}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={110}
                      paddingAngle={4}
                      dataKey="value"
                      label={({ name, value }) => `${name} ${value}%`}
                    >
                      {data.marketPerformance.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      formatter={(value: number) => [`${value}%`, 'Win Rate']}
                    />
                  </PieChart>
                </ChartContainer>
                <div className="flex-1 grid gap-3 sm:grid-cols-2 w-full">
                  {data.marketPerformance.map((market) => (
                    <div key={market.name} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                      <div
                        className="size-3 rounded-full shrink-0"
                        style={{ backgroundColor: market.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{market.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Progress value={market.value} className="h-1.5 flex-1" />
                          <span className="text-xs font-medium text-muted-foreground">{market.value}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground w-full">
                No market performance data available
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Breakdown Tables */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold">Detailed Breakdowns</h2>

        {/* Per-Strategy Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Strategy Breakdown</CardTitle>
            <CardDescription>Performance by trading strategy type</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strategy</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">Total Signals</TableHead>
                    <TableHead className="text-right">Avg R:R</TableHead>
                    <TableHead className="text-right">Net P&L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.strategyBreakdown.map((row) => (
                    <TableRow key={row.strategy}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {row.strategy === 'Scalp' ? (
                            <Flame className="size-4 text-orange-500" />
                          ) : (
                            <TrendingDown className="size-4 text-blue-500" />
                          )}
                          {row.strategy}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={row.winRate >= 70 ? 'default' : 'secondary'} className="font-mono">
                          {row.winRate}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.totalSignals}</TableCell>
                      <TableCell className="text-right font-mono">{row.avgRR}</TableCell>
                      <TableCell className="text-right font-mono text-emerald-500">{row.profit}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Per-Market Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Market Breakdown</CardTitle>
            <CardDescription>Performance across different markets</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Market</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">Total Signals</TableHead>
                    <TableHead className="text-right">Avg R:R</TableHead>
                    <TableHead className="text-right">Net P&L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.marketBreakdown.map((row) => (
                    <TableRow key={row.market}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div
                            className="size-2.5 rounded-full"
                            style={{ backgroundColor: data.marketPerformance.find(m => m.name === row.market)?.color }}
                          />
                          {row.market}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={row.winRate >= 70 ? 'default' : 'secondary'} className="font-mono">
                          {row.winRate}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.totalSignals}</TableCell>
                      <TableCell className="text-right font-mono">{row.avgRR}</TableCell>
                      <TableCell className="text-right font-mono text-emerald-500">{row.profit}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Per-Asset Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Asset Breakdown</CardTitle>
            <CardDescription>Top 10 most traded assets</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">Total Signals</TableHead>
                    <TableHead className="text-right">Avg R:R</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.assetBreakdown.map((row, idx) => (
                    <TableRow key={row.asset}>
                      <TableCell className="text-muted-foreground font-mono">{idx + 1}</TableCell>
                      <TableCell className="font-medium font-mono">{row.asset}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={row.winRate >= 75 ? 'default' : row.winRate >= 70 ? 'secondary' : 'outline'} className="font-mono">
                          {row.winRate}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.totalSignals}</TableCell>
                      <TableCell className="text-right font-mono">{row.avgRR}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Per-Timeframe Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Timeframe Breakdown</CardTitle>
            <CardDescription>Performance by chart timeframe</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timeframe</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">Total Signals</TableHead>
                    <TableHead className="text-right">Avg R:R</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.timeframeBreakdown.map((row) => (
                    <TableRow key={row.timeframe}>
                      <TableCell className="font-medium font-mono">{row.timeframe}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={row.winRate >= 75 ? 'default' : 'secondary'} className="font-mono">
                          {row.winRate}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.totalSignals}</TableCell>
                      <TableCell className="text-right font-mono">{row.avgRR}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Per-Session Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Session Breakdown</CardTitle>
            <CardDescription>Performance by trading session</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Session</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">Total Signals</TableHead>
                    <TableHead className="text-right">Avg R:R</TableHead>
                    <TableHead className="text-right">Peak Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sessionBreakdown.map((row) => (
                    <TableRow key={row.session}>
                      <TableCell className="font-medium">{row.session}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={row.winRate >= 73 ? 'default' : 'secondary'} className="font-mono">
                          {row.winRate}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.totalSignals}</TableCell>
                      <TableCell className="text-right font-mono">{row.avgRR}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{row.peakHours}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Export Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Export Data</CardTitle>
          <CardDescription>Download your performance data for external analysis</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-center gap-2">
              <Select value={exportRange} onValueChange={setExportRange}>
                <SelectTrigger className="w-[180px]">
                  <Calendar className="size-4 mr-2" />
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1m">Last 1 Month</SelectItem>
                  <SelectItem value="3m">Last 3 Months</SelectItem>
                  <SelectItem value="6m">Last 6 Months</SelectItem>
                  <SelectItem value="1y">Last 1 Year</SelectItem>
                  <SelectItem value="all">All Time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => exportToCSV(data, exportRange)}
              >
                <Download className="size-4" />
                Export as CSV
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => exportToExcel(data, exportRange)}>
                <FileSpreadsheet className="size-4" />
                Export as Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
