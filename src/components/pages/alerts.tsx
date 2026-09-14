'use client'

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell,
  Plus,
  Target,
  ShieldAlert,
  Activity,
  TrendingUp,
  Ban,
  Clock,
  Zap,
  Crown,
  Loader2,
  AlertCircle,
  Volume2,
  Vibrate,
  Radio,
  RefreshCcw,
  ArrowUpRight,
  ArrowDownRight,
  BellRing,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Category = 'price' | 'take_profit' | 'stop_loss' | 'indicator' | 'signal'

interface AlertRow {
  id: number
  market: string
  symbol: string
  conditionType: string
  field: string
  comparator: string
  threshold: number
  category: Category
  sound: string
  vibration: string
  status: string
  createdAt: Date
  triggeredAt: Date | null
  triggeredValue: number | null
  note: string
}

interface EngineNotification {
  id: number
  title: string
  body: string
  sound: string
  vibration: string
  priority: string
  payload: Record<string, unknown> | null
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const SOUND_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'bell', label: 'Classic Bell' },
  { value: 'ding', label: 'Ding' },
  { value: 'chime', label: 'Chime' },
  { value: 'whistle', label: 'Whistle' },
  { value: 'alarm', label: 'Alarm' },
  { value: 'siren', label: 'Siren' },
  { value: 'notification', label: 'Notification' },
  { value: 'urgent', label: 'Urgent Alert' },
  { value: 'gentle', label: 'Gentle Tone' },
]

const VIBRATION_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'soft', label: 'Soft' },
  { value: 'strong', label: 'Strong' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'off', label: 'Off' },
]

const MARKET_OPTIONS = [
  { value: 'stock', label: 'Stocks' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'forex', label: 'Forex' },
]

const SYMBOL_SUGGESTIONS: Record<string, string[]> = {
  stock: ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'GOOG', 'AMZN', 'META', 'NFLX'],
  crypto: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'BNB/USD', 'DOGE/USD'],
  forex: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF', 'USD/CAD', 'XAU/USD'],
}

const INDICATOR_FIELDS = [
  'rsi_14', 'macd', 'macd_signal', 'macd_hist', 'sma_20', 'sma_50',
  'sma_200', 'ema_12', 'ema_26', 'bb_upper', 'bb_lower', 'bb_mid', 'atr_14', 'close',
]

const INDICATOR_FIELD_LABELS: Record<string, string> = {
  rsi_14: 'RSI (14)',
  macd: 'MACD',
  macd_signal: 'MACD Signal',
  macd_hist: 'MACD Histogram',
  sma_20: 'SMA (20)',
  sma_50: 'SMA (50)',
  sma_200: 'SMA (200)',
  ema_12: 'EMA (12)',
  ema_26: 'EMA (26)',
  bb_upper: 'Bollinger Upper',
  bb_mid: 'Bollinger Mid',
  bb_lower: 'Bollinger Lower',
  atr_14: 'ATR (14)',
  close: 'Close price',
}

const SIGNAL_STRATEGIES = [
  'trend_following', 'mean_reversion', 'momentum', 'swing_trading',
  'scalping', 'stat_arbitrage', 'market_making_bias', 'breakout',
  'composite', 'consensus',
]

const STRATEGY_LABELS: Record<string, string> = {
  trend_following: 'Trend Following',
  mean_reversion: 'Mean Reversion',
  momentum: 'Momentum',
  swing_trading: 'Swing Trading',
  scalping: 'Scalping',
  stat_arbitrage: 'Stat Arbitrage',
  market_making_bias: 'Market Making Bias',
  breakout: 'Breakout',
  composite: 'Composite',
  consensus: 'Consensus',
}

