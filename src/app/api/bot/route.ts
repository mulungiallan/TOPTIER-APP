import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { BotInstanceManager } from '@/lib/services/bot-instance-manager'
import { summarizeConnection } from '@/lib/services/bot-profit-share'
import { botService } from '@/lib/services/bot-service'
import { classifyAccountTier } from '@/lib/account-tiers'
import { getEntitlements, BOT_PAYWALL_MESSAGE } from '@/lib/entitlements'

function parseSettings(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

function parsedSnapshot(instance: { lastSnapshot: string | null }): Record<string, unknown> | null {
  if (!instance.lastSnapshot) return null
  try {
    const snap = JSON.parse(instance.lastSnapshot)
    return snap && typeof snap === 'object' ? snap : null
  } catch {
    return null
  }
}

function fin(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

interface OpenPosition {
  symbol?: string
  direction?: string
  volume?: number | string
  profit?: number | string
}

/* Builds the small "live now" block shown on connection cards + detail view:
   equity/balance/open P/L/positions/overall stats straight from the bot's
   dashboard snapshot (posted by the webhook every scan cycle). */
function liveBlock(snapshot: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!snapshot) return null
  const positions = Array.isArray(snapshot.open_positions) ? (snapshot.open_positions as OpenPosition[]) : []
  const openPl = positions.reduce((sum, p) => sum + (fin(p.profit) ?? 0), 0)
  return {
    at: snapshot.timestamp ?? null,
    equity: fin(snapshot.equity),
    balance: fin(snapshot.balance),
    currency: snapshot.currency ?? null,
    openPositions: positions.map((p) => ({
      symbol: p.symbol ?? null,
      direction: p.direction ?? null,
      volume: fin(p.volume),
      profit: fin(p.profit) ?? 0,
    })),
    maxOpenPositions: fin(snapshot.max_open_positions),
    openRiskPct: fin(snapshot.open_risk_pct),
    portfolioRiskCeilingPct: fin(snapshot.portfolio_risk_ceiling_pct),
    openPl: Math.round(openPl * 100) / 100,
    overallStats: snapshot.overall_stats ?? null,
    approvedComboCount: fin(snapshot.approved_combo_count),
    totalComboCount: fin(snapshot.total_combo_count),
  }
}

// GET /api/bot — overview of the auto-trading bot for the current user:
// connections, live instances, realized P/L, owed profit share, totals.
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const entitlements = await getEntitlements(userId)
    if (!entitlements.bot) {
      // Overview still loads so the page can show the user's previous data
      // together with the buy/upgrade prompt.
      return successResponse({
        connections: [],
        totals: { totalRealizedPnl: 0, totalDue: 0, totalTrades: 0, runningInstances: 0, totalAccounts: 0 },
        serviceOnline: false,
        reconcile: { healed: 0, stoppedExpired: 0, skipped: 0, errors: 0 },
        access: { bot: false, paywall: BOT_PAYWALL_MESSAGE },
      })
    }

    const connections = await db.botConnection.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
      include: {
        instances: { orderBy: { updatedAt: 'desc' } },
        masterTrader: { select: { id: true, handle: true } },
        _count: { select: { trades: true } },
      },
    })

    let serviceOnline = false
    try {
      const health = await botService.health()
      serviceOnline = health?.status === 'ok'
    } catch {
      serviceOnline = false
    }

    // Keep-running reconciliation: restart instances that went down while the
    // subscription is live, stop instances whose subscription has ended.
    let reconcile
    try {
      reconcile = await BotInstanceManager.reconcileForUser(userId)
    } catch (error) {
      console.error('Bot reconcile error:', error)
      reconcile = { healed: 0, stoppedExpired: 0, skipped: 0, errors: 0 }
    }

    const enriched = connections.map((conn) => {
      const settings = parseSettings(conn.settings)
      const instance = conn.instances[0] ?? null
      const snap = instance ? parsedSnapshot(instance) : null
      const balance = snap ? fin(snap.balance ?? snap.equity) : null
      const equity = snap ? fin(snap.equity) : null
      return {
        ...conn,
        tradeCount: conn._count.trades,
        summary: summarizeConnection(conn),
        runningInstance: conn.instances.some((i) => i.status === 'running' || i.status === 'starting'),
        isCopyMaster: !!conn.masterTrader,
        copyMasterHandle: conn.masterTrader?.handle ?? null,
        accountBalance: balance,
        accountEquity: equity ?? balance,
        accountCurrency: typeof snap?.currency === 'string' ? snap.currency : null,
        accountTier: classifyAccountTier(balance, settings),
        live: liveBlock(snap),
      }
    })

    const totals = enriched.reduce(
      (acc, c) => {
        acc.totalRealizedPnl += c.realizedPnl || 0
        acc.totalDue += c.summary?.dueAmount ?? 0
        acc.totalTrades += c.tradeCount
        if (c.runningInstance) acc.runningInstances++
        return acc
      },
      { totalRealizedPnl: 0, totalDue: 0, totalTrades: 0, runningInstances: 0, totalAccounts: enriched.length }
    )

    return successResponse({ connections: enriched, totals, serviceOnline, reconcile, access: { bot: true, paywall: null } })
  } catch (error) {
    console.error('Bot overview error:', error)
    return errorResponse('Failed to load bot data', 500)
  }
}
