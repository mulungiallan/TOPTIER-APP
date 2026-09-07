'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Users, Clock, DollarSign, Loader2, Zap, CalendarDays, Video, Mic, Gift, Radio, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Competition {
  id: string
  name: string
  description: string | null
  type: string
  startDate: string
  endDate: string
  entryFee: number
  prizePool: number
  status: string
  _count?: { entries: number }
  creator?: { name: string | null }
}

interface TradingEvent {
  id: string
  slug: string
  title: string
  description: string | null
  category: string
  host: string | null
  startAt: string
  endAt: string
  reward: string | null
  capacity: number | null
  registered: number
  status: 'upcoming' | 'live' | 'ended'
}

const STATUS_COLORS: Record<string, string> = {
  upcoming: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  active: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  ended: 'bg-slate-500/10 text-slate-600 border-slate-500/30',
  cancelled: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
  live: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
}

const EVENT_CATEGORIES: Record<string, { label: string; icon: React.ReactNode; styles: string }> = {
  webinar: { label: 'Webinar', icon: <Video className="h-3.5 w-3.5" />, styles: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  live_session: { label: 'Live Session', icon: <Radio className="h-3.5 w-3.5" />, styles: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
  ama: { label: 'AMA', icon: <Mic className="h-3.5 w-3.5" />, styles: 'bg-violet-500/10 text-violet-600 border-violet-500/30' },
  challenge: { label: 'Challenge', icon: <Zap className="h-3.5 w-3.5" />, styles: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  workshop: { label: 'Workshop', icon: <Sparkles className="h-3.5 w-3.5" />, styles: 'bg-sky-500/10 text-sky-600 border-sky-500/30' },
}

function formatEventTime(startAt: string, status: string) {
  const d = new Date(startAt)
  if (status === 'live') return 'Happening now'
  if (status === 'ended') return d.toLocaleDateString()
  const diff = d.getTime() - Date.now()
  if (diff < 24 * 3600 * 1000 && diff > 0) {
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    return `Starts in ${h}h ${m}m`
  }
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export function CompetitionsPage() {
  const [tab, setTab] = useState<'tournaments' | 'events'>('tournaments')
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [events, setEvents] = useState<TradingEvent[]>([])
  const [loadingCompetitions, setLoadingCompetitions] = useState(true)
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [joining, setJoining] = useState<string | null>(null)
  const [registering, setRegistering] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'upcoming' | 'ended'>('all')
  const [eventFilter, setEventFilter] = useState<'all' | 'live' | 'upcoming' | 'ended'>('all')

  const fetchCompetitions = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoadingCompetitions(true)
      const query = filter === 'all' ? '' : `?status=${filter}`
      const res = await api.get<{ success: boolean; data: { competitions: Competition[] } }>(`/competitions${query}`, { signal })
      setCompetitions(res?.data?.competitions || [])
    } catch {
      if (!signal?.aborted) setCompetitions([])
    } finally {
      if (!signal?.aborted) setLoadingCompetitions(false)
    }
  }, [filter])

  const fetchEvents = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoadingEvents(true)
      const query = eventFilter === 'all' ? '' : `?status=${eventFilter}`
      const res = await api.get<{ success: boolean; data: { events: TradingEvent[] } }>(`/events${query}`, { signal })
      setEvents(res?.data?.events || [])
    } catch {
      if (!signal?.aborted) setEvents([])
    } finally {
      if (!signal?.aborted) setLoadingEvents(false)
    }
  }, [eventFilter])

  useEffect(() => {
    const ctrl = new AbortController()
    fetchCompetitions(ctrl.signal)
    fetchEvents(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchCompetitions, fetchEvents])

  const handleJoin = async (id: string) => {
    setJoining(id)
    try {
      await api.post('/competitions/join', { competitionId: id })
      toast.success('Joined competition!')
      fetchCompetitions()
    } catch {
      toast.error('Failed to join')
    } finally {
      setJoining(null)
    }
  }

  const handleRegister = async (eventId: string) => {
    setRegistering(eventId)
    try {
      const res = await api.post<{ success: boolean; data: { registered: number } }>('/events/register', { eventId })
      setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, registered: res?.data?.registered ?? e.registered } : e)))
      toast.success('Registered for event!')
    } catch {
      toast.error('Failed to register')
    } finally {
      setRegistering(null)
    }
  }

  return (
    <div className="space-y-5 p-3 md:p-4 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-7 w-7 text-amber-500" />
            Competitions & Events
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Compete in tournaments and trade alongside live sessions.</p>
        </div>
      </motion.div>

      <div className="flex gap-2 flex-wrap">
        <Button variant={tab === 'tournaments' ? 'default' : 'outline'} size="sm" onClick={() => setTab('tournaments')}>
          <Trophy className="h-4 w-4 mr-1.5" /> Tournaments
        </Button>
        <Button variant={tab === 'events' ? 'default' : 'outline'} size="sm" onClick={() => setTab('events')}>
          <CalendarDays className="h-4 w-4 mr-1.5" /> Events
        </Button>
      </div>

      {tab === 'tournaments' ? (
        <>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'active', 'upcoming', 'ended'] as const).map((f) => (
              <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => setFilter(f)} className="capitalize">
                {f}
              </Button>
            ))}
          </div>

          {loadingCompetitions ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}
            </div>
          ) : competitions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Trophy className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p>No competitions match this filter.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {competitions.map((c, idx) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.05, 0.4) }}
                >
                  <Card className="h-full flex flex-col">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base flex-1">{c.name}</CardTitle>
                        <Badge className={cn('text-[10px] capitalize border', STATUS_COLORS[c.status] || '')}>
                          {c.status}
                        </Badge>
                      </div>
                      <CardDescription className="line-clamp-2">{c.description || `Type: ${c.type}`}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Start</span>
                        <span className="font-medium">{new Date(c.startDate).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> End</span>
                        <span className="font-medium">{new Date(c.endDate).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" /> Entry Fee</span>
                        <span className="font-medium">{c.entryFee > 0 ? `$${c.entryFee}` : 'Free'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1"><Trophy className="h-3 w-3" /> Prize Pool</span>
                        <span className="font-semibold text-amber-600">${c.prizePool}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Participants</span>
                        <span className="font-medium">{c._count?.entries || 0}</span>
                      </div>
                    </CardContent>
                    <CardFooter className="pt-2">
                      <Button
                        size="sm"
                        className="w-full"
                        variant={c.status === 'active' ? 'default' : 'outline'}
                        disabled={(c.status !== 'active' && c.status !== 'upcoming') || joining === c.id}
                        onClick={() => handleJoin(c.id)}
                      >
                        {joining === c.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Zap className="h-4 w-4 mr-1.5" />}
                        {c.status === 'active' ? 'Join Now' : c.status === 'upcoming' ? 'Register' : 'Ended'}
                      </Button>
                    </CardFooter>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'live', 'upcoming', 'ended'] as const).map((f) => (
              <Button key={f} variant={eventFilter === f ? 'default' : 'outline'} size="sm" onClick={() => setEventFilter(f)} className="capitalize">
                {f}
              </Button>
            ))}
          </div>

          {loadingEvents ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
            </div>
          ) : events.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p>No events match this filter.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {events.map((e, idx) => {
                const cat = EVENT_CATEGORIES[e.category] || EVENT_CATEGORIES.live_session
                const fill = e.capacity ? Math.min(100, Math.round((e.registered / e.capacity) * 100)) : 0
                const soldOut = e.capacity ? e.registered >= e.capacity : false
                return (
                  <motion.div
                    key={e.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx * 0.05, 0.4) }}
                  >
                    <Card className="h-full flex flex-col">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-base flex-1">{e.title}</CardTitle>
                          <div className="flex flex-col items-end gap-1">
                            <Badge className={cn('text-[10px] capitalize border', STATUS_COLORS[e.status] || '')}>
                              {e.status === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />}
                              {e.status}
                            </Badge>
                            <Badge className={cn('text-[10px] border', cat.styles)}>{cat.icon} {cat.label}</Badge>
                          </div>
                        </div>
                        <CardDescription className="line-clamp-2">{e.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> When</span>
                          <span className={cn('font-medium', e.status === 'live' && 'text-emerald-600')}>{formatEventTime(e.startAt, e.status)}</span>
                        </div>
                        {e.host && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Host</span>
                            <span className="font-medium">{e.host}</span>
                          </div>
                        )}
                        {e.reward && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground flex items-center gap-1"><Gift className="h-3 w-3" /> Reward</span>
                            <span className="font-medium text-amber-600">{e.reward}</span>
                          </div>
                        )}
                        {e.capacity ? (
                          <div className="pt-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Spots</span>
                              <span className="font-medium">{e.registered}/{e.capacity}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn('h-full rounded-full', e.status === 'ended' ? 'bg-slate-400' : 'bg-emerald-500')}
                                style={{ width: `${Math.max(fill, 4)}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Registered</span>
                            <span className="font-medium">{e.registered}</span>
                          </div>
                        )}
                      </CardContent>
                      <CardFooter className="pt-2">
                        <Button
                          size="sm"
                          className="w-full"
                          variant={e.status === 'live' ? 'default' : 'outline'}
                          disabled={e.status === 'ended' || soldOut || registering === e.id}
                          onClick={() => handleRegister(e.id)}
                        >
                          {registering === e.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Zap className="h-4 w-4 mr-1.5" />}
                          {e.status === 'live' ? 'Join Live' : e.status === 'ended' ? 'Ended' : soldOut ? 'Waitlist' : 'Register'}
                        </Button>
                      </CardFooter>
                    </Card>
                  </motion.div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default CompetitionsPage