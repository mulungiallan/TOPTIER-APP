// src/lib/services/notifications.ts
// Shared helper for creating in-app notifications + web push + email.
// Delivery honors each user's notification preferences (User.notificationPrefs):
// per-type in-app/push/email toggles and the Do-Not-Disturb window.
//
// The in-app notification is the source of truth; push/email delivery is
// attempted and logged loudly if it fails or isn't configured (never silently
// faked — but a delivery failure never breaks the in-app record).

import { db } from '@/lib/db'
import { PushSender } from '@/lib/services/push-sender'
import { emailService } from '@/lib/services/email'
import {
  parseNotificationPrefs,
  getDeliveryPlan,
  inDndWindow,
  NotificationPrefs,
} from '@/lib/notification-preferences'

export interface NotifyData {
  type: string
  title: string
  message: string
  actionUrl?: string
}

export interface NotifyOptions {
  /** Skip the email leg (e.g. caller already sent a dedicated, templated email). */
  skipEmail?: boolean
  /** Override the user's saved preferences (used sparingly for critical system notices). */
  forceInApp?: boolean
}

export interface NotifyResult {
  notification: { id: string } | null
  delivered: { inApp: boolean; push: boolean; email: boolean }
}

/**
 * Deliver a notification to a single user via in-app, web push, and email —
 * each leg gated by the user's notification preferences.
 */
export async function notifyUser(
  userId: string,
  data: NotifyData,
  options: NotifyOptions = {}
): Promise<NotifyResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, notificationPrefs: true },
  })

  if (!user) {
    return { notification: null, delivered: { inApp: false, push: false, email: false } }
  }

  const prefs = parseNotificationPrefs(user.notificationPrefs)
  return deliver(user.id, user.email, prefs, data, options)
}

/**
 * Deliver a notification to many users in one call (e.g. a new signal).
 * `users` must contain `{ id, email, notificationPrefs }` — batch-load them
 * with one findMany for efficiency.
 */
export async function notifyUsers(
  users: { id: string; email: string | null; notificationPrefs: string | null }[],
  data: NotifyData,
  options: NotifyOptions = {}
): Promise<{ notified: number; skipped: number }> {
  const CONCURRENCY = 10
  let notified = 0
  for (let i = 0; i < users.length; i += CONCURRENCY) {
    const batch = users.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async (user) => {
        const prefs = parseNotificationPrefs(user.notificationPrefs)
        return deliver(user.id, user.email, prefs, data, options)
      })
    )
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.notification) notified++
    }
  }
  return { notified, skipped: users.length - notified }
}

async function deliver(
  userId: string,
  email: string | null,
  prefs: NotificationPrefs,
  data: NotifyData,
  options: NotifyOptions
): Promise<NotifyResult> {
  const plan = getDeliveryPlan(prefs, data.type)
  const dnd = inDndWindow(prefs)
  const pushEnabled = plan.push && !dnd

  let notification: { id: string } | null = null
  if (plan.inApp || options.forceInApp) {
    notification = await db.notification.create({
      data: {
        userId,
        type: data.type,
        title: data.title,
        message: data.message,
        isRead: false,
        actionUrl: data.actionUrl,
      },
      select: { id: true },
    })
  }

  // Web push (best-effort; logged loudly on failure).
  if (pushEnabled) {
    try {
      const result = await PushSender.sendToUser(userId, {
        title: data.title,
        body: data.message,
        url: data.actionUrl,
      })
      if (result.skipped) {
        console.log(`[notifyUser] No active push subscription for user ${userId} — web push skipped.`)
      } else if (result.delivered > 0) {
        console.log(`[notifyUser] Web push delivered to ${result.delivered} device(s) for user ${userId}.`)
      }
    } catch (err) {
      console.error(`[notifyUser] Web push not delivered for user ${userId}:`, err)
    }
  }

  // Email (best-effort; logged loudly on failure or when unconfigured).
  let emailSent = false
  if (plan.email && !options.skipEmail && email) {
    try {
      await emailService.sendNotificationEmail(email, {
        title: data.title,
        message: data.message,
        actionUrl: data.actionUrl,
      })
      emailSent = true
    } catch (err) {
      console.error(`[notifyUser] Email not delivered for user ${userId}:`, err)
    }
  }

  return {
    notification,
    delivered: { inApp: !!notification, push: pushEnabled, email: emailSent },
  }
}
