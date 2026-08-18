'use client'

import React, { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { FlaskConical, Play, Loader2, TrendingUp, TrendingDown } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const STRATEGIES = [
  { id: 'sma_cross', name: 'SMA Crossover', desc: 'Buy when SMA20 crosses above SMA50; sell on opposite cross.' },
  { id: 'rsi_oversold', name: 'RSI Oversold/Overbought', desc: 'Buy when RSI < 30, sell when RSI > 70.' },
  { id: 'momentum', name: 'Momentum Trend', desc: 'Follow price above/below SMA20 with SMA50 trend filter.' },
  { id: 'mean_reversion', name: 'Mean Reversion', desc: 'Buy oversold RSI dips, sell overbought RSI peaks.' },
  { id: 'breakout', name: 'Breakout', desc: 'Buy 20-day highs, sell 20-day lows.' },
]

interface BacktestResult {
  id: string
  symbol: string
  strategy: string
  startDate: string
  endDate: string
  initialCapital: number
  finalCapital: number
  totalReturn: number
  winRate: number
  totalTrades: number
  winningTrades: number
  losingTrades: number
  sharpeRatio: number
  maxDrawdown: number
  trades: Array<{
    entryDate: string; exitDate: string | null
    direction: string; entryPrice: number; exitPrice: number | null
    quantity: number; profit: number | null; profitPercent: number | null
    holdingDays: number | null
  }>
}

export function BacktestingPage() {
  const [form, setForm] = useState({
    symbol: 'BTC/USD',
    strategy: 'sma_cross',
    startDate: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    initialCapital: 10000,
  })
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [history, setHistory] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const fetchHistory = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await api.get<{ success: boolean; data: { backtests: any[] } }>('/trading/backtest', { signal })
      setHistory(res?.data?.backtests || [])
    } catch {
      if (!signal?.aborted) setHistory([])
    } finally {
      if (!signal?.aborted) setLoadingHistory(false)
    }
  }, [])

  React.useEffect(() => {
    const ctrl = new AbortController()
    fetchHistory(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchHistory])

  const handleRun = async () => {
    setRunning(true)
    try {
      const res = await api.post<{ success: boolean; data: { backtest: BacktestResult } }>('/trading/backtest', form)
      if (res?.data?.backtest) {
        setResult(res.data.backtest)
        toast.success(`Backtest complete: ${res.data.backtest.totalReturn >= 0 ? '+' : ''}${res.data.backtest.totalReturn}% return`)
        fetchHistory()
      }
    } catch {
      toast.error('Backtest failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <FlaskConical className="h-7 w-7 text-violet-500" />
          Backtesting Engine
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Test trading strategies against historical data before risking capital.</p>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Config */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Configuration</CardTitle>
            <CardDescription>Choose your strategy and time range</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Symbol</Label>
              <Input value={form.symbol} onChange={(e) => setForm((p) => ({ ...p, symbol: e.target.value }))} placeholder="BTC/USD, EUR/USD, AAPL..." />
            </div>
            <div>
              <Label>Strategy</Label>
              <div className="space-y-1 mt-1 max-h-48 overflow-y-auto">
                {STRATEGIES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setForm((p) => ({ ...p, strategy: s.id }))}
                    className={cn(
                      'w-full text-left p-2 rounded-md border text-xs transition',
                      form.strategy === s.id ? 'border-violet-500 bg-violet-500/5' : 'hover:bg-accent'
                    )}
                  >
                    <div className="font-medium">{s.name}</div>
                    <div className="text-muted-foreground">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div>
                <Label>End Date</Label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Initial Capital ($)</Label>
              <Input type="number" value={form.initialCapital} onChange={(e) => setForm((p) => ({ ...p, initialCapital: parseFloat(e.target.value) || 10000 }))} />
            </div>
            <Button onClick={handleRun} disabled={running} className="w-full">
              {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Play className="h-4 w-4 mr-1.5" />}
              Run Backtest
            </Button>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          {!result && !running && (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <FlaskConical className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Configure a backtest on the left and click "Run Backtest" to see results.</p>
              </CardContent>
            </Card>
          )}

          {running && (
            <Card>
              <CardContent className="py-16 text-center">
                <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin text-violet-500" />
                <p className="text-sm">Running backtest on {form.symbol}...</p>
              </CardContent>
            </Card>
          )}

          {result && !running && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric label="Total Return" value={`${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn}%`} positive={result.totalReturn >= 0} />
                <Metric label="Final Capital" value={`$${result.finalCapital.toLocaleString()}`} positive={result.finalCapital >= result.initialCapital} />
                <Metric label="Win Rate" value={`${result.winRate}%`} positive={result.winRate >= 50} />
                <Metric label="Sharpe Ratio" value={result.sharpeRatio.toFixed(2)} positive={result.sharpeRatio >= 1} />
                <Metric label="Total Trades" value={result.totalTrades.toString()} />
                <Metric label="Wins" value={result.winningTrades.toString()} positive />
                <Metric label="Losses" value={result.losingTrades.toString()} positive={false} />
                <Metric label="Max Drawdown" value={`${result.maxDrawdown}%`} positive={result.maxDrawdown < 20} />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Trade History ({result.trades.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-80 overflow-y-auto space-y-1">
                    {result.trades.slice().reverse().map((t, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded border bg-card/50 text-xs">
                        <div className="flex items-center gap-2">
                          <Badge variant={t.direction === 'BUY' ? 'default' : 'destructive'} className="text-[9px]">{t.direction}</Badge>
                          <span>{new Date(t.entryDate).toLocaleDateString()}</span>
                          <span className="text-muted-foreground">→ {t.exitDate ? new Date(t.exitDate).toLocaleDateString() : 'Open'}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono">@ ${t.entryPrice.toFixed(2)}</span>
                          {t.exitPrice && <span className="font-mono">→ ${t.exitPrice.toFixed(2)}</span>}
                          <span className={cn('font-semibold tabular-nums', (t.profit || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                            {(t.profit || 0) >= 0 ? '+' : ''}${(t.profit || 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* History */}
      <Card>
        <CardHeader><CardTitle className="text-base">Past Backtests</CardTitle></CardHeader>
        <CardContent>
          {loadingHistory ? (
            <Skeleton className="h-24 rounded" />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No past backtests yet.</p>
          ) : (
            <div className="space-y-1">
              {history.map((b) => (
                <div key={b.id} className="flex items-center justify-between p-2 rounded border bg-card/50 text-xs">
                  <div>
                    <span className="font-medium">{b.name}</span>
                    <span className="text-muted-foreground ml-2">{new Date(b.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{b.totalTrades} trades</span>
                    <span className={cn('font-semibold', b.totalReturn >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                      {b.totalReturn >= 0 ? '+' : ''}{b.totalReturn}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn(
          'text-lg font-bold tabular-nums mt-1',
          positive === true && 'text-emerald-500',
          positive === false && 'text-rose-500'
        )}>{value}</div>
      </CardContent>
    </Card>
  )
}

export default BacktestingPage
