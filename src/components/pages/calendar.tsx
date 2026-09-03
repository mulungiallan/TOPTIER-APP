'use client'

import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Bell,
  Crown,
  Filter,
  ChevronDown,
  ChevronUp,
  Globe,
  Info,
  Timer,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Types ─────────────────────────────────────────────────────────────────────

type ImpactLevel = 'high' | 'medium' | 'low'

interface EconomicEvent {
  id: string
  date: string
  time: string
  timezone: string
  currency: string
  name: string
  impact: ImpactLevel
  previous: string | null
  forecast: string | null
  actual: string | null
  description: string
  whyItMatters: string
  historicalData: { date: string; actual: string; forecast: string }[]
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD']

const eventTypes = ['All', 'Central Bank', 'Employment', 'Inflation', 'GDP', 'Trade Balance', 'Retail', 'Housing', 'Manufacturing', 'Consumer Confidence']

// ─── Helper Functions ──────────────────────────────────────────────────────────

function getWeekDates(offset: number): Date[] {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek

  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset + offset * 7)
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    days.push(d)
  }
  return days
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function formatDateHeader(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function formatWeekRange(dates: Date[]): string {
  if (dates.length === 0) return ''
  const start = dates[0]
  const end = dates[dates.length - 1]
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${startStr} - ${endStr}`
}

function getCountdown(targetDate: string, targetTime: string): string | null {
  const now = new Date()
  const [hours, minutes] = targetTime.split(':').map(Number)
  const target = new Date(targetDate)
  target.setUTCHours(hours, minutes, 0, 0)
  const diff = target.getTime() - now.getTime()
  if (diff <= 0) return null
  const d = Math.floor(diff / (1000 * 60 * 60 * 24))
  const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

function isActualBetterThanForecast(actual: string | null, forecast: string | null, currency: string): boolean | null {
  if (!actual || !forecast) return null
  const actualNum = parseFloat(actual.replace(/[^0-9.-]/g, ''))
  const forecastNum = parseFloat(forecast.replace(/[^0-9.-]/g, ''))
  if (isNaN(actualNum) || isNaN(forecastNum)) return null
  // For most currencies, higher is better; for unemployment-like metrics, lower is better
  return actualNum > forecastNum
}

// Map API data to UI types
function mapApiEventToUi(apiEvent: any): EconomicEvent {
  const eventDate = new Date(apiEvent.eventDate)
  const dateStr = formatDate(eventDate)
  const timeStr = eventDate.toISOString().split('T')[1]?.substring(0, 5) || '00:00'

  return {
    id: apiEvent.id,
    date: dateStr,
    time: timeStr,
    timezone: 'UTC',
    currency: apiEvent.currency,
    name: apiEvent.eventName,
    impact: (apiEvent.impactLevel || 'medium') as ImpactLevel,
    previous: apiEvent.previousValue || null,
    forecast: apiEvent.forecastValue || null,
    actual: apiEvent.actualValue || null,
    description: apiEvent.description || '',
    whyItMatters: '', // Not in API schema
    historicalData: [], // Not in API schema
  }
}

// ─── Loading Skeleton ──────────────────────────────────────────────────────────

function CalendarSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            <div className="h-8 w-8 animate-pulse rounded bg-muted" />
            <div className="h-8 w-8 animate-pulse rounded bg-muted" />
            <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-7 w-20 animate-pulse rounded-full bg-muted" />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-7 w-12 animate-pulse rounded-full bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          {Array.from({ length: 2 }).map((_, j) => (
            <div key={j} className="flex items-center gap-4 rounded-lg border p-4">
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              <div className="h-6 w-12 animate-pulse rounded bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 animate-pulse rounded bg-muted" />
              </div>
              <div className="flex gap-3">
                <div className="h-6 w-10 animate-pulse rounded bg-muted" />
                <div className="h-6 w-10 animate-pulse rounded bg-muted" />
                <div className="h-6 w-10 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Event Row Component ───────────────────────────────────────────────────────

function EventRow({
  event,
  isPremium,
}: {
  event: EconomicEvent
  isPremium: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const countdown = getCountdown(event.date, event.time)
  const isBetter = isActualBetterThanForecast(event.actual, event.forecast, event.currency)

  const impactConfig = {
    high: { dot: 'bg-red-500', label: 'High', className: 'bg-red-500/10 text-red-600 border-red-500/20' },
    medium: { dot: 'bg-yellow-500', label: 'Medium', className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
    low: { dot: 'bg-green-500', label: 'Low', className: 'bg-green-500/10 text-green-600 border-green-500/20' },
  }
  const impact = impactConfig[event.impact]

  const handleSetReminder = (minutes: string) => {
    const mins = parseInt(minutes)
    const eventTime = new Date(`${event.date}T${event.time}Z`).getTime()
    const reminderTime = eventTime - mins * 60_000
    const delay = reminderTime - Date.now()

    if (delay <= 0) {
      toast.error('This event has already passed')
      return
    }

    // Store reminder in localStorage so it persists across sessions
    try {
      const stored = JSON.parse(localStorage.getItem('toptier-reminders') || '[]')
      stored.push({ eventId: event.id, eventName: event.name, reminderTime, minutesBefore: mins })
      localStorage.setItem('toptier-reminders', JSON.stringify(stored))
    } catch { /* localStorage may be full */ }

    // Schedule browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      setTimeout(() => {
        new Notification(`TOPTIER: ${event.name}`, {
          body: `Starting in ${mins} minute${mins !== 1 ? 's' : ''}`,
        })
      }, delay)
    }

    toast.success(`Reminder set: ${mins} min before ${event.name}`)
  }

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className={cn(
        'rounded-lg border p-3 sm:p-4 transition-colors',
        event.impact === 'high' && 'border-red-500/10',
        expanded && 'border-primary/20'
      )}>
        {/* Main Row */}
        <CollapsibleTrigger asChild>
          <button className="w-full text-left">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              {/* Time + Impact */}
              <div className="flex items-center gap-2 sm:w-24 shrink-0">
                <span className={cn('size-2 rounded-full shrink-0', impact.dot)} />
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3" />
                  <span>{event.time}</span>
                  <span className="text-[10px]">{event.timezone}</span>
                </div>
              </div>

              {/* Currency */}
              <Badge variant="outline" className="w-14 justify-center shrink-0 text-xs font-mono">
                {event.currency}
              </Badge>

              {/* Event Name */}
              <div className="flex-1 min-w-0">
                <span className={cn('text-sm font-medium', event.impact === 'high' && 'text-foreground')}>
                  {event.name}
                </span>
              </div>

              {/* Values */}
              <div className="flex items-center gap-3 sm:gap-4 text-xs shrink-0">
                <div className="text-center">
                  <p className="text-muted-foreground text-[10px]">Prev</p>
                  <p className="font-medium">{event.previous || '-'}</p>
                </div>
                <div className="text-center">
                  <p className="text-muted-foreground text-[10px]">Fcst</p>
                  <p className="font-medium">{event.forecast || '-'}</p>
                </div>
                <div className="text-center">
                  <p className="text-muted-foreground text-[10px]">Actual</p>
                  {event.actual ? (
                    <p className={cn(
                      'font-semibold',
                      isBetter === true && 'text-emerald-600',
                      isBetter === false && 'text-red-600',
                      isBetter === null && 'text-foreground'
                    )}>
                      {event.actual}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">-</p>
                  )}
                </div>

                {/* Countdown */}
                {countdown && (
                  <div className="hidden sm:flex items-center gap-1 text-xs text-primary">
                    <Timer className="size-3" />
                    <span>{countdown}</span>
                  </div>
                )}

                {/* Expand icon */}
                <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
              </div>
            </div>

            {/* Mobile countdown */}
            {countdown && (
              <div className="flex items-center gap-1 text-xs text-primary mt-2 sm:hidden">
                <Timer className="size-3" />
                <span>{countdown}</span>
              </div>
            )}
          </button>
        </CollapsibleTrigger>

        {/* Expanded Detail */}
        <CollapsibleContent>
          <div className="mt-4 space-y-4 pt-4 border-t">
            {/* Description */}
            {event.description && (
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-1">
                  <Info className="size-3.5 text-primary" />
                  Description
                </h4>
                <p className="text-sm text-muted-foreground">{event.description}</p>
              </div>
            )}

            {/* Why It Matters */}
            {event.whyItMatters && (
              <div>
                <h4 className="text-sm font-semibold mb-1">Why It Matters</h4>
                <p className="text-sm text-muted-foreground">{event.whyItMatters}</p>
              </div>
            )}

            {/* Historical Data */}
            {event.historicalData.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Historical Data</h4>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Forecast</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Actual</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {event.historicalData.map((h, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5">{h.date}</td>
                          <td className="px-3 py-1.5 text-right">{h.forecast}</td>
                          <td className="px-3 py-1.5 text-right font-medium">{h.actual}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Set Reminder (Premium) */}
            <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
              <div className="flex items-center gap-2">
                <Bell className="size-4 text-muted-foreground" />
                <span className="text-sm">Set Reminder</span>
              </div>
              {isPremium ? (
                <div className="flex gap-1">
                  {['5m', '15m', '30m', '1h'].map((t) => (
                    <Button key={t} variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => handleSetReminder(t)}>
                      {t}
                    </Button>
                  ))}
                </div>
              ) : (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Crown className="size-3 text-yellow-500" />
                  Premium
                </Badge>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

// ─── Main Calendar Page ────────────────────────────────────────────────────────

export function CalendarPage() {
  const user = useStore((s) => s.user)
  const isPremium = user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'pro'
  const [weekOffset, setWeekOffset] = useState(0)
  const [impactFilter, setImpactFilter] = useState<ImpactLevel[]>(['high', 'medium', 'low'])
  const [currencyFilter, setCurrencyFilter] = useState<string[]>([])
  const [eventTypeFilter, setEventTypeFilter] = useState('All')
  const [events, setEvents] = useState<EconomicEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset])
  const weekRangeStr = formatWeekRange(weekDates)

  // Fetch events from API
  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const startDate = formatDate(weekDates[0])
      const endDate = formatDate(weekDates[weekDates.length - 1])

      // Build query params
      const params = new URLSearchParams()
      params.set('startDate', startDate)
      params.set('endDate', endDate)

      // Add impact filter if not all selected
      if (impactFilter.length < 3 && impactFilter.length > 0) {
        // If multiple impacts, we'll filter client-side
        // API only supports single impact param
      }

      // Add currency filter
      if (currencyFilter.length === 1) {
        params.set('currency', currencyFilter[0])
      }

      const result = await api.get(`/calendar?${params.toString()}`)
      const apiEvents = (result.data as any[]) || []

      // Map API events to UI type
      let mapped: EconomicEvent[] = apiEvents.map(mapApiEventToUi)

      // Client-side filtering for multi-value filters
      if (impactFilter.length < 3) {
        mapped = mapped.filter((e) => impactFilter.includes(e.impact))
      }
      if (currencyFilter.length > 1) {
        mapped = mapped.filter((e) => currencyFilter.includes(e.currency))
      }

      setEvents(mapped)
    } catch (err: any) {
      setError(err.message || 'Failed to load calendar events')
    } finally {
      setLoading(false)
    }
  }, [weekDates, impactFilter, currencyFilter])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  const toggleImpact = (level: ImpactLevel) => {
    setImpactFilter((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    )
  }

  const toggleCurrency = (cur: string) => {
    setCurrencyFilter((prev) =>
      prev.includes(cur) ? prev.filter((c) => c !== cur) : [...prev, cur]
    )
  }

  const filteredEvents = events.filter((event) => {
    // Already filtered by impact and currency in fetch
    return true
  })

  const groupedEvents = useMemo(() => {
    const groups: Record<string, EconomicEvent[]> = {}
    filteredEvents.forEach((event) => {
      if (!groups[event.date]) groups[event.date] = []
      groups[event.date].push(event)
    })
    return groups
  }, [filteredEvents])

  // Loading state
  if (loading && events.length === 0) {
    return (
      <div className="p-3 sm:p-4 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="h-8 w-48 animate-pulse rounded bg-muted" />
            <div className="h-4 w-56 animate-pulse rounded bg-muted mt-2" />
          </div>
        </div>
        <CalendarSkeleton />
      </div>
    )
  }

  // Error state
  if (error && events.length === 0) {
    return (
      <div className="p-3 sm:p-4 space-y-5">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarIcon className="size-6 text-primary" />
            Economic Calendar
          </h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="size-12 text-destructive/50 mb-4" />
            <h3 className="font-semibold mb-1">Failed to Load Calendar</h3>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchEvents} className="gap-1.5">
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarIcon className="size-6 text-primary" />
            Economic Calendar
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Stay ahead of market-moving events
          </p>
        </div>
      </div>

      {/* Access Level Banner for Free Users */}
      {!isPremium && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="flex items-center gap-3 p-4">
            <Crown className="size-5 text-yellow-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">Limited Calendar Access</p>
              <p className="text-xs text-muted-foreground">
                Upgrade to Premium for 30-day calendar, custom reminders, and event details.
              </p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5 border-yellow-500/30 text-yellow-600 hover:bg-yellow-500/10">
              <Crown className="size-3.5" />
              Upgrade
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Date Navigation */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeekOffset(0)}
                className={cn(weekOffset === 0 && 'bg-primary/10 border-primary/30')}
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setWeekOffset((w) => w - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setWeekOffset((w) => w + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2 font-semibold text-sm">
              <CalendarIcon className="size-4 text-primary" />
              {weekRangeStr}
            </div>

            <div className="flex items-center gap-1 sm:ml-auto">
              <Button
                variant={weekOffset === 0 ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setWeekOffset(0)}
                className="text-xs h-7"
              >
                This Week
              </Button>
              <Button
                variant={weekOffset === 1 ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setWeekOffset(1)}
                className="text-xs h-7"
              >
                Next Week
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          {/* Impact Filter */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium shrink-0">
              <Filter className="size-3.5" />
              Impact:
            </div>
            {([
              { level: 'high' as ImpactLevel, dot: 'bg-red-500', label: 'High' },
              { level: 'medium' as ImpactLevel, dot: 'bg-yellow-500', label: 'Medium' },
              { level: 'low' as ImpactLevel, dot: 'bg-green-500', label: 'Low' },
            ]).map(({ level, dot, label }) => (
              <button
                key={level}
                onClick={() => toggleImpact(level)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  impactFilter.includes(level)
                    ? 'border-primary/30 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground opacity-50'
                )}
              >
                <span className={cn('size-2 rounded-full', dot)} />
                {label}
              </button>
            ))}
          </div>

          {/* Currency Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium shrink-0">Currency:</span>
            {currencies.map((cur) => (
              <button
                key={cur}
                onClick={() => toggleCurrency(cur)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-mono font-medium transition-colors',
                  currencyFilter.includes(cur)
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/20'
                )}
              >
                {cur}
              </button>
            ))}
          </div>

          {/* Event Type Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium shrink-0">Type:</span>
            <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
              <SelectTrigger className="h-7 text-xs w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {eventTypes.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Loading overlay when refetching */}
      {loading && events.length > 0 && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="size-3 animate-spin" />
          <span>Updating events...</span>
        </div>
      )}

      {/* Calendar View */}
      <div className="space-y-6">
        {Object.keys(groupedEvents).length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <CalendarIcon className="size-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-semibold mb-1">No Events Found</h3>
              <p className="text-sm text-muted-foreground">
                Try adjusting your filters or navigate to a different week.
              </p>
            </CardContent>
          </Card>
        ) : (
          Object.entries(groupedEvents).map(([date, events]) => {
            const dateObj = new Date(date + 'T12:00:00')
            const isToday = formatDate(new Date()) === date
            return (
              <motion.div
                key={date}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                {/* Date Header */}
                <div className="flex items-center gap-3">
                  <h3 className={cn(
                    'text-sm font-semibold',
                    isToday && 'text-primary'
                  )}>
                    {formatDateHeader(dateObj)}
                  </h3>
                  {isToday && (
                    <Badge className="text-[10px] px-1.5 py-0">Today</Badge>
                  )}
                  <Separator className="flex-1" />
                  <span className="text-xs text-muted-foreground">
                    {events.length} event{events.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Events */}
                <div className="space-y-2">
                  {events.map((event) => (
                    <EventRow key={event.id} event={event} isPremium={isPremium} />
                  ))}
                </div>
              </motion.div>
            )
          })
        )}
      </div>
    </div>
  )
}
