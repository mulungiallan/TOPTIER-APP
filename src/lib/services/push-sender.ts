// src/lib/services/push-sender.ts
// Server-side Web Push delivery (VAPID-based) using the web-push package.
// Fails loudly when VAPID keys are missing — never pretends a push was sent.

import webpush from 'web-push'
import { db } from '@/lib/db'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:notifications@toptier.app'

export interface PushMessage {
  title: string
  body: string
  url?: string
  tag?: string
}

export class PushSender {
  private static warnedUnconfigured = false

  /**
   * Log the "VAPID missing" condition at most once per process.
   *
   * This used to be logged (and thrown) on every single sendToUser call. The
   * signal generator notifies up to 1000 users per generated signal, so an
   * unconfigured deployment emitted thousands of error lines a minute, hit
   * Railway's 500 logs/sec ceiling, and the replica was killed — which failed
   * the deploy outright. The condition is a deployment misconfiguration, not a
   * per-user event, so it is reported once.
   */
  static warnUnconfiguredOnce(): void {
    if (this.warnedUnconfigured) return
    this.warnedUnconfigured = true
    console.warn(
      '[PushSender] VAPID keys not configured — web push is disabled. ' +
        'Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable it.'
    )
  }

  static isConfigured(): boolean {
    return !!VAPID_PUBLIC_KEY && !!VAPID_PRIVATE_KEY
  }

  /**
   * Deliver a web push to all active subscriptions of a user.
   * Throws if VAPID keys are not configured (honest — don't pretend).
   * Invalid subscriptions (404/410) are deactivated.
   */
  static async sendToUser(
    userId: string,
    message: PushMessage
  ): Promise<{ delivered: number; failed: number; skipped: boolean }> {
    if (!this.isConfigured()) {
      console.error(
        '[PushSender] VAPID keys not configured — refusing to claim a push was sent. ' +
          'Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env to enable web push.'
      )
      throw new Error('Web push is not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env.')
    }

    const subscriptions = await db.pushSubscription.findMany({
      where: { userId, isActive: true },
      select: { endpoint: true, p256dh: true, auth: true },
    })

    if (subscriptions.length === 0) {
      return { delivered: 0, failed: 0, skipped: true }
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    const payload = JSON.stringify({ ...message, url: message.url || '/notifications' })

    let delivered = 0
    let failed = 0
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
        delivered++
      } catch (err: any) {
        failed++
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await db.pushSubscription
            .updateMany({ where: { endpoint: sub.endpoint }, data: { isActive: false } })
            .catch((e: any) => console.warn('[PushSender] Failed to deactivate stale subscription:', e?.message))
        } else {
          console.error('[PushSender] send failed:', err?.statusCode, err?.body || err?.message || err)
        }
      }
    }
    return { delivered, failed, skipped: false }
  }
}
