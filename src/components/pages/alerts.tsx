'use client'

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell,
  Plus,
  Edit3,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeftRight,
  Clock,
  RefreshCcw,
  Zap,
  Crown,
  Search,
  ChevronRight,
  Check,
  Loader2,
  AlertCircle,
  Volume2,
  Vibrate,
  BellRing,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { useLiveMarket } from '@/hooks/use-live-market'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Types ─────────────────────────────────────────────────────────────────────

type PriceAlertType = 'Above' | 'Below' | 'Crosses'
type AlertStatus = 'active' | 'triggered' | 'paused'
type AlertFrequency = 'one-time' | 'recurring'

interface PriceAlert {
  id: string
  asset: string
  type: PriceAlertType
  targetPrice: number
  currentPrice: number
  status: AlertStatus
  frequency: AlertFrequency
  triggeredAt?: string
  createdAt: string
  soundEnabled: boolean
  soundUri?: string | null
  vibrateEnabled: boolean
  notifyType: string
}

type CustomAlertType = 'RSI' | 'MACD' | 'MA Cross' | 'Volume Spike' | 'S/R Break'

interface CustomAlert {
  id: string
  asset: string
  type: CustomAlertType
  condition: string
  status: AlertStatus
  frequency: AlertFrequency
  createdAt: string
  soundEnabled: boolean
  soundUri?: string | null
  vibrateEnabled: boolean
  notifyType: string
}

// ─── Helper: Map API data to UI types ──────────────────────────────────────────

function mapApiAlertTypeToUi(apiType: string): PriceAlertType {
  const map: Record<string, PriceAlertType> = {
    above: 'Above',
    below: 'Below',
    crosses: 'Crosses',
  }
  return map[apiType] || 'Above'
}

function mapUiAlertTypeToApi(uiType: PriceAlertType): string {
  const map: Record<string, string> = {
    Above: 'above',
    Below: 'below',
    Crosses: 'crosses',
  }
  return map[uiType] || 'above'
}

function mapApiCustomTypeToUi(apiType: string): CustomAlertType {
  const map: Record<string, CustomAlertType> = {
    rsi: 'RSI',
    macd: 'MACD',
    ma_cross: 'MA Cross',
    volume_spike: 'Volume Spike',
    support_resistance: 'S/R Break',
  }
  return map[apiType] || 'RSI'
}

function mapUiCustomTypeToApi(uiType: CustomAlertType): string {
  const map: Record<string, string> = {
    RSI: 'rsi',
    MACD: 'macd',
    'MA Cross': 'ma_cross',
    'Volume Spike': 'volume_spike',
    'S/R Break': 'support_resistance',
  }
  return map[uiType] || 'rsi'
}

function getAlertStatus(isActive: boolean, isTriggered: boolean): AlertStatus {
  if (isTriggered) return 'triggered'
  if (!isActive) return 'paused'
  return 'active'
}

const assetOptions = [
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF',
  'NZD/USD', 'USD/CAD', 'BTC/USD', 'ETH/USD', 'XAU/USD',
]

// ─── Helper Components ─────────────────────────────────────────────────────────

