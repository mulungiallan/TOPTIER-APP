'use client'

import React, { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ScanLine, Sparkles, Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Pattern {
  symbol: string
  timeframe: string
  pattern: string
  confidence: number
  direction: 'bullish' | 'bearish' | 'neutral'
  description: string
}

const SYMBOLS = ['BTC/USD', 'ETH/USD', 'EUR/USD', 'GBP/USD', 'GOLD', 'AAPL', 'TSLA', 'NVDA', 'SPX500']
const TIMEFRAMES = ['1h', '4h', '1d']

const DIR_STYLES = {
  bullish: { color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/30', icon: TrendingUp },
  bearish: { color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/30', icon: TrendingDown },
  neutral: { color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/30', icon: Minus },
}

export function PatternRecognitionPage() {
  const [symbol, setSymbol] = useState('BTC/USD')
  const [timeframe, setTimeframe] = useState('1d')
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<any[]>([])

  const fetchHistory = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await api.get<{ success: boolean; data: { detections: any[] } }>('/ai/patterns?history=1', { signal })
      setHistory(res?.data?.detections || [])
    } catch { if (!signal?.aborted) setHistory([]) }
  }, [])

  React.useEffect(() => {
    const ctrl = new AbortController()
    fetchHistory(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchHistory])

  const handleDetect = async () => {
    setLoading(true)
    try {
      const res = await api.get<{ success: boolean; data: { patterns: Pattern[] } }>(`/ai/patterns?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`)
      if (res?.data?.patterns) {
        setPatterns(res.data.patterns)
        toast.success(`Detected ${res.data.patterns.length} patterns on ${symbol}`)
        fetchHistory()
      }
    } catch {
      toast.error('Failed to detect patterns')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5 p-3 md:p-4 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <ScanLine className="h-7 w-7 text-cyan-500" />
          Pattern Recognition
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Rule-based detection of chart patterns (candlestick, SMA cross, RSI extremes) computed from real market data. Not an AI model and not financial advice.</p>
      </motion.div>

      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Symbol</label>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm">
              {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Timeframe</label>
            <div className="flex gap-1 mt-1">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={cn('px-3 py-2 rounded-md border text-xs', timeframe === tf ? 'bg-cyan-500 text-white border-cyan-500' : 'hover:bg-accent')}
                >{tf}</button>
              ))}
            </div>
          </div>
          <Button onClick={handleDetect} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
            Scan Patterns
          </Button>
        </CardContent>
      </Card>

      {loading && (
        <Card><CardContent className="py-16 text-center">
          <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin text-cyan-500" />
          <p className="text-sm">Scanning {symbol} {timeframe} chart for patterns...</p>
        </CardContent></Card>
      )}

      {!loading && patterns.length === 0 && (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <ScanLine className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Run a scan to detect chart patterns on {symbol}.</p>
        </CardContent></Card>
      )}

      {patterns.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {patterns.map((p, idx) => {
            const style = DIR_STYLES[p.direction]
            const Icon = style.icon
            return (
              <motion.div key={`${p.pattern}-${idx}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                <Card className={cn('border', style.bg)}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <Icon className={cn('h-4 w-4', style.color)} />
                          <span className="font-semibold text-sm capitalize">{p.pattern.replace(/_/g, ' ')}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{p.symbol} · {p.timeframe}</div>
                      </div>
                      <Badge variant="outline" className={cn('text-[10px] capitalize', style.color)}>{p.direction}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">{p.description}</p>
                    <div>
                      <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-muted-foreground">Confidence</span>
                        <span className={style.color}>{p.confidence}%</span>
                      </div>
                      <Progress value={p.confidence} className="h-1.5" />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Detection History</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No past detections yet.</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {history.map((d) => {
                const style = DIR_STYLES[d.direction as keyof typeof DIR_STYLES] || DIR_STYLES.neutral
                return (
                  <div key={d.id} className="flex items-center justify-between p-2 rounded border bg-card/50 text-xs">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px]">{d.timeframe}</Badge>
                      <span className="font-medium">{d.symbol}</span>
                      <span className="capitalize">{d.pattern.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={cn('text-[9px] capitalize', style.color)}>{d.direction}</Badge>
                      <span className="text-muted-foreground">{d.confidence}%</span>
                      <span className="text-muted-foreground">{new Date(d.detectedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default PatternRecognitionPage
