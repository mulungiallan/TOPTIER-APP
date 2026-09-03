'use client'

import React, { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Brain, Sparkles, TrendingUp, TrendingDown, Loader2, Zap, Activity, BarChart3 } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Prediction {
  symbol: string
  timeframe: string
  currentPrice: number
  predictedPrice: number
  direction: 'up' | 'down'
  confidence: number
  probability: number
  modelUsed: string
  features: Record<string, number>
  disclaimer?: string
  dataSource?: string
}

const SYMBOLS = ['BTC/USD', 'ETH/USD', 'EUR/USD', 'GBP/USD', 'GOLD', 'AAPL', 'TSLA', 'NVDA', 'SPX500']

export function AIPredictionsPage() {
  const [symbol, setSymbol] = useState('BTC/USD')
  const [timeframe, setTimeframe] = useState<'1h' | '4h' | '1d'>('1d')
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<any[]>([])

  const fetchHistory = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await api.get<{ success: boolean; data: { predictions: any[] } }>('/ai/predict?history=1', { signal })
      setHistory(res?.data?.predictions || [])
    } catch { if (!signal?.aborted) setHistory([]) }
  }, [])

  React.useEffect(() => {
    const ctrl = new AbortController()
    fetchHistory(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchHistory])

  const handlePredict = async () => {
    setLoading(true)
    try {
      const res = await api.get<{ success: boolean; data: { prediction: Prediction } }>(`/ai/predict?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`)
      if (res?.data?.prediction) {
        setPrediction(res.data.prediction)
        toast.success(`Forecast generated: ${res.data.prediction.direction.toUpperCase()} (${res.data.prediction.confidence}% indicator strength)`)
        fetchHistory()
      }
    } catch {
      toast.error('Failed to generate prediction')
    } finally {
      setLoading(false)
    }
  }

  const changePct = prediction ? ((prediction.predictedPrice - prediction.currentPrice) / prediction.currentPrice) * 100 : 0

  return (
    <div className="space-y-5 p-3 md:p-4 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Brain className="h-7 w-7 text-violet-500" />
          Price Direction Forecast
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Technical indicator ensemble (SMA, RSI, momentum, EMA cross) computed from real market data. This is not an AI prediction and is not financial advice.</p>
      </motion.div>

      {/* Configurator */}
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Symbol</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm"
            >
              {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Timeframe</label>
            <div className="flex gap-1 mt-1">
              {(['1h', '4h', '1d'] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={cn(
                    'px-3 py-2 rounded-md border text-xs',
                    timeframe === tf ? 'bg-violet-500 text-white border-violet-500' : 'hover:bg-accent'
                  )}
                >{tf}</button>
              ))}
            </div>
          </div>
          <Button onClick={handlePredict} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
            Generate Prediction
          </Button>
        </CardContent>
      </Card>

      {/* Result */}
      {loading && (
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin text-violet-500" />
            <p className="text-sm">Computing technical indicators for {symbol}...</p>
          </CardContent>
        </Card>
      )}

      {!prediction && !loading && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Brain className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Select a symbol and generate a technical forecast.</p>
          </CardContent>
        </Card>
      )}

      {prediction && !loading && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="overflow-hidden border-violet-500/30">
            <div className="bg-gradient-to-br from-violet-500/10 to-transparent p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl font-bold">{prediction.symbol}</span>
                    <Badge variant="outline" className="text-xs">{prediction.timeframe}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">Current price: <span className="font-mono">${prediction.currentPrice.toLocaleString()}</span></p>
                </div>
                <Badge className={cn(prediction.direction === 'up' ? 'bg-emerald-500' : 'bg-rose-500')}>
                  {prediction.direction === 'up' ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                  {prediction.direction.toUpperCase()}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-xs text-muted-foreground">Projected Price</div>
                  <div className={cn('text-2xl font-bold tabular-nums', prediction.direction === 'up' ? 'text-emerald-500' : 'text-rose-500')}>
                    ${prediction.predictedPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </div>
                  <div className={cn('text-xs', prediction.direction === 'up' ? 'text-emerald-500' : 'text-rose-500')}>
                    {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}% indicated move
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Indicator Strength</div>
                  <div className="text-2xl font-bold tabular-nums">{prediction.confidence}%</div>
                  <Progress value={prediction.confidence} className="h-1.5 mt-1" />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <Feature label="SMA 20" value={prediction.features.sma20} />
                <Feature label="SMA 50" value={prediction.features.sma50} />
                <Feature label="RSI (14)" value={prediction.features.rsi} />
                <Feature label="ROC (10)" value={`${prediction.features.roc}%`} />
                <Feature label="Volatility" value={`${prediction.features.volatility}%`} />
                <Feature label="Method" value={prediction.modelUsed} />
              </div>

              {prediction.disclaimer && (
                <p className="text-[11px] text-muted-foreground mt-3 border-t pt-2">
                  {prediction.disclaimer}
                </p>
              )}
            </div>
          </Card>
        </motion.div>
      )}

      {/* History */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Recent Predictions</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No predictions yet.</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {history.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-2 rounded border bg-card/50 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px]">{p.timeframe}</Badge>
                    <span className="font-medium">{p.symbol}</span>
                    <span className="text-muted-foreground">${p.currentPrice} → ${p.predictedPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={cn('text-[9px]', p.direction === 'up' ? 'bg-emerald-500' : 'bg-rose-500')}>
                      {p.direction.toUpperCase()}
                    </Badge>
                    <span className="text-muted-foreground">{p.confidence}%</span>
                    <span className="text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</span>
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

function Feature({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="p-2 rounded-md border bg-card/50">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono text-xs">{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  )
}

export default AIPredictionsPage
