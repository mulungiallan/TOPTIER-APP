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

function snapshotBalance(instance: { lastSnapshot: string | null }): number | null {
  if (!instance.lastSnapshot) return null
  try {
    const snap = JSON.parse(instance.lastSnapshot)
    const balance = Number(snap?.balance ?? snap?.equity)
    return Number.isFinite(balance) ? balance : null
  } catch {
    return null
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
      const balance = instance ? snapshotBalance(instance) : null
      return {
        ...conn,
        tradeCount: conn._count.trades,
        summary: summarizeConnection(conn),
        runningInstance: conn.instances.some((i) => i.status === 'running' || i.status === 'starting'),
        isCopyMaster: !!conn.masterTrader,
        copyMasterHandle: conn.masterTrader?.handle ?? null,
        accountBalance: balance,
        accountEquity: balance,
        accountCurrency: instance
          ? (() => { try { return JSON.parse(instance.lastSnapshot || '{}').currency ?? null } catch { return null } })()
          : null,
        accountTier: classifyAccountTier(balance, settings),
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
