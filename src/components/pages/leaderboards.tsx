'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Trophy } from 'lucide-react';
import { api } from '@/lib/api';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface Trader {
  id: string;
  name: string | null;
  avatar: string | null;
  totalTrades: number;
  winRate: number;
  totalProfit: number;
  rank: number;
}

const PERIODS = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
] as const;

export function LeaderboardsPage() {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('month');

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    api
      .get<{ success: boolean; data: { traders: Trader[] } }>(`/leaderboards?period=${period}&limit=20`, { signal: ctrl.signal })
      .then((res) => setTraders(res?.data?.traders || []))
      .catch(() => { if (!ctrl.signal.aborted) setTraders([]); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [period]);

  const top3 = traders.slice(0, 3);
  const rest = traders.slice(3);

  return (
    <PageContainer maxWidth="4xl">
      <PageHeader
        icon={Trophy}
        title="Leaderboards"
        description="Ranked by win rate and realized profit."
        actions={
          <div className="flex rounded-lg border border-line bg-slate p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md transition-colors',
                  period === p.value ? 'bg-brass text-brass-ink font-medium' : 'text-mist hover:text-text'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mt-6 space-y-6">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl bg-slate" />
            ))}
          </div>
        ) : top3.length === 0 ? (
          <div className="rounded-xl border border-line bg-slate py-16 text-center text-mist">
            <Trophy className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No ranked traders yet for this period.</p>
          </div>
        ) : (
          <>
            {/* Podium — the one hero moment on this page. Rank 1 gets the
                elevated/glow treatment; 2nd and 3rd stay quiet and flat,
                so the boldness is spent in exactly one place. */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="grid gap-3 sm:grid-cols-3"
            >
              {top3.map((t, idx) => (
                <div
                  key={t.id}
                  className={cn(
                    'order-2 rounded-xl p-5 text-center',
                    idx === 0
                      ? 'order-1 sm:order-2 border border-brass/40 bg-gradient-to-b from-brass/[0.08] to-transparent shadow-[0_0_40px_-12px_rgba(214,163,68,0.35)] sm:-translate-y-3'
                      : idx === 1
                        ? 'order-2 sm:order-1 border border-line bg-slate'
                        : 'order-3 border border-line bg-slate'
                  )}
                >
                  <div className={cn('text-xs font-mono mb-3', idx === 0 ? 'text-brass' : 'text-mist')}>
                    RANK {t.rank}
                  </div>
                  <div
                    className={cn(
                      'mx-auto mb-3 flex items-center justify-center rounded-full font-display font-medium',
                      idx === 0 ? 'h-16 w-16 text-xl bg-brass/15 border border-brass/40 text-brass' : 'h-12 w-12 text-base bg-ink border border-line text-mist'
                    )}
                  >
                    {(t.name || 'A')[0]}
                  </div>
                  <div className="font-medium text-text truncate">{t.name || 'Anonymous'}</div>
                  <div className={cn('font-mono text-2xl mt-2', idx === 0 ? 'text-brass' : 'text-text')}>
                    {t.winRate}%
                  </div>
                  <div className="text-[11px] text-mist mt-0.5">win rate</div>
                  <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-line text-xs">
                    <div>
                      <div className="font-mono text-text">{t.totalTrades}</div>
                      <div className="text-mist-faint mt-0.5">trades</div>
                    </div>
                    <div>
                      <div className={cn('font-mono', t.totalProfit >= 0 ? 'text-mint' : 'text-ember')}>
                        {t.totalProfit >= 0 ? '+' : ''}
                        {t.totalProfit}%
                      </div>
                      <div className="text-mist-faint mt-0.5">profit</div>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>

            {/* Rest of the board — flat hairline rows, one simultaneous
                entrance rather than a staggered fade per row. */}
            {rest.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.15 }}
                className="rounded-xl border border-line overflow-hidden"
              >
                {rest.map((t, i) => (
                  <div
                    key={t.id}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3',
                      i !== rest.length - 1 && 'border-b border-line'
                    )}
                  >
                    <div className="w-7 text-center font-mono text-sm text-mist">{t.rank}</div>
                    <div className="h-8 w-8 shrink-0 rounded-full bg-ink border border-line flex items-center justify-center text-xs text-mist">
                      {(t.name || 'A')[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text truncate">{t.name || 'Anonymous'}</div>
                      <div className="text-xs text-mist-faint font-mono">{t.totalTrades} trades</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm text-text">{t.winRate}%</div>
                      <div className={cn('font-mono text-xs', t.totalProfit >= 0 ? 'text-mint' : 'text-ember')}>
                        {t.totalProfit >= 0 ? '+' : ''}
                        {t.totalProfit}%
                      </div>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}

export default LeaderboardsPage;