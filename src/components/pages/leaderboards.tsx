'use client'

import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Crown, Medal, TrendingUp, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface Trader {
  id: string
  name: string | null
  avatar: string | null
  totalTrades: number
  winRate: number
  totalProfit: number
  rank: number
}

const PERIODS = [
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' },
] as const

export function LeaderboardsPage() {
  const [traders, setTraders] = useState<Trader[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('month')

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    api.get<{ success: boolean; data: { traders: Trader[] } }>(`/leaderboards?period=${period}&limit=20`, { signal: ctrl.signal })
      .then((res) => { setTraders(res?.data?.traders || []) })
      .catch(() => { if (!ctrl.signal.aborted) setTraders([]) })
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [period])

  const top3 = traders.slice(0, 3)
  const rest = traders.slice(3)

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Trophy className="h-7 w-7 text-amber-500" />
          Leaderboards
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Top traders ranked by win rate and profit.</p>
      </motion.div>

      {/* Period selector */}
      <div className="flex gap-2 justify-center">
        {PERIODS.map((p) => (
          <Button
            key={p.value}
            variant={period === p.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPeriod(p.value)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Podium for top 3 */}
      {loading ? (
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : top3.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Trophy className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p>No ranked traders yet for this period.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {top3.map((t, idx) => {
              const podium = [
                { icon: Crown, color: 'text-amber-500', bg: 'from-amber-500/20 to-amber-500/5', label: '🥇 1st' },
                { icon: Medal, color: 'text-slate-400', bg: 'from-slate-400/20 to-slate-400/5', label: '🥈 2nd' },
                { icon: Medal, color: 'text-orange-700', bg: 'from-orange-700/20 to-orange-700/5', label: '🥉 3rd' },
              ][idx]
              const Icon = podium.icon
              return (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className={cn('order-2', idx === 0 && 'md:order-1 md:-translate-y-4', idx === 1 && 'md:order-2', idx === 2 && 'md:order-3')}
                >
                  <Card className={cn('overflow-hidden border-2', idx === 0 ? 'border-amber-500/40' : idx === 1 ? 'border-slate-400/40' : 'border-orange-700/40')}>
                    <div className={cn('bg-gradient-to-br p-6 text-center', podium.bg)}>
                      <Icon className={cn('h-10 w-10 mx-auto mb-2', podium.color)} />
                      <div className="text-sm font-semibold mb-2">{podium.label}</div>
                      <Avatar className="h-16 w-16 mx-auto mb-2">
                        <AvatarFallback className="text-lg">{(t.name || 'A')[0]}</AvatarFallback>
                      </Avatar>
                      <div className="font-bold truncate">{t.name || 'Anonymous'}</div>
                      <div className="text-2xl font-bold mt-1 tabular-nums text-emerald-500">{t.winRate}%</div>
                      <div className="text-xs text-muted-foreground mt-0.5">win rate</div>
                    </div>
                    <CardContent className="p-3 grid grid-cols-2 gap-2 text-center text-xs">
                      <div>
                        <div className="font-semibold">{t.totalTrades}</div>
                        <div className="text-muted-foreground">trades</div>
                      </div>
                      <div>
                        <div className={cn('font-semibold', t.totalProfit >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                          {t.totalProfit >= 0 ? '+' : ''}{t.totalProfit}%
                        </div>
                        <div className="text-muted-foreground">profit</div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </div>

          {/* Rest of leaderboard */}
          {rest.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rest of the Board</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {rest.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/40 transition">
                    <div className="w-8 text-center text-sm font-semibold text-muted-foreground">#{t.rank}</div>
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>{(t.name || 'A')[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{t.name || 'Anonymous'}</div>
                      <div className="text-xs text-muted-foreground">{t.totalTrades} trades</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-sm tabular-nums">{t.winRate}%</div>
                      <div className={cn('text-xs tabular-nums', t.totalProfit >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                        {t.totalProfit >= 0 ? '+' : ''}{t.totalProfit}%
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

export default LeaderboardsPage
