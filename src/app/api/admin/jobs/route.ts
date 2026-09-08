// src/app/api/admin/jobs/route.ts
// Background-job health for the System tab. Read-only; jobs are run via
// `run_job` admin-action (so runs are audit-logged with duration).
// GET /api/admin/jobs

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse } from '@/lib/auth'
import { requirePermission } from '@/lib/admin-permissions'

export async function GET(request: NextRequest) {
  const { error } = await requirePermission(request, 'panel.access')
  if (error) return error

  const now = Date.now()

  const [recentRuns, activeSignals, staleSignals, botInstances, activeSessions, openTickets, pendingPayouts] = await Promise.all([
    db.adminAuditLog.findMany({
      where: { action: 'RUN_JOB' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, createdAt: true, details: true },
    }),
    db.signal.count({ where: { status: 'active', expiryDate: { gt: new Date() } } }),
    db.signal.count({ where: { status: 'active', expiryDate: { lt: now as any } } }),
    db.botInstance.findMany({
      where: { status: { in: ['running', 'starting', 'error'] } },
      select: { id: true, status: true, lastHeartbeatAt: true, lastError: true },
      take: 100,
    }),
    db.usageSession.count({ where: { endedAt: null } }),
    db.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
    db.payoutRequest.count({ where: { status: 'pending' } }),
  ])

  const jobs = [
    {
      name: 'signals',
      description: 'Confluence + AMD signal generator (5 min cycle)',
      lastRun: recentRuns.find((r) => (r.details || '').includes('"job":"signals"'))?.createdAt ?? null,
      health: activeSignals > 0 ? 'ok' : 'idle',
      detail: `${activeSignals} active · ${staleSignals} stale`,
    },
    {
      name: 'expire',
      description: 'Expire signals past their expiry date',
      lastRun: recentRuns.find((r) => (r.details || '').includes('"job":"expire"'))?.createdAt ?? null,
      health: staleSignals === 0 ? 'ok' : 'attention',
      detail: staleSignals > 0 ? `${staleSignals} stale active signals need expiry` : 'nothing stale',
    },
    {
      name: 'bots',
      description: 'MT5/MT4 autotrader heartbeat + instance health',
      lastRun: null,
      health: botInstances.filter((b) => b.status === 'error').length ? 'error' : botInstances.length ? 'ok' : 'idle',
      detail: `${botInstances.length} instance(s)` + (botInstances.some((b) => b.status === 'error') ? ' with errors' : ''),
    },
    {
      name: 'prune_notifications',
      description: 'Delete read notifications older than 90 days',
      lastRun: recentRuns.find((r) => (r.details || '').includes('"job":"prune_notifications"'))?.createdAt ?? null,
      health: 'idle',
      detail: 'on-demand',
    },
    {
      name: 'sessions',
      description: 'Active usage sessions (mission-control live count)',
      lastRun: null,
      health: activeSessions > 0 ? 'ok' : 'idle',
      detail: `${activeSessions} live`,
    },
    {
      name: 'payments',
      description: 'Pending payout + open ticket queues',
      lastRun: null,
      health: openTickets > 0 || pendingPayouts > 0 ? 'attention' : 'ok',
      detail: `${pendingPayouts} pending payouts · ${openTickets} open tickets`,
    },
  ]

  return successResponse({ jobs, generatedAt: new Date().toISOString(), recentRuns })
}