function AlertTypeBadge({ type }: { type: PriceAlertType }) {
  const config = {
    Above: { icon: ArrowUpRight, className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
    Below: { icon: ArrowDownRight, className: 'bg-red-500/10 text-red-600 border-red-500/20' },
    Crosses: { icon: ArrowLeftRight, className: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  }
  const { icon: Icon, className } = config[type]
  return (
    <Badge variant="outline" className={cn('gap-1', className)}>
      <Icon className="size-3" />
      {type}
    </Badge>
  )
}

function StatusBadge({ status }: { status: AlertStatus }) {
  const config = {
    active: { dot: 'bg-emerald-500', label: 'Active', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
    triggered: { dot: 'bg-amber-500', label: 'Triggered', className: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
    paused: { dot: 'bg-gray-400', label: 'Paused', className: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  }
  const { dot, label, className } = config[status]
  return (
    <Badge variant="outline" className={cn('gap-1', className)}>
      <span className={cn('size-1.5 rounded-full', dot)} />
      {label}
    </Badge>
  )
}

function FrequencyBadge({ frequency }: { frequency: AlertFrequency }) {
  return (
    <Badge variant="secondary" className="gap-1 text-[10px]">
      {frequency === 'one-time' ? <Clock className="size-3" /> : <RefreshCcw className="size-3" />}
      {frequency === 'one-time' ? 'One-time' : 'Recurring'}
    </Badge>
  )
}

function CustomAlertTypeBadge({ type }: { type: CustomAlertType }) {
  const colorMap: Record<CustomAlertType, string> = {
    RSI: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    MACD: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
    'MA Cross': 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    'Volume Spike': 'bg-pink-500/10 text-pink-600 border-pink-500/20',
    'S/R Break': 'bg-teal-500/10 text-teal-600 border-teal-500/20',
  }
  return (
    <Badge variant="outline" className={cn('gap-1', colorMap[type])}>
      {type}
    </Badge>
  )
}

// ─── Alert Notification Options ──────────────────────────────────────────────────

const SOUND_OPTIONS = [
  { value: '', label: 'Default (system sound)' },
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

const NOTIFY_TYPE_OPTIONS = [
  { value: 'system', label: 'System / Home-screen' },
  { value: 'in_app', label: 'In-app only' },
  { value: 'both', label: 'Both' },
]

interface AlertNotifValue {
  soundEnabled: boolean
  soundUri?: string | null
  vibrateEnabled: boolean
  notifyType: string
}

function AlertNotificationOptions({
  value,
  onChange,
}: {
  value: AlertNotifValue
  onChange: (next: AlertNotifValue) => void
}) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">Notification</p>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm">Play a sound</Label>
          <p className="text-xs text-muted-foreground">Ringtone / alert tone when it triggers</p>
        </div>
        <Switch checked={value.soundEnabled} onCheckedChange={(c) => onChange({ ...value, soundEnabled: c })} />
      </div>

      {value.soundEnabled && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Sound</Label>
          <Select
            value={value.soundUri ?? ''}
            onValueChange={(v) => onChange({ ...value, soundUri: v || null })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a sound" />
            </SelectTrigger>
            <SelectContent>
              {SOUND_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm">Vibrate</Label>
          <p className="text-xs text-muted-foreground">Vibration alert on your phone</p>
        </div>
        <Switch checked={value.vibrateEnabled} onCheckedChange={(c) => onChange({ ...value, vibrateEnabled: c })} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Alert delivery</Label>
        <Select
          value={value.notifyType || 'system'}
          onValueChange={(v) => onChange({ ...value, notifyType: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOTIFY_TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function NotifyBadges({ value }: { value: AlertNotifValue }) {
  return (
    <>
      {value.soundEnabled && (
        <Badge variant="outline" className="gap-1 text-[10px]">
          <Volume2 className="size-3" /> Sound
        </Badge>
      )}
      {value.vibrateEnabled && (
        <Badge variant="outline" className="gap-1 text-[10px]">
          <Vibrate className="size-3" /> Vibrate
        </Badge>
      )}
      {(value.notifyType === 'system' || value.notifyType === 'both') && (
        <Badge variant="outline" className="gap-1 text-[10px]">
          <BellRing className="size-3" /> System
        </Badge>
      )}
    </>
  )
}

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
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
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

function playAlertSound(uri?: string | null) {
  if (typeof window === 'undefined') return
  ensureRingtoneUrls()

  const selected = uri && uri !== '' && RINGTONE_URLS[uri] ? uri : 'bell'
  const url = RINGTONE_URLS[selected]
  if (!url) return

  try {
    const audio = new Audio(url)
    audio.volume = 1.0
    audio.play().catch(() => {
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext
        if (!Ctx) return
        const ctx = new Ctx()
        const now = ctx.currentTime
        const tone = (freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.25) => {
          const osc = ctx.createOscillator()
          const g = ctx.createGain()
          osc.type = type
          osc.frequency.value = freq
          g.gain.setValueAtTime(0.0001, now + start)
          g.gain.exponentialRampToValueAtTime(gain, now + start + 0.02)
          g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)
          osc.connect(g)
          g.connect(ctx.destination)
          osc.start(now + start)
          osc.stop(now + start + dur + 0.05)
        }
        if (selected === 'ding') {
          tone(1318, 0, 0.6, 'sine')
        } else if (selected === 'chime') {
          tone(1046, 0, 0.5, 'sine')
          tone(1568, 0.12, 0.7, 'sine')
        } else if (selected === 'alarm') {
          tone(880, 0, 0.15, 'square', 0.2)
          tone(880, 0.2, 0.15, 'square', 0.2)
          tone(880, 0.4, 0.15, 'square', 0.2)
          tone(880, 0.6, 0.15, 'square', 0.2)
        } else if (selected === 'siren') {
          tone(600, 0, 0.4, 'sawtooth', 0.15)
          tone(1000, 0.4, 0.4, 'sawtooth', 0.15)
          tone(600, 0.8, 0.4, 'sawtooth', 0.15)
          tone(1000, 1.2, 0.4, 'sawtooth', 0.15)
        } else {
          tone(880, 0, 0.4, 'sine')
          tone(1318, 0.18, 0.5, 'sine')
        }
      } catch (e) {}
    })
  } catch (e) {}
}

function fireAlertNotification(prefs: AlertNotifValue, asset?: string, targetPrice?: number) {
  if (typeof navigator === 'undefined') return
  if (prefs.soundEnabled) playAlertSound(prefs.soundUri)
  if (prefs.vibrateEnabled && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate([200, 80, 200, 80, 200]) } catch (e) {}
  }
  if (prefs.notifyType === 'system' || prefs.notifyType === 'both') {
    try {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'default') {
          Notification.requestPermission()
        }
        if (Notification.permission === 'granted') {
          const title = 'TOPTIER Alert Triggered'
          const body = asset
            ? `${asset}${targetPrice != null ? ` reached ${targetPrice}` : ''} — your alert condition has been met.`
            : 'Your alert condition has been met.'
          new Notification(title, {
            body,
            icon: '/icons/toptier-icon-192.png',
            badge: '/icons/toptier-icon-192.png',
            tag: `alert-${asset || 'generic'}`,
            requireInteraction: true,
          } as NotificationOptions)
        }
      }
    } catch (e) {}
  }
}

// ─── Loading Skeleton ──────────────────────────────────────────────────────────

function AlertsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-7 w-32 animate-pulse rounded bg-muted" />
        <div className="h-8 w-36 animate-pulse rounded bg-muted" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border p-4">
          <div className="size-10 animate-pulse rounded-lg bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-3 w-64 animate-pulse rounded bg-muted" />
          </div>
          <div className="size-8 animate-pulse rounded bg-muted" />
          <div className="size-8 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

// ─── Create Price Alert Dialog ─────────────────────────────────────────────────

function CreatePriceAlertDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [asset, setAsset] = useState('')
  const [alertType, setAlertType] = useState<PriceAlertType>('Above')
  const [targetPrice, setTargetPrice] = useState('')
  const [frequency, setFrequency] = useState<AlertFrequency>('one-time')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [notif, setNotif] = useState<AlertNotifValue>({
    soundEnabled: true,
    soundUri: null,
    vibrateEnabled: true,
    notifyType: 'system',
  })

  const filteredAssets = assetOptions.filter(a =>
    a.toLowerCase().includes(search.toLowerCase())
  )

  const handleCreate = async () => {
    if (!asset || !targetPrice) return
    try {
      setCreating(true)
      await api.post('/alerts', {
        alertCategory: 'price',
        asset,
        alertType: mapUiAlertTypeToApi(alertType),
        targetPrice: parseFloat(targetPrice),
        isRecurring: frequency === 'recurring',
        soundEnabled: notif.soundEnabled,
        soundUri: notif.soundUri || null,
        vibrateEnabled: notif.vibrateEnabled,
        notifyType: notif.notifyType,
      })
      toast.success('Price alert created')
      setOpen(false)
      setAsset('')
      setTargetPrice('')
      setAlertType('Above')
      setFrequency('one-time')
      setSearch('')
      setNotif({ soundEnabled: true, soundUri: null, vibrateEnabled: true, notifyType: 'system' })
      onCreated()
    } catch (err: any) {
      toast.error(err.message || 'Failed to create alert')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="size-4" />
          Create Price Alert
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Price Alert</DialogTitle>
          <DialogDescription>Set up a price alert for your favorite asset.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Asset Selector */}
          <div className="space-y-2">
            <Label>Asset</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search asset..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  if (!e.target.value) setAsset('')
                }}
                className="pl-9"
              />
            </div>
            {search && !asset && (
              <div className="border rounded-md max-h-32 overflow-y-auto">
                {filteredAssets.map((a) => (
                  <button
                    key={a}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                    onClick={() => {
                      setAsset(a)
                      setSearch(a)
                    }}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Alert Type */}
          <div className="space-y-2">
            <Label>Alert Type</Label>
            <Select value={alertType} onValueChange={(v) => setAlertType(v as PriceAlertType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Above">
                  <span className="flex items-center gap-2">
                    <ArrowUpRight className="size-3 text-emerald-600" /> Above
                  </span>
                </SelectItem>
                <SelectItem value="Below">
                  <span className="flex items-center gap-2">
                    <ArrowDownRight className="size-3 text-red-600" /> Below
                  </span>
                </SelectItem>
                <SelectItem value="Crosses">
                  <span className="flex items-center gap-2">
                    <ArrowLeftRight className="size-3 text-amber-600" /> Crosses
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Target Price */}
          <div className="space-y-2">
            <Label>Target Price</Label>
            <Input
              type="number"
              placeholder="0.00"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              step="0.0001"
            />
          </div>

          {/* Frequency Toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm">Recurring Alert</Label>
              <p className="text-xs text-muted-foreground">
                {frequency === 'one-time' ? 'Fires once then deactivates' : 'Fires every time condition is met'}
              </p>
            </div>
            <Switch
              checked={frequency === 'recurring'}
              onCheckedChange={(checked) =>
                setFrequency(checked ? 'recurring' : 'one-time')
              }
            />
          </div>

          <AlertNotificationOptions value={notif} onChange={setNotif} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!asset || !targetPrice || creating}>
            {creating ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            Create Alert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit Price Alert Dialog ───────────────────────────────────────────────────

function EditPriceAlertDialog({
  alert,
  open,
  onOpenChange,
  onSaved,
}: {
  alert: PriceAlert
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [targetPrice, setTargetPrice] = useState(alert.targetPrice.toString())
  const [alertType, setAlertType] = useState<PriceAlertType>(alert.type)
  const [frequency, setFrequency] = useState<AlertFrequency>(alert.frequency)
  const [saving, setSaving] = useState(false)
  const [notif, setNotif] = useState<AlertNotifValue>({
    soundEnabled: alert.soundEnabled ?? true,
    soundUri: alert.soundUri ?? null,
    vibrateEnabled: alert.vibrateEnabled ?? true,
    notifyType: alert.notifyType || 'system',
  })

  const handleSave = async () => {
    try {
      setSaving(true)
      await api.patch('/alerts', {
        alertCategory: 'price',
        alertId: alert.id,
        alertType: mapUiAlertTypeToApi(alertType),
        targetPrice: parseFloat(targetPrice),
        isRecurring: frequency === 'recurring',
        soundEnabled: notif.soundEnabled,
        soundUri: notif.soundUri || null,
        vibrateEnabled: notif.vibrateEnabled,
        notifyType: notif.notifyType,
      })
      toast.success('Alert updated')
      onSaved()
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message || 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Alert - {alert.asset}</DialogTitle>
          <DialogDescription>Modify your price alert settings.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Alert Type</Label>
            <Select value={alertType} onValueChange={(v) => setAlertType(v as PriceAlertType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Above">Above</SelectItem>
                <SelectItem value="Below">Below</SelectItem>
                <SelectItem value="Crosses">Crosses</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Target Price</Label>
            <Input
              type="number"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              step="0.0001"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm">Recurring Alert</Label>
              <p className="text-xs text-muted-foreground">
                {frequency === 'one-time' ? 'Fires once then deactivates' : 'Fires every time condition is met'}
              </p>
            </div>
            <Switch
              checked={frequency === 'recurring'}
              onCheckedChange={(checked) =>
                setFrequency(checked ? 'recurring' : 'one-time')
              }
            />
          </div>

          <AlertNotificationOptions value={notif} onChange={setNotif} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Create Custom Alert Wizard ────────────────────────────────────────────────

function CreateCustomAlertWizard({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [asset, setAsset] = useState('')
  const [alertType, setAlertType] = useState<CustomAlertType>('RSI')
  const [condition, setCondition] = useState('')
  const [threshold, setThreshold] = useState('')
  const [creating, setCreating] = useState(false)
  const [notif, setNotif] = useState<AlertNotifValue>({
    soundEnabled: true,
    soundUri: null,
    vibrateEnabled: true,
    notifyType: 'system',
  })

  const conditionPresets: Record<CustomAlertType, string[]> = {
    RSI: ['RSI below', 'RSI above'],
    MACD: ['MACD bullish crossover', 'MACD bearish crossover', 'MACD histogram positive'],
    'MA Cross': ['50 MA crosses above 200 MA', '50 MA crosses below 200 MA', '20 MA crosses above 50 MA'],
    'Volume Spike': ['Volume above', 'Volume below'],
    'S/R Break': ['Breaks resistance at', 'Breaks support at'],
  }

  const needsThreshold = ['RSI below', 'RSI above', 'Volume above', 'Volume below', 'Breaks resistance at', 'Breaks support at']

  const handleCreate = async () => {
    const fullCondition = needsThreshold.includes(condition) && threshold
      ? `${condition} ${threshold}`
      : condition
    try {
      setCreating(true)
      await api.post('/alerts', {
        alertCategory: 'custom',
        asset,
        alertType: mapUiCustomTypeToApi(alertType),
        condition: fullCondition,
        soundEnabled: notif.soundEnabled,
        soundUri: notif.soundUri || null,
        vibrateEnabled: notif.vibrateEnabled,
        notifyType: notif.notifyType,
      })
      toast.success('Custom alert created')
      setOpen(false)
      setStep(1)
      setAsset('')
      setAlertType('RSI')
      setCondition('')
      setThreshold('')
      setNotif({ soundEnabled: true, soundUri: null, vibrateEnabled: true, notifyType: 'system' })
      onCreated()
    } catch (err: any) {
      toast.error(err.message || 'Failed to create alert')
    } finally {
      setCreating(false)
    }
  }

  const canProceed = () => {
    switch (step) {
      case 1: return !!asset
      case 2: return !!alertType
      case 3: return !!condition && (!needsThreshold.includes(condition) || !!threshold)
      case 4: return true
      default: return false
    }
  }

  const steps = [
    { num: 1, label: 'Asset' },
    { num: 2, label: 'Indicator' },
    { num: 3, label: 'Condition' },
    { num: 4, label: 'Review' },
  ]

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setStep(1); setAsset(''); setAlertType('RSI'); setCondition(''); setThreshold('') } }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="size-4" />
          Create Custom Alert
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Custom Alert</DialogTitle>
          <DialogDescription>Set up an indicator-based alert.</DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 py-2">
          {steps.map((s, i) => (
            <React.Fragment key={s.num}>
              <div className={cn(
                'flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                step >= s.num ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              )}>
                <span className={cn(
                  'flex size-5 items-center justify-center rounded-full text-[10px]',
                  step > s.num ? 'bg-primary text-primary-foreground' :
                  step === s.num ? 'border border-primary text-primary' : 'border border-muted-foreground/30 text-muted-foreground'
                )}>
                  {step > s.num ? <Check className="size-3" /> : s.num}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < steps.length - 1 && <ChevronRight className="size-3 text-muted-foreground shrink-0" />}
            </React.Fragment>
          ))}
        </div>

        <div className="min-h-[180px]">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <Label>Select Asset</Label>
                <div className="grid grid-cols-2 gap-2">
                  {assetOptions.map((a) => (
                    <button
                      key={a}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-sm transition-colors text-left',
                        asset === a ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'
                      )}
                      onClick={() => setAsset(a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <Label>Select Indicator Type</Label>
                <div className="space-y-2">
                  {(['RSI', 'MACD', 'MA Cross', 'Volume Spike', 'S/R Break'] as CustomAlertType[]).map((t) => (
                    <button
                      key={t}
                      className={cn(
                        'flex items-center gap-3 w-full rounded-lg border px-4 py-3 text-sm transition-colors text-left',
                        alertType === t ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/30'
                      )}
                      onClick={() => { setAlertType(t); setCondition('') }}
                    >
                      <CustomAlertTypeBadge type={t} />
                      <span className="text-muted-foreground text-xs">
                        {t === 'RSI' ? 'Relative Strength Index' :
                         t === 'MACD' ? 'Moving Average Convergence Divergence' :
                         t === 'MA Cross' ? 'Moving Average Crossover' :
                         t === 'Volume Spike' ? 'Abnormal Volume Detection' :
                         'Support/Resistance Breakout'}
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <Label>Set Condition</Label>
                <Select value={condition} onValueChange={setCondition}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select condition..." />
                  </SelectTrigger>
                  <SelectContent>
                    {conditionPresets[alertType].map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {needsThreshold.includes(condition) && (
                  <div className="space-y-2">
                    <Label>Threshold Value</Label>
                    <Input
                      type="number"
                      placeholder="Enter value..."
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                    />
                  </div>
                )}
              </motion.div>
            )}

            {step === 4 && (
              <motion.div key="s4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <Label>Review Your Alert</Label>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Asset</span>
                      <span className="font-medium">{asset}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Indicator</span>
                      <CustomAlertTypeBadge type={alertType} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Condition</span>
                      <span className="font-medium text-sm">
                        {needsThreshold.includes(condition) && threshold
                          ? `${condition} ${threshold}`
                          : condition}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <AlertNotificationOptions value={notif} onChange={setNotif} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DialogFooter>
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>Back</Button>
          )}
          {step < 4 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canProceed()}>
              Next
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Create Alert
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Price Alert Row ───────────────────────────────────────────────────────────

function PriceAlertRow({
  alert,
  onToggle,
  onEdit,
  onDelete,
  actionLoading,
}: {
  alert: PriceAlert
  onToggle: (id: string) => void
  onEdit: () => void
  onDelete: (id: string) => void
  actionLoading: boolean
}) {
  const [editOpen, setEditOpen] = useState(false)
  const isPaused = alert.status === 'paused'
  const isTriggered = alert.status === 'triggered'

  const priceDiff = alert.currentPrice - alert.targetPrice
  const priceDiffPercent = ((priceDiff / alert.targetPrice) * 100).toFixed(2)

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border p-4 transition-colors',
          isPaused && 'opacity-60',
          isTriggered && 'border-amber-500/30 bg-amber-500/5'
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Bell className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{alert.asset}</span>
              <AlertTypeBadge type={alert.type} />
              <StatusBadge status={alert.status} />
              <FrequencyBadge frequency={alert.frequency} />
              <NotifyBadges value={alert} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span>Target: <span className="font-medium text-foreground">{alert.targetPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span></span>
              <span>Current: <span className="font-medium text-foreground">{alert.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span></span>
              <span className={cn(
                parseFloat(priceDiffPercent) > 0 ? 'text-emerald-600' :
                parseFloat(priceDiffPercent) < 0 ? 'text-red-600' : 'text-muted-foreground'
              )}>
                ({parseFloat(priceDiffPercent) > 0 ? '+' : ''}{priceDiffPercent}%)
              </span>
            </div>
            {isTriggered && alert.triggeredAt && (
              <p className="text-xs text-amber-600 mt-1">
                Triggered {new Date(alert.triggeredAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:shrink-0">
          <Switch
            checked={alert.status === 'active'}
            disabled={isTriggered || actionLoading}
            onCheckedChange={() => onToggle(alert.id)}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setEditOpen(true)}
            disabled={isTriggered || actionLoading}
          >
            <Edit3 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-destructive hover:text-destructive"
            onClick={() => onDelete(alert.id)}
            disabled={actionLoading}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </motion.div>

      <EditPriceAlertDialog
        alert={alert}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={onEdit}
      />
    </>
  )
}

// ─── Custom Alert Row ──────────────────────────────────────────────────────────

function CustomAlertRow({
  alert,
  onToggle,
  onDelete,
  actionLoading,
}: {
  alert: CustomAlert
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  actionLoading: boolean
}) {
  const isPaused = alert.status === 'paused'
  const isTriggered = alert.status === 'triggered'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border p-4 transition-colors',
        isPaused && 'opacity-60',
        isTriggered && 'border-amber-500/30 bg-amber-500/5'
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <AlertTriangle className="size-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{alert.asset}</span>
            <CustomAlertTypeBadge type={alert.type} />
            <StatusBadge status={alert.status} />
            <NotifyBadges value={alert} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Condition: <span className="font-medium text-foreground">{alert.condition}</span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:shrink-0">
        <Switch
          checked={alert.status === 'active'}
          disabled={isTriggered || actionLoading}
          onCheckedChange={() => onToggle(alert.id)}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-destructive hover:text-destructive"
          onClick={() => onDelete(alert.id)}
          disabled={actionLoading}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </motion.div>
  )
}

// ─── Main Alerts Page ──────────────────────────────────────────────────────────

export function AlertsPage() {
  const user = useStore((s) => s.user)
  const isPremium = user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'pro'
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([])
  const [customAlerts, setCustomAlerts] = useState<CustomAlert[]>([])
  const [triggeredAlerts, setTriggeredAlerts] = useState<PriceAlert[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Fetch alerts from API
  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await api.get('/alerts')
      const data = result.data as {
        priceAlerts?: Array<{
          id: string
          asset: string
          alertType: string
          targetPrice: number
          isRecurring: boolean
          isActive: boolean
          isTriggered: boolean
          triggeredAt: string | null
          createdAt: string
          soundEnabled: boolean
          soundUri: string | null
          vibrateEnabled: boolean
          notifyType: string
        }>
        customAlerts?: Array<{
          id: string
          asset: string
          alertType: string
          condition: string
          isActive: boolean
          isTriggered: boolean
          triggeredAt: string | null
          createdAt: string
          soundEnabled: boolean
          soundUri: string | null
          vibrateEnabled: boolean
          notifyType: string
        }>
      }

      // Map API price alerts to UI types
      const mappedPriceAlerts: PriceAlert[] = (data.priceAlerts || []).map((a) => ({
        id: a.id,
        asset: a.asset,
        type: mapApiAlertTypeToUi(a.alertType),
        targetPrice: a.targetPrice,
        currentPrice: a.targetPrice * (mapApiAlertTypeToUi(a.alertType) === 'Above' ? 0.995 : 1.005),
        status: getAlertStatus(a.isActive, a.isTriggered),
        frequency: a.isRecurring ? 'recurring' : 'one-time',
        triggeredAt: a.triggeredAt || undefined,
        createdAt: a.createdAt,
        soundEnabled: a.soundEnabled ?? true,
        soundUri: a.soundUri ?? null,
        vibrateEnabled: a.vibrateEnabled ?? true,
        notifyType: a.notifyType || 'system',
      }))

      // Map API custom alerts to UI types
      const mappedCustomAlerts: CustomAlert[] = (data.customAlerts || []).map((a) => ({
        id: a.id,
        asset: a.asset,
        type: mapApiCustomTypeToUi(a.alertType),
        condition: a.condition,
        status: getAlertStatus(a.isActive, a.isTriggered),
        frequency: 'recurring',
        createdAt: a.createdAt,
        soundEnabled: a.soundEnabled ?? true,
        soundUri: a.soundUri ?? null,
        vibrateEnabled: a.vibrateEnabled ?? true,
        notifyType: a.notifyType || 'system',
      }))

      setPriceAlerts(mappedPriceAlerts.filter((a) => a.status !== 'triggered'))
      setTriggeredAlerts(mappedPriceAlerts.filter((a) => a.status === 'triggered'))
      setCustomAlerts(mappedCustomAlerts)
    } catch (err: any) {
      setError(err.message || 'Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  // Fetch live prices for every asset referenced by price alerts so the
  // "Current Price" column shows real-time data instead of a static estimate.
  const alertSymbols = useMemo(() => {
    const set = new Set<string>()
    priceAlerts.forEach(a => { if (a.asset) set.add(a.asset) })
    triggeredAlerts.forEach(a => { if (a.asset) set.add(a.asset) })
    return Array.from(set)
  }, [priceAlerts, triggeredAlerts])

  const { prices: livePrices, source, lastUpdated } = useLiveMarket({
    symbols: alertSymbols,
    refreshMs: 30_000,
    enabled: alertSymbols.length > 0,
  })

  const livePriceMap = useMemo(() => {
    const m = new Map<string, number>()
    livePrices.forEach(p => m.set(p.symbol, p.price))
    return m
  }, [livePrices])

  // Overlay live prices on top of the API-provided alerts. Falls back to the
  // existing estimate when no live price is available for an asset.
  const mergedPriceAlerts = useMemo<PriceAlert[]>(() => {
    return priceAlerts.map(a => {
      const live = livePriceMap.get(a.asset)
      return live !== undefined ? { ...a, currentPrice: live } : a
    })
  }, [priceAlerts, livePriceMap])

  const mergedTriggeredAlerts = useMemo<PriceAlert[]>(() => {
    return triggeredAlerts.map(a => {
      const live = livePriceMap.get(a.asset)
      return live !== undefined ? { ...a, currentPrice: live } : a
    })
  }, [triggeredAlerts, livePriceMap])

  // Fire sound + vibration + system notification when an alert is first
  // detected as triggered (server flips isTriggered during polling).
  const seenTriggeredRef = useRef<Set<string>>(new Set())
  const notifiedTriggeredRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const fresh = new Set<string>()
    triggeredAlerts.forEach((a) => {
      fresh.add(a.id)
      if (!seenTriggeredRef.current.has(a.id) && !notifiedTriggeredRef.current.has(a.id)) {
        notifiedTriggeredRef.current.add(a.id)
        fireAlertNotification({
          soundEnabled: a.soundEnabled,
          soundUri: a.soundUri,
          vibrateEnabled: a.vibrateEnabled,
          notifyType: a.notifyType,
        }, a.asset, a.targetPrice)
        toast('Alert triggered', {
          description: `${a.asset} price alert was triggered`,
        })
      }
    })
    seenTriggeredRef.current = fresh
  }, [triggeredAlerts])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isLive = source === 'finnhub' || source === 'yahoo' || source === 'mixed'

  const activeAlerts = priceAlerts.filter((a) => a.status === 'active').length
  const maxFreeAlerts = 5

  const togglePriceAlert = async (id: string) => {
    const alert = priceAlerts.find((a) => a.id === id)
    if (!alert) return
    const newActive = alert.status !== 'active'
    try {
      setActionLoading(true)
      await api.patch('/alerts', {
        alertCategory: 'price',
        alertId: id,
        isActive: newActive,
      })
      await fetchAlerts()
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle alert')
    } finally {
      setActionLoading(false)
    }
  }

  const editPriceAlert = () => {
    // Refresh data after edit
    fetchAlerts()
  }

  const deletePriceAlert = async (id: string) => {
    try {
      setActionLoading(true)
      await api.delete(`/alerts?alertId=${id}&alertCategory=price`)
      toast.success('Alert deleted')
      await fetchAlerts()
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete alert')
    } finally {
      setActionLoading(false)
    }
  }

  const toggleCustomAlert = async (id: string) => {
    const alert = customAlerts.find((a) => a.id === id)
    if (!alert) return
    const newActive = alert.status !== 'active'
    try {
      setActionLoading(true)
      await api.patch('/alerts', {
        alertCategory: 'custom',
        alertId: id,
        isActive: newActive,
      })
      await fetchAlerts()
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle alert')
    } finally {
      setActionLoading(false)
    }
  }

  const deleteCustomAlert = async (id: string) => {
    try {
      setActionLoading(true)
      await api.delete(`/alerts?alertId=${id}&alertCategory=custom`)
      toast.success('Alert deleted')
      await fetchAlerts()
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete alert')
    } finally {
      setActionLoading(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="h-8 w-32 animate-pulse rounded bg-muted" />
            <div className="h-4 w-56 animate-pulse rounded bg-muted mt-2" />
          </div>
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        </div>
        <AlertsSkeleton />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
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
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="size-6 text-primary" />
            Alerts
            {isLive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                LIVE
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your price and indicator-based alerts
            {lastUpdated && (
              <span className="ml-1 text-[11px]">
                · Updated {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        {/* Alert counter */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 py-1 px-3">
            {isPremium ? (
              <>
                <Crown className="size-3 text-yellow-500" />
                Unlimited alerts (Premium)
              </>
            ) : (
              <>
                <Zap className="size-3" />
                {activeAlerts}/{maxFreeAlerts} active alerts (Free)
              </>
            )}
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="price" className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="price" className="flex-1 sm:flex-none gap-1.5">
            <Bell className="size-3.5" />
            Price Alerts
          </TabsTrigger>
          <TabsTrigger value="custom" className="flex-1 sm:flex-none gap-1.5">
            <AlertTriangle className="size-3.5" />
            Custom Alerts
          </TabsTrigger>
        </TabsList>

        {/* ─── Price Alerts Tab ─── */}
        <TabsContent value="price" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Price Alerts</h2>
            <CreatePriceAlertDialog onCreated={fetchAlerts} />
          </div>

          {mergedPriceAlerts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Bell className="size-12 text-muted-foreground/30 mb-4" />
                <h3 className="font-semibold mb-1">No Price Alerts</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create your first alert to get notified when prices reach your targets.
                </p>
                <CreatePriceAlertDialog onCreated={fetchAlerts} />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {mergedPriceAlerts.map((alert) => (
                <PriceAlertRow
                  key={alert.id}
                  alert={alert}
                  onToggle={togglePriceAlert}
                  onEdit={editPriceAlert}
                  onDelete={deletePriceAlert}
                  actionLoading={actionLoading}
                />
              ))}
            </div>
          )}

          {/* Alert History (Collapsible) */}
          <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Clock className="size-4 text-muted-foreground" />
                  Alert History ({mergedTriggeredAlerts.length} triggered)
                </span>
                {historyOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card className="mt-2">
                <CardContent className="p-0">
                  <ScrollArea className="max-h-64">
                    <div className="divide-y">
                      {mergedTriggeredAlerts.length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                          No triggered alerts in history
                        </div>
                      ) : (
                        mergedTriggeredAlerts.map((alert) => (
                          <div key={alert.id} className="flex items-center gap-3 px-4 py-3">
                            <div className="flex size-8 items-center justify-center rounded-full bg-amber-500/10">
                              <Bell className="size-3.5 text-amber-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{alert.asset}</span>
                                <AlertTypeBadge type={alert.type} />
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Target: {alert.targetPrice.toLocaleString()} → Actual: {alert.currentPrice.toLocaleString()}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs text-muted-foreground">
                                {alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleDateString() : ''}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleTimeString() : ''}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        </TabsContent>

        {/* ─── Custom Alerts Tab ─── */}
        <TabsContent value="custom" className="space-y-4">
          {/* Premium Badge */}
          {!isPremium && (
            <Card className="border-yellow-500/30 bg-yellow-500/5">
              <CardContent className="flex items-center gap-3 p-4">
                <Crown className="size-5 text-yellow-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Custom alerts are a Premium feature</p>
                  <p className="text-xs text-muted-foreground">
                    Upgrade to create indicator-based alerts like RSI, MACD, and more.
                  </p>
                </div>
                <Button size="sm" variant="outline" className="shrink-0 gap-1.5 border-yellow-500/30 text-yellow-600 hover:bg-yellow-500/10">
                  <Crown className="size-3.5" />
                  Upgrade
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Custom Alerts</h2>
            {isPremium && <CreateCustomAlertWizard onCreated={fetchAlerts} />}
          </div>

          {!isPremium ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <AlertTriangle className="size-12 text-muted-foreground/30 mb-4" />
                <h3 className="font-semibold mb-1">Premium Feature</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Custom indicator alerts are available on Premium plans.
                </p>
                <Button variant="outline" className="gap-1.5">
                  <Crown className="size-4 text-yellow-500" />
                  Upgrade to Premium
                </Button>
              </CardContent>
            </Card>
          ) : customAlerts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <AlertTriangle className="size-12 text-muted-foreground/30 mb-4" />
                <h3 className="font-semibold mb-1">No Custom Alerts</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create your first indicator-based alert.
                </p>
                <CreateCustomAlertWizard onCreated={fetchAlerts} />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {customAlerts.map((alert) => (
                <CustomAlertRow
                  key={alert.id}
                  alert={alert}
                  onToggle={toggleCustomAlert}
                  onDelete={deleteCustomAlert}
                  actionLoading={actionLoading}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
