'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, Save, Play, Loader2, Cpu, BarChart3 } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Rule {
  id: string
  indicator: string
  operator: string
  value: number
  action: 'BUY' | 'SELL'
}

interface Strategy {
  id: string
  name: string
  description: string | null
  market: string
  timeframe: string
  isPublic: boolean
  performance: number | null
  rules: string // JSON string
  createdAt: string
}

const INDICATORS = ['sma_cross', 'rsi', 'macd', 'bollinger', 'ema_cross', 'stochastic', 'atr', 'volume']
const OPERATORS = ['crosses_above', 'crosses_below', 'greater_than', 'less_than', 'equals']

interface EvalResult {
  strategyId: string
  name: string
  symbol: string
  initialCapital: number
  finalCapital: number
  totalReturn: number
  winRate: number
  totalTrades: number
  winningTrades: number
  losingTrades: number
  sharpeRatio: number
  maxDrawdown: number
  dataSource: string
  trades: Array<{
    entryDate: string
    exitDate: string | null
    direction: 'BUY' | 'SELL'
    entryPrice: number
    exitPrice: number | null
    profit: number
    profitPercent: number
    holdingDays: number
  }>
}

const DEFAULT_SYMBOL: Record<string, string> = {
  forex: 'EURUSD',
  crypto: 'BTCUSD',
  stocks: 'AAPL',
  indices: 'SPX500',
  commodities: 'XAUUSD',
}

