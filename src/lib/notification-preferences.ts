// src/lib/notification-preferences.ts
// Shared helpers for resolving a user's notification preferences
// (stored on User.notificationPrefs as JSON, edited from /settings).
// These defaults mirror the UI checkboxes in settings.tsx.

export interface NotificationTypePref {
  id: string
  label: string
  inApp: boolean
  push: boolean
  email: boolean
}

export interface NotificationPrefs {
  types?: NotificationTypePref[]
  dndStart?: string
  dndEnd?: string
  maxSignals?: number
}

export const DEFAULT_NOTIFICATION_TYPES: NotificationTypePref[] = [
  { id: 'new-signal', label: 'New Signal', inApp: true, push: true, email: false },
  { id: 'signal-result', label: 'Signal Result', inApp: true, push: true, email: true },
  { id: 'breaking-news', label: 'Breaking News', inApp: true, push: false, email: false },
  { id: 'calendar-events', label: 'Calendar Events', inApp: true, push: true, email: false },
  { id: 'price-alerts', label: 'Price Alerts', inApp: true, push: true, email: true },
  { id: 'system', label: 'System', inApp: true, push: false, email: true },
]

// Maps notifyUser(type) values to the preference ids users can toggle.
// Unknown types fall back to in-app + push (no email) so nothing is lost.
export const TYPE_TO_PREF: Record<string, string> = {
  signal: 'new-signal',
  signal_result: 'signal-result',
  news: 'breaking-news',
  calendar: 'calendar-events',
  price_alert: 'price-alerts',
  system: 'system',
  subscription: 'system',
}

export interface DeliveryPlan {
  inApp: boolean
  push: boolean
  email: boolean
}

export function parseNotificationPrefs(raw?: string | null): NotificationPrefs {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as NotificationPrefs
  } catch {
    return {}
  }
}

/**
 * Resolve whether a notification of the given type should be delivered
 * via in-app, web push, and/or email, honoring the user's saved preferences.
 * Users with no saved prefs get the app defaults.
 */
export function getDeliveryPlan(prefs: NotificationPrefs, notifyType: string): DeliveryPlan {
  const prefId = TYPE_TO_PREF[notifyType]
  const defaults = DEFAULT_NOTIFICATION_TYPES.find(t => t.id === prefId)

  const saved = (prefs.types || []).find(t => t.id === prefId)
  const resolved: DeliveryPlan = {
    inApp: saved ? saved.inApp : defaults ? defaults.inApp : true,
    push: saved ? saved.push : defaults ? defaults.push : true,
    email: saved ? saved.email : defaults ? defaults.email : false,
  }
  return resolved
}

function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return -1
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

/**
 * True when `date` falls inside the user's Do-Not-Disturb window
 * (dndStart/dndEnd in "HH:MM"). A window that crosses midnight is handled.
 */
export function inDndWindow(prefs: NotificationPrefs, date: Date = new Date()): boolean {
  const startRaw = prefs.dndStart
  const endRaw = prefs.dndEnd
  if (!startRaw || !endRaw) return false

  const start = toMinutes(startRaw)
  const end = toMinutes(endRaw)
  if (start < 0 || end < 0) return false

  const now = date.getHours() * 60 + date.getMinutes()
  if (start === end) return now === start
  if (start < end) return now >= start && now <= end
  // Window crosses midnight
  return now >= start || now <= end
}
