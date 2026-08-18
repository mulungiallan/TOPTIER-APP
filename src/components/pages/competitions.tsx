'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Plus, Users, Clock, DollarSign, Loader2, Zap } from 'lucide-react'
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

const STATUS_COLORS: Record<string, string> = {
  upcoming: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  active: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  ended: 'bg-slate-500/10 text-slate-600 border-slate-500/30',
  cancelled: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
}

export function CompetitionsPage() {
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'upcoming' | 'ended'>('all')

  const fetchCompetitions = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      const query = filter === 'all' ? '' : `?status=${filter}`
      const res = await api.get<{ success: boolean; data: { competitions: Competition[] } }>(`/competitions${query}`, { signal })
      setCompetitions(res?.data?.competitions || [])
    } catch {
      if (!signal?.aborted) setCompetitions([])
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    const ctrl = new AbortController()
    fetchCompetitions(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchCompetitions])

  const handleJoin = async (id: string) => {
    setJoining(id)
    try {
      await api.post('/competitions/join', { competitionId: id })
      toast.success('Joined competition!')
      fetchCompetitions()
    } catch (err) {
      toast.error('Failed to join')
    } finally {
      setJoining(null)
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-7 w-7 text-amber-500" />
            Trading Competitions
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Compete with traders worldwide and win prizes.</p>
        </div>
      </motion.div>

      <div className="flex gap-2 flex-wrap">
        {(['all', 'active', 'upcoming', 'ended'] as const).map((f) => (
          <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => setFilter(f)} className="capitalize">
            {f}
          </Button>
        ))}
      </div>

      {loading ? (
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
                    disabled={c.status !== 'active' && c.status !== 'upcoming' || joining === c.id}
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
    </div>
  )
}

export default CompetitionsPage