export function StrategyBuilderPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loading, setLoading] = useState(true)
  const [building, setBuilding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null)
  const [evalResults, setEvalResults] = useState<Record<string, EvalResult>>({})
  const [form, setForm] = useState({
    name: '',
    description: '',
    market: 'forex',
    timeframe: '1d',
    isPublic: false,
  })
  const [rules, setRules] = useState<Rule[]>([
    { id: '1', indicator: 'sma_cross', operator: 'crosses_above', value: 0, action: 'BUY' },
  ])

  const fetchStrategies = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      const res = await api.get<{ success: boolean; data: { strategies: Strategy[] } }>('/strategies?scope=mine', { signal })
      if (!signal?.aborted) setStrategies(res?.data?.strategies || [])
    } catch { if (!signal?.aborted) setStrategies([]) }
    finally { if (!signal?.aborted) setLoading(false) }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    fetchStrategies(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchStrategies])

  const addRule = () => {
    setRules((prev) => [...prev, {
      id: Date.now().toString(),
      indicator: 'rsi', operator: 'less_than', value: 30, action: 'BUY',
    }])
  }

  const updateRule = (id: string, patch: Partial<Rule>) => {
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r))
  }

  const removeRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id))
  }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (rules.length === 0) { toast.error('Add at least one rule'); return }
    setSaving(true)
    try {
      await api.post('/strategies', { ...form, rules })
      toast.success('Strategy saved!')
      setForm({ name: '', description: '', market: 'forex', timeframe: '1d', isPublic: false })
      setRules([{ id: '1', indicator: 'sma_cross', operator: 'crosses_above', value: 0, action: 'BUY' }])
      fetchStrategies()
    } catch {
      toast.error('Failed to save strategy')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/strategies?id=${id}`) as any
      toast.success('Strategy deleted')
      fetchStrategies()
    } catch {
      toast.error('Failed to delete')
    }
  }

  const handleEvaluate = async (s: Strategy) => {
    setEvaluatingId(s.id)
    try {
      const end = new Date()
      const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      const res = await api.post<{ success: boolean; data?: EvalResult }>('/strategies/evaluate', {
        strategyId: s.id,
        symbol: DEFAULT_SYMBOL[s.market] || 'EURUSD',
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        initialCapital: 10000,
      })
      const result = res?.data
      if (result) {
        setEvalResults((prev) => ({ ...prev, [s.id]: result }))
        toast.success(`Backtest complete: ${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn}%`)
      } else {
        toast.error('No result returned')
      }
    } catch {
      toast.error('Backtest failed — not enough real data?')
    } finally {
      setEvaluatingId(null)
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Cpu className="h-7 w-7 text-emerald-500" />
          Strategy Builder
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Build, save, and backtest rule-based trading strategies — no coding required.</p>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Builder */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Build New Strategy</CardTitle>
            <CardDescription>Configure your entry/exit rules visually</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="My Scalping Strategy" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="What's the idea?" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Market</Label>
                <select value={form.market} onChange={(e) => setForm((p) => ({ ...p, market: e.target.value }))} className="w-full px-3 py-2 rounded-md border bg-background text-sm">
                  {['forex', 'crypto', 'stocks', 'indices', 'commodities'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <Label>Timeframe</Label>
                <select value={form.timeframe} onChange={(e) => setForm((p) => ({ ...p, timeframe: e.target.value }))} className="w-full px-3 py-2 rounded-md border bg-background text-sm">
                  {['5m', '15m', '1h', '4h', '1d'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Rules ({rules.length})</Label>
                <Button size="sm" variant="outline" onClick={addRule}>
                  <Plus className="h-3 w-3 mr-1" />Add Rule
                </Button>
              </div>
              <div className="space-y-2">
                {rules.map((r) => (
                  <div key={r.id} className="flex items-center gap-1 p-2 rounded border bg-card/50">
                    <select value={r.indicator} onChange={(e) => updateRule(r.id, { indicator: e.target.value })}
                      className="text-xs px-1 py-1 rounded border bg-background flex-1">
                      {INDICATORS.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                    <select value={r.operator} onChange={(e) => updateRule(r.id, { operator: e.target.value })}
                      className="text-xs px-1 py-1 rounded border bg-background flex-1">
                      {OPERATORS.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                    </select>
                    <input type="number" value={r.value} onChange={(e) => updateRule(r.id, { value: parseFloat(e.target.value) || 0 })}
                      className="text-xs px-1 py-1 rounded border bg-background w-16" />
                    <button onClick={() => updateRule(r.id, { action: r.action === 'BUY' ? 'SELL' : 'BUY' })}
                      className={cn('text-xs px-2 py-1 rounded font-medium',
                        r.action === 'BUY' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white')}>
                      {r.action}
                    </button>
                    <button onClick={() => removeRule(r.id)} className="text-rose-500 hover:bg-rose-500/10 p-1 rounded">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm((p) => ({ ...p, isPublic: e.target.checked }))} />
              Share publicly in strategy marketplace
            </label>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                Save Strategy
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Saved strategies */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My Strategies ({strategies.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded" />)}</div>
            ) : strategies.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <Cpu className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No strategies yet. Build your first one!</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {strategies.map((s) => {
                  const parsedRules: Rule[] = (() => { try { return JSON.parse(s.rules) } catch { return [] } })()
                  return (
                    <div key={s.id} className="p-3 rounded-lg border bg-card/50">
                      <div className="flex items-start justify-between mb-1">
                        <div>
                          <div className="font-medium text-sm">{s.name}</div>
                          <div className="text-xs text-muted-foreground">{s.market} · {s.timeframe} · {parsedRules.length} rules</div>
                        </div>
                        <div className="flex items-center gap-1">
                          {s.isPublic && <Badge variant="outline" className="text-[9px]">Public</Badge>}
                          {s.performance != null && (
                            <Badge variant="outline" className={cn('text-[9px]', s.performance >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                              {s.performance >= 0 ? '+' : ''}{s.performance}%
                            </Badge>
                          )}
                          <button
                            onClick={() => handleEvaluate(s)}
                            disabled={evaluatingId === s.id}
                            title="Backtest on real data"
                            className="text-blue-500 hover:bg-blue-500/10 p-1 rounded disabled:opacity-50"
                          >
                            {evaluatingId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          </button>
                          <button onClick={() => handleDelete(s.id)} className="text-rose-500 hover:bg-rose-500/10 p-1 rounded">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      {s.description && <p className="text-xs text-muted-foreground line-clamp-1">{s.description}</p>}
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Created {new Date(s.createdAt).toLocaleDateString()}
                      </div>

                      {evalResults[s.id] && (
                        <div className="mt-3 rounded-lg border bg-background p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                              <BarChart3 className="h-3 w-3" /> Backtest · {evalResults[s.id].symbol} · real data
                            </span>
                            <button onClick={() => setEvalResults((prev) => { const next = { ...prev }; delete next[s.id]; return next })} className="text-[10px] text-muted-foreground hover:text-foreground">
                              Hide
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 text-xs">
                            <div className="rounded bg-card p-2">
                              <div className="text-muted-foreground text-[10px]">Return</div>
                              <div className={cn('font-semibold', evalResults[s.id].totalReturn >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                                {evalResults[s.id].totalReturn >= 0 ? '+' : ''}{evalResults[s.id].totalReturn}%
                              </div>
                            </div>
                            <div className="rounded bg-card p-2">
                              <div className="text-muted-foreground text-[10px]">Win rate</div>
                              <div className="font-semibold">{evalResults[s.id].winRate}%</div>
                            </div>
                            <div className="rounded bg-card p-2">
                              <div className="text-muted-foreground text-[10px]">Trades</div>
                              <div className="font-semibold">{evalResults[s.id].totalTrades}</div>
                            </div>
                            <div className="rounded bg-card p-2">
                              <div className="text-muted-foreground text-[10px]">Max DD</div>
                              <div className="font-semibold">-{evalResults[s.id].maxDrawdown}%</div>
                            </div>
                          </div>
                          {evalResults[s.id].trades.length > 0 && (
                            <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
                              {evalResults[s.id].trades.map((t, i) => (
                                <div key={i} className="flex items-center justify-between text-[10px] text-muted-foreground">
                                  <span className="font-medium">{t.direction}</span>
                                  <span>{new Date(t.entryDate).toLocaleDateString()}</span>
                                  <span className={cn('font-medium', t.profit >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                                    {t.profit >= 0 ? '+' : ''}{t.profitPercent}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="text-[10px] text-muted-foreground mt-2">
                            {evalResults[s.id].finalCapital.toLocaleString()} final · Sharpe {evalResults[s.id].sharpeRatio} · {evalResults[s.id].dataSource} source
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default StrategyBuilderPage