const CATEGORY_META: Record<Category, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  price: { label: 'Price', icon: Bell, className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
  take_profit: { label: 'Take Profit', icon: Target, className: 'bg-teal-500/10 text-teal-600 border-teal-500/20' },
  stop_loss: { label: 'Stop Loss', icon: ShieldAlert, className: 'bg-red-500/10 text-red-600 border-red-500/20' },
  indicator: { label: 'Indicator', icon: Activity, className: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
  signal: { label: 'Signal', icon: TrendingUp, className: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20' },
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sqliteToDate(value: string | null): Date | null {
  if (!value) return null
  const iso = value.replace(' ', 'T')
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
}

function mapEngineRow(row: any): AlertRow {
  return {
    id: row.id,
    market: row.market,
    symbol: row.symbol,
    conditionType: row.condition_type,
    field: row.field,
    comparator: row.comparator,
    threshold: row.threshold,
    category: row.category as Category,
    sound: row.sound,
    vibration: row.vibration,
    status: row.status,
    createdAt: sqliteToDate(row.created_at) || new Date(),
    triggeredAt: sqliteToDate(row.triggered_at),
    triggeredValue: row.triggered_value,
    note: row.note || '',
  }
}

function formatPrice(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

function signalTargetText(row: AlertRow): string {
  const target = Math.round(row.threshold + 0.5)
  const name = STRATEGY_LABELS[row.field] || row.field
  const direction = target === 1 ? 'Bullish' : target === -1 ? 'Bearish' : 'Flat'
  return `${name} -> ${direction}`
}

function conditionText(row: AlertRow): string {
  switch (row.category) {
    case 'price':
      return row.conditionType === 'price_above'
        ? `Price above ${formatPrice(row.threshold)}`
        : `Price below ${formatPrice(row.threshold)}`
    case 'take_profit':
      return `Take profit at ${formatPrice(row.threshold)}`
    case 'stop_loss':
      return `Stop loss at ${formatPrice(row.threshold)}`
    case 'indicator':
      return `${INDICATOR_FIELD_LABELS[row.field] || row.field} ${row.comparator} ${formatPrice(row.threshold)}`
    case 'signal':
      return signalTargetText(row)
  }
}

// ─── Sound + Vibration engine (synthesized ringtones, no asset files needed) ──

const RINGTONE_URLS: Record<string, string> = {}

function generateWavBlob(sampleRate: number, channels: number, samples: Float32Array): Blob {
  const numSamples = samples.length
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const dataSize = numSamples * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function synthToDataUri(fn: (t: number) => number, duration: number, sampleRate = 44100): string {
  const numSamples = Math.floor(sampleRate * duration)
  const samples = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    samples[i] = fn(i / sampleRate)
  }
  const blob = generateWavBlob(sampleRate, 1, samples)
  return URL.createObjectURL(blob)
}

function buildRingtoneUrls() {
  const easeIn = (t: number, start: number, dur: number) =>
    t < start ? 0 : t > start + dur ? 1 : (t - start) / dur

  const easeOut = (t: number, start: number, dur: number) =>
    t < start ? 1 : t > start + dur ? 0 : 1 - (t - start) / dur

  RINGTONE_URLS['bell'] = synthToDataUri((t) => {
    const env = easeOut(t, 0, 0.8) * 0.3
    return (Math.sin(2 * Math.PI * 880 * t) * 0.5 + Math.sin(2 * Math.PI * 1318 * t) * 0.5) * env
  }, 0.9)

  RINGTONE_URLS['ding'] = synthToDataUri((t) => {
    const env = easeOut(t, 0, 0.6) * 0.35
    return Math.sin(2 * Math.PI * 1318 * t) * env
  }, 0.7)

  RINGTONE_URLS['chime'] = synthToDataUri((t) => {
    const env1 = easeOut(t, 0, 0.5) * 0.3
    const env2 = easeOut(t, 0.12, 0.7) * 0.3
    return Math.sin(2 * Math.PI * 1046 * t) * env1 + Math.sin(2 * Math.PI * 1568 * t) * env2
  }, 0.85)

  RINGTONE_URLS['whistle'] = synthToDataUri((t) => {
    let env = 0
    for (let i = 0; i < 3; i++) {
      env += easeOut(t, i * 0.25, 0.25) * 0.2
    }
    return Math.sin(2 * Math.PI * 2093 * t) * Math.min(env, 0.5)
  }, 0.9)

  RINGTONE_URLS['alarm'] = synthToDataUri((t) => {
    const on = Math.floor(t * 4) % 2 === 0
    if (!on) return 0
    const freq = 880 + Math.sin(t * 6) * 120
    return Math.sin(2 * Math.PI * freq * t) * 0.3 * easeOut(t, 0, 0.15)
  }, 1.6)

  RINGTONE_URLS['siren'] = synthToDataUri((t) => {
    const freq = 600 + Math.sin(t * 3.5) * 400
    const env = 0.3 * easeOut(t, 0, 0.05)
    return Math.sin(2 * Math.PI * freq * t) * env
  }, 2.0)

  RINGTONE_URLS['notification'] = synthToDataUri((t) => {
    const freq1 = easeIn(t, 0, 0.01) * 880
    const freq2 = easeIn(t, 0.1, 0.01) * 1174
    const env1 = easeOut(t, 0, 0.3) * 0.3
    const env2 = easeOut(t, 0.1, 0.3) * 0.3
    return Math.sin(2 * Math.PI * freq1 * t) * env1 + Math.sin(2 * Math.PI * freq2 * t) * env2
  }, 0.5)

  RINGTONE_URLS['urgent'] = synthToDataUri((t) => {
    const beat = t % 0.2
    const on = beat < 0.12
    if (!on) return 0
    const freq = 1000 + Math.sin(t * 20) * 200
    return Math.sin(2 * Math.PI * freq * t) * 0.35
  }, 1.0)

  RINGTONE_URLS['gentle'] = synthToDataUri((t) => {
    const freq = 523 + Math.sin(t * 1.5) * 50
    return Math.sin(2 * Math.PI * freq * t) * 0.2 * easeOut(t, 0, 1.5) * easeIn(t, 0, 0.05)
  }, 1.6)
}

let ringtoneUrlsBuilt = false
function ensureRingtoneUrls() {
  if (!ringtoneUrlsBuilt) {
    buildRingtoneUrls()
    ringtoneUrlsBuilt = true
  }
}

function playAlertSound(uri: string) {
  if (typeof window === 'undefined') return
  ensureRingtoneUrls()

  const selected = RINGTONE_URLS[uri] ? uri : 'bell'
  const url = RINGTONE_URLS[selected]
  if (!url) return

  try {
    const audio = new Audio(url)
    audio.volume = 1.0
    audio.play().catch(() => {})
  } catch {}
}

function vibrate(pattern: string) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  const patterns: Record<string, number | number[]> = {
    default: [200, 80, 200, 80, 200],
    soft: [100],
    strong: [300, 100, 300, 100, 300],
    urgent: [200, 50, 200, 50, 200, 50, 400],
  }
  const p = patterns[pattern]
  if (!p || pattern === 'off') return
  try {
    navigator.vibrate(p)
  } catch {}
}

function showSystemNotification(title: string, body: string) {
  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {})
      }
      if (Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/icons/toptier-icon-192.png',
          badge: '/icons/toptier-icon-192.png',
          tag: `alert-${Date.now()}`,
          requireInteraction: true,
        } as NotificationOptions)
      }
    }
  } catch {}
}

