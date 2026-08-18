// src/lib/services/alert-monitor.ts
// Server-side price-alert monitor.
//
// Polls live prices for all active (untriggered) price alerts and, when an
// alert's condition is met, marks it triggered, delivers a notification
// (in-app + push + email, per user prefs), and emits the real-time
// `alert:triggered` event to that user's socket room.
//
// Before this existed, alerts only fired client-side (i.e. only when the user
// had the alerts page open) — now they fire automatically in the background.

import type { Server as SocketServer } from 'socket.io'
import { db } from '@/lib/db'
import { marketDataService } from '@/lib/services/market-data'
import { notifyUser } from '@/lib/services/notifications'

const CHECK_INTERVAL_MS = 60_000
const FIRST_CHECK_DELAY_MS = 5_000

let monitorTimer: NodeJS.Timeout | null = null

// Baseline prices per asset so `crosses` alerts can detect a sign flip.
const lastPriceByAsset = new Map<string, number>()
const MAX_PRICE_ENTRIES = 2_000

export interface AlertCheckResult {
  checked: number
  triggered: number
}

/**
 * Run one pass over active price alerts. Returns counts of alerts checked and
 * triggered. Safe to call anywhere (route, cron, dev server).
 */
export async function runAlertCheck(io?: SocketServer | null): Promise<AlertCheckResult> {
  const alerts = await db.priceAlert.findMany({
    where: { isActive: true, isTriggered: false },
    select: { id: true, userId: true, asset: true, alertType: true, targetPrice: true },
  })

  if (alerts.length === 0) return { checked: 0, triggered: 0 }

  const assets = [...new Set(alerts.map(a => a.asset))]
  const pricesMap = await marketDataService.getMultiplePrices(assets)

  let triggered = 0

  for (const alert of alerts) {
    const current = pricesMap.get(alert.asset)?.price
    if (current == null) continue

    const previous = lastPriceByAsset.get(alert.asset)
    let hit = false

    if (alert.alertType === 'above') {
      hit = current >= alert.targetPrice
    } else if (alert.alertType === 'below') {
      hit = current <= alert.targetPrice
    } else if (alert.alertType === 'crosses' && previous != null) {
      hit =
        (current > alert.targetPrice && previous <= alert.targetPrice) ||
        (current < alert.targetPrice && previous >= alert.targetPrice)
    }

    // Record baseline (established on the first observation; `crosses` needs it).
    lastPriceByAsset.set(alert.asset, current)
    if (lastPriceByAsset.size > MAX_PRICE_ENTRIES) {
      const keys = [...lastPriceByAsset.keys()]
      keys.slice(0, Math.floor(keys.length / 2)).forEach(k => lastPriceByAsset.delete(k))
    }
    if (!hit) continue

    // Atomic trigger: use updateMany with isTriggered:false condition to prevent double-trigger
    const updateResult = await db.priceAlert.updateMany({
      where: { id: alert.id, isTriggered: false },
      data: { isTriggered: true, triggeredAt: new Date() },
    })
    if (updateResult.count === 0) continue // Another process already triggered it
    triggered++

    // In-app + push + email (per user prefs). Type maps to the 'price-alerts'
    // preference which has email enabled by default.
    try {
      await notifyUser(alert.userId, {
        type: 'price_alert',
        title: `Price Alert: ${alert.asset}`,
        message: `${alert.asset} reached ${alert.alertType} ${alert.targetPrice} (current: ${current})`,
        actionUrl: '/alerts',
      })
    } catch (err) {
      console.error(`[AlertMonitor] Notification failed for alert ${alert.id}:`, err)
    }

    // Real-time event to the user's open socket(s).
    try {
      io?.to(`user:${alert.userId}`).emit('alert:triggered', {
        alertId: alert.id,
        userId: alert.userId,
        asset: alert.asset,
        price: current,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      console.error(`[AlertMonitor] Socket emit failed for alert ${alert.id}:`, err)
    }
  }

  return { checked: alerts.length, triggered }
}

/**
 * Start the background monitor. Idempotent. Started automatically by the
 * socket server (dev custom server / standalone production server).
 */
export function startAlertMonitor(io?: SocketServer | null): void {
  if (monitorTimer) return

  const tick = () => {
    runAlertCheck(io).catch(err => {
      console.error('[AlertMonitor] Check failed:', err)
    })
  }

  setTimeout(tick, FIRST_CHECK_DELAY_MS)
  monitorTimer = setInterval(tick, CHECK_INTERVAL_MS)
  console.log('[AlertMonitor] Started (checks every 60s).')
}

export function stopAlertMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
}
