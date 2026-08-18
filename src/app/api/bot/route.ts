import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { summarizeConnection } from '@/lib/services/bot-profit-share'
import { botService, BotServiceOfflineError } from '@/lib/services/bot-service'
import { classifyAccountTier } from '@/lib/account-tiers'

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

    return successResponse({ connections: enriched, totals, serviceOnline })
  } catch (error) {
    console.error('Bot overview error:', error)
    return errorResponse('Failed to load bot data', 500)
  }
}