// ─── Shared form fragments ─────────────────────────────────────────────────────

function MarketSymbolFields({
  market,
  setMarket,
  symbol,
  setSymbol,
}: {
  market: string
  setMarket: (v: string) => void
  symbol: string
  setSymbol: (v: string) => void
}) {
  const suggestions = SYMBOL_SUGGESTIONS[market] || []
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        <Label>Market</Label>
        <Select value={market} onValueChange={setMarket}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MARKET_OPTIONS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Symbol</Label>
        <Input
          list={`symbol-suggestions-${market}`}
          placeholder={market === 'stock' ? 'AAPL' : market === 'crypto' ? 'BTC/USD' : 'EUR/USD'}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
        <datalist id={`symbol-suggestions-${market}`}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
    </div>
  )
}

function NotificationPrefs({
  sound,
  setSound,
  vibration,
  setVibration,
}: {
  sound: string
  setSound: (v: string) => void
  vibration: string
  setVibration: (v: string) => void
}) {
  return (
    <div className="rounded-lg border p-3 space-y-3">
      <p className="text-sm font-medium">Notification when it triggers</p>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Sound</Label>
        <Select value={sound} onValueChange={setSound}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOUND_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Vibration</Label>
        <Select value={vibration} onValueChange={setVibration}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIBRATION_OPTIONS.map((v) => (
              <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-24 text-sm text-muted-foreground gap-2">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  )
}

function EmptyState({ icon: Icon, title, subtitle }: { icon: React.ComponentType<{ className?: string }>; title: string; subtitle: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <Icon className="size-12 text-muted-foreground/30 mb-4" />
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  )
}

// ─── Create Trading Alert (Price / TP-SL) ─────────────────────────────────────

function CreateTradingAlertDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'price' | 'tp_sl'>('price')
  const [market, setMarket] = useState('stock')
  const [symbol, setSymbol] = useState('')
  const [condition, setCondition] = useState('above')
  const [threshold, setThreshold] = useState('')
  const [side, setSide] = useState('buy')
  const [entryPrice, setEntryPrice] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [sound, setSound] = useState('default')
  const [vibration, setVibration] = useState('default')
  const [creating, setCreating] = useState(false)

  const reset = () => {
    setMode('price')
    setMarket('stock')
    setSymbol('')
    setCondition('above')
    setThreshold('')
    setSide('buy')
    setEntryPrice('')
    setTakeProfit('')
    setStopLoss('')
    setSound('default')
    setVibration('default')
  }

  const canSubmit = () => {
    if (!market || !symbol) return false
    if (mode === 'price') return Number.isFinite(parseFloat(threshold))
    return (
      Number.isFinite(parseFloat(entryPrice)) &&
      (Number.isFinite(parseFloat(takeProfit)) || Number.isFinite(parseFloat(stopLoss)))
    )
  }

  const handleCreate = async () => {
    if (!canSubmit()) return
    try {
      setCreating(true)
      if (mode === 'price') {
        await api.post('/alerts', {
          category: 'price',
          market,
          symbol,
          condition,
          threshold: parseFloat(threshold),
          sound,
          vibration,
        })
        toast.success('Price alert created')
      } else {
        await api.post('/alerts', {
          category: 'tp_sl',
          market,
          symbol,
          side,
          entryPrice: parseFloat(entryPrice),
          takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
          stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
          sound,
          vibration,
        })
        toast.success('Take-profit / stop-loss alerts created')
      }
      setOpen(false)
      reset()
      onCreated()
    } catch (err: any) {
      toast.error(err.message || 'Failed to create alert')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="size-4" />
          Price / TP-SL Alert
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Trading Alert</DialogTitle>
          <DialogDescription>Alert on price levels or position take-profit / stop-loss.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(['price', 'tp_sl'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  mode === m ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {m === 'price' ? 'Price level' : 'TP / SL'}
              </button>
            ))}
          </div>

          <MarketSymbolFields market={market} setMarket={setMarket} symbol={symbol} setSymbol={setSymbol} />

          {mode === 'price' ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Condition</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setCondition('above')}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors text-left',
                      condition === 'above' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600' : 'border-border hover:border-primary/30'
                    )}
                  >
                    <ArrowUpRight className="size-4" /> Price above
                  </button>
                  <button
                    onClick={() => setCondition('below')}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors text-left',
                      condition === 'below' ? 'border-red-500/40 bg-red-500/10 text-red-600' : 'border-border hover:border-primary/30'
                    )}
                  >
                    <ArrowDownRight className="size-4" /> Price below
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Target price</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  step="0.0001"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Position side</Label>
                <Select value={side} onValueChange={setSide}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">Buy (long)</SelectItem>
                    <SelectItem value="sell">Sell (short)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-2">
                  <Label>Entry</Label>
                  <Input type="number" placeholder="0.00" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} step="0.0001" />
                </div>
                <div className="space-y-2">
                  <Label>Take profit</Label>
                  <Input type="number" placeholder="-" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} step="0.0001" />
                </div>
                <div className="space-y-2">
                  <Label>Stop loss</Label>
                  <Input type="number" placeholder="-" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} step="0.0001" />
                </div>
              </div>
            </div>
          )}

          <NotificationPrefs sound={sound} setSound={setSound} vibration={vibration} setVibration={setVibration} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!canSubmit() || creating}>
            {creating && <Loader2 className="size-4 animate-spin mr-2" />}
            Create Alert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Create Indicator / Signal Alert ───────────────────────────────────────────

function CreateIndicatorSignalDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'indicator' | 'signal'>('indicator')
  const [market, setMarket] = useState('stock')
  const [symbol, setSymbol] = useState('')
  const [field, setField] = useState('rsi_14')
  const [comparator, setComparator] = useState('<')
  const [threshold, setThreshold] = useState('')
  const [strategyName, setStrategyName] = useState('consensus')
  const [targetValue, setTargetValue] = useState('1')
  const [sound, setSound] = useState('default')
  const [vibration, setVibration] = useState('default')
  const [creating, setCreating] = useState(false)

  const reset = () => {
    setKind('indicator')
    setMarket('stock')
    setSymbol('')
    setField('rsi_14')
    setComparator('<')
    setThreshold('')
    setStrategyName('consensus')
    setTargetValue('1')
    setSound('default')
    setVibration('default')
  }

  const canSubmit = () => {
    if (!market || !symbol) return false
    if (kind === 'indicator') return Number.isFinite(parseFloat(threshold))
    return true
  }

  const handleCreate = async () => {
    if (!canSubmit()) return
    try {
      setCreating(true)
      if (kind === 'indicator') {
        await api.post('/alerts', {
          category: 'indicator',
          market,
          symbol,
          field,
          comparator,
          threshold: parseFloat(threshold),
          sound,
          vibration,
        })
        toast.success('Indicator alert created')
      } else {
        await api.post('/alerts', {
          category: 'signal',
          market,
          symbol,
          strategyName,
          targetValue: parseInt(targetValue, 10),
          sound,
          vibration,
        })
        toast.success('Signal alert created')
      }
      setOpen(false)
      reset()
      onCreated()
    } catch (err: any) {
      toast.error(err.message || 'Failed to create alert')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="size-4" />
          Indicator / Signal Alert
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Indicator / Signal Alert</DialogTitle>
          <DialogDescription>Alert on an indicator value or a strategy signal flip.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(['indicator', 'signal'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  kind === k ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {k === 'indicator' ? 'Indicator' : 'Strategy signal'}
              </button>
            ))}
          </div>

          <MarketSymbolFields market={market} setMarket={setMarket} symbol={symbol} setSymbol={setSymbol} />

          {kind === 'indicator' ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Indicator field</Label>
                <Select value={field} onValueChange={setField}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INDICATOR_FIELDS.map((f) => (
                      <SelectItem key={f} value={f}>{INDICATOR_FIELD_LABELS[f] || f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Comparator</Label>
                  <Select value={comparator} onValueChange={(v) => setComparator(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="<">Below (&lt;)</SelectItem>
                      <SelectItem value=">">Above (&gt;)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Threshold</Label>
                  <Input type="number" placeholder="0.00" value={threshold} onChange={(e) => setThreshold(e.target.value)} step="0.01" />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Strategy</Label>
                <Select value={strategyName} onValueChange={setStrategyName}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SIGNAL_STRATEGIES.map((s) => (
                      <SelectItem key={s} value={s}>{STRATEGY_LABELS[s] || s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Fire when signal turns</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: '1', label: 'Bullish', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600' },
                    { v: '0', label: 'Flat', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-600' },
                    { v: '-1', label: 'Bearish', cls: 'border-red-500/40 bg-red-500/10 text-red-600' },
                  ].map((o) => (
                    <button
                      key={o.v}
                      onClick={() => setTargetValue(o.v)}
                      className={cn(
                        'rounded-lg border px-2 py-2 text-sm font-medium transition-colors',
                        targetValue === o.v ? o.cls : 'border-border hover:border-primary/30'
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <NotificationPrefs sound={sound} setSound={setSound} vibration={vibration} setVibration={setVibration} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!canSubmit() || creating}>
            {creating && <Loader2 className="size-4 animate-spin mr-2" />}
            Create Alert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Rows ──────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config = {
    active: { dot: 'bg-emerald-500', label: 'Active', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
    triggered: { dot: 'bg-amber-500', label: 'Triggered', className: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
    cancelled: { dot: 'bg-gray-400', label: 'Cancelled', className: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  }
  const cfg = config[status as keyof typeof config] || config.cancelled
  return (
    <Badge variant="outline" className={cn('gap-1', cfg.className)}>
      <span className={cn('size-1.5 rounded-full', cfg.dot)} />
      {cfg.label}
    </Badge>
  )
}

function NotifyBadges({ sound, vibration }: { sound: string; vibration: string }) {
  return (
    <>
      <Badge variant="outline" className="gap-1 text-[10px]">
        <Volume2 className="size-3" /> {sound}
      </Badge>
      <Badge variant="outline" className="gap-1 text-[10px]">
        <Vibrate className="size-3" /> {vibration}
      </Badge>
    </>
  )
}

function AlertCardRow({
  alert,
  onCancel,
  actionLoading,
}: {
  alert: AlertRow
  onCancel: (id: number) => void
  actionLoading: boolean
}) {
  const meta = CATEGORY_META[alert.category]
  const Icon = meta.icon
  const isActive = alert.status === 'active'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border p-4 transition-colors',
        alert.status === 'cancelled' && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg border', meta.className)}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{alert.symbol}</span>
            <Badge variant="outline" className={cn('gap-1 text-[10px]', meta.className)}>
              <Icon className="size-3" /> {meta.label}
            </Badge>
            <StatusBadge status={alert.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {alert.market} · {conditionText(alert)}
            {alert.note && <span className="ml-1">· {alert.note}</span>}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <NotifyBadges sound={alert.sound} vibration={alert.vibration} />
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Clock className="size-3" /> {alert.createdAt.toLocaleString()}
            </Badge>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          disabled={!isActive || actionLoading}
          onClick={() => onCancel(alert.id)}
        >
          <Ban className="size-3.5" />
          Cancel
        </Button>
      </div>
    </motion.div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function AlertsPage() {
  const user = useStore((s) => s.user)
  const isPremium = user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'pro'

  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const processingRef = useRef(false)

  const fetchAlerts = useCallback(async () => {
    try {
      setError(null)
      const result = await api.get('/alerts')
      const rows: Array<Record<string, unknown>> = result.data?.alerts || []
      setAlerts(rows.map((r) => mapEngineRow(r)))
      setLoading(false)
    } catch (err: any) {
      setError(err.message || 'Failed to load alerts')
      setLoading(false)
    }
  }, [])

  const handleTriggered = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true
    try {
      const result = await api.get('/notifications?scope=pending')
      const list: EngineNotification[] = result.data?.notifications || []
      setPendingCount(list.length)
      for (const n of list) {
        showSystemNotification(n.title, n.body)
        toast(n.title, { description: n.body })
        setTimeout(() => playAlertSound(n.sound), 0)
        vibrate(n.vibration)
        try {
          await api.post('/notifications/ack', { id: n.id })
        } catch {}
      }
      setPendingCount(0)
    } catch {
    } finally {
      processingRef.current = false
    }
  }, [])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  useEffect(() => {
    const timer = setInterval(handleTriggered, 15_000)
    return () => clearInterval(timer)
  }, [handleTriggered])

  useEffect(() => {
    handleTriggered()
  }, [handleTriggered])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  const checkNow = async () => {
    try {
      setChecking(true)
      const result = await api.post('/alerts/check', {})
      const fired = result.data?.fired
      if (Array.isArray(fired) && fired.length > 0) {
        toast.success(`${fired.length} alert${fired.length === 1 ? '' : 's'} triggered`)
      }
      await fetchAlerts()
    } catch (err: any) {
      toast.error(err.message || 'Check failed')
    } finally {
      setChecking(false)
    }
  }

  const cancelAlert = async (id: number) => {
    try {
      setActionLoading(true)
      await api.post('/alerts/cancel', { id })
      toast.success('Alert cancelled')
      await fetchAlerts()
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel alert')
    } finally {
      setActionLoading(false)
    }
  }

  const { tradingAlerts, indicatorSignals, triggered } = useMemo(() => {
    const tradingCategories: Category[] = ['price', 'take_profit', 'stop_loss']
    const tradingAlerts = alerts.filter((a) => tradingCategories.includes(a.category) && a.status !== 'triggered')
    const indicatorSignals = alerts.filter((a) => (a.category === 'indicator' || a.category === 'signal') && a.status !== 'triggered')
    const triggeredList = alerts.filter((a) => a.status === 'triggered')
    return { tradingAlerts, indicatorSignals, triggered: triggeredList }
  }, [alerts])

  const activeCount = alerts.filter((a) => a.status === 'active').length
  const maxFreeAlerts = 5

  if (loading) {
    return (
      <div className="p-3 sm:p-4 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="h-8 w-32 animate-pulse rounded bg-muted" />
            <div className="h-4 w-56 animate-pulse rounded bg-muted mt-2" />
          </div>
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        </div>
        <LoadingState label="Loading alerts…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 sm:p-4 space-y-5">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="size-6 text-primary" />
            Alerts
          </h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="size-12 text-destructive/50 mb-4" />
            <h3 className="font-semibold mb-1">Failed to Load Alerts</h3>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchAlerts} className="gap-1.5">
              <Loader2 className="size-3.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-3 sm:p-4 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="size-6 text-primary" />
            Alerts
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Signal Engine
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Price, indicator, take-profit and stop-loss alerts with sound + vibration.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={checkNow}
            disabled={checking}
          >
            {checking ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
            Check now
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={fetchAlerts}
            disabled={actionLoading}
          >
            <RefreshCcw className="size-3.5" />
            Refresh
          </Button>
          <Badge variant="outline" className="gap-1.5 py-1 px-3">
            {isPremium ? (
              <>
                <Crown className="size-3 text-yellow-500" />
                Unlimited alerts (Premium)
              </>
            ) : (
              <>
                <Zap className="size-3" />
                {activeCount}/{maxFreeAlerts} active alerts (Free)
              </>
            )}
          </Badge>
          {pendingCount > 0 && (
            <Badge variant="outline" className="gap-1.5 py-1 px-3 border-amber-500/30 text-amber-600 bg-amber-500/10">
              <Radio className="size-3" />
              {pendingCount} pending
            </Badge>
          )}
        </div>
      </div>

      <Tabs defaultValue="trading" className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="trading" className="flex-1 sm:flex-none gap-1.5">
            <Target className="size-3.5" />
            Price & TP/SL
          </TabsTrigger>
          <TabsTrigger value="indicators" className="flex-1 sm:flex-none gap-1.5">
            <Activity className="size-3.5" />
            Indicators & Signals
          </TabsTrigger>
          <TabsTrigger value="triggered" className="flex-1 sm:flex-none gap-1.5">
            <BellRing className="size-3.5" />
            Triggered ({triggered.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trading" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Price, Take Profit & Stop Loss</h2>
            <CreateTradingAlertDialog onCreated={fetchAlerts} />
          </div>
          {tradingAlerts.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No trading alerts"
              subtitle="Create a price-level alert or attach take-profit / stop-loss alerts to your positions."
            />
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {tradingAlerts.map((alert) => (
                  <AlertCardRow key={alert.id} alert={alert} onCancel={cancelAlert} actionLoading={actionLoading} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </TabsContent>

        <TabsContent value="indicators" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Indicators & Strategy Signals</h2>
            <CreateIndicatorSignalDialog onCreated={fetchAlerts} />
          </div>
          {indicatorSignals.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No indicator / signal alerts"
              subtitle="Alert on RSI, MACD, moving averages, or a strategy signal turning bullish or bearish."
            />
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {indicatorSignals.map((alert) => (
                  <AlertCardRow key={alert.id} alert={alert} onCancel={cancelAlert} actionLoading={actionLoading} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </TabsContent>

        <TabsContent value="triggered" className="space-y-4">
          <h2 className="text-lg font-semibold">Triggered History</h2>
          {triggered.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No triggered alerts"
              subtitle="Alerts that fire will show up here with the value that triggered them."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[26rem]">
                  <div className="divide-y">
                    {triggered.map((alert) => {
                      const meta = CATEGORY_META[alert.category]
                      const Icon = meta.icon
                      return (
                        <div key={alert.id} className="flex items-center gap-3 px-4 py-3">
                          <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-full border', meta.className)}>
                            <Icon className="size-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{alert.symbol}</span>
                              <Badge variant="outline" className={cn('gap-1 text-[10px]', meta.className)}>
                                {meta.label}
                              </Badge>
                              <NotifyBadges sound={alert.sound} vibration={alert.vibration} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {conditionText(alert)}
                              {alert.triggeredValue != null && (
                                <span className="text-amber-600 dark:text-amber-400 font-medium">
                                  {' '}&rarr; Hit at {formatPrice(alert.triggeredValue)}
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-muted-foreground">
                              {alert.triggeredAt ? alert.triggeredAt.toLocaleDateString() : '—'}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {alert.triggeredAt ? alert.triggeredAt.toLocaleTimeString() : ''}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
