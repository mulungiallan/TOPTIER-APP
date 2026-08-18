// ─── Web Push Notification Helper (VAPID-based) ─────────────────────────────
// Client-side subscription manager. Server-side sending requires the web-push
// npm package and VAPID keys (configured via env).

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = typeof atob !== 'undefined' ? atob(base64) : ''
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i)
  }
  return output
}

export interface PushSubscriptionPayload {
  endpoint: string
  keys: { p256dh: string; auth: string }
  userAgent?: string
}

export class PushNotificationService {
  static isSupported(): boolean {
    if (typeof window === 'undefined') return false
    return 'serviceWorker' in navigator && 'PushManager' in window
  }

  static async getPermissionState(): Promise<NotificationPermission> {
    if (typeof Notification === 'undefined') return 'denied'
    return Notification.permission
  }

  static async requestPermission(): Promise<NotificationPermission> {
    if (typeof Notification === 'undefined') return 'denied'
    return await Notification.requestPermission()
  }

  /**
   * Subscribe the current browser to push notifications.
   * Returns the subscription payload to send to /api/notifications/subscribe.
   */
  static async subscribe(userId: string): Promise<PushSubscriptionPayload | null> {
    if (!this.isSupported()) {
      console.warn('[push] Push notifications not supported')
      return null
    }

    if (!VAPID_PUBLIC_KEY) {
      console.warn('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set — skipping subscription')
      return null
    }

    const permission = await this.requestPermission()
    if (permission !== 'granted') {
      console.warn('[push] Permission not granted')
      return null
    }

    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
    })

    const payload: PushSubscriptionPayload = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: arrayBufferToB64(subscription.getKey('p256dh')),
        auth: arrayBufferToB64(subscription.getKey('auth')),
      },
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    }

    // Send to backend
    try {
      const token = getAuthToken()
      await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ userId, subscription: payload }),
      })
    } catch (err) {
      console.error('[push] Failed to register subscription with server:', err)
    }

    return payload
  }

  /**
   * Unsubscribe the current browser from push notifications.
   */
  static async unsubscribe(): Promise<boolean> {
    if (!this.isSupported()) return false
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return true
    await subscription.unsubscribe()
    // Optionally notify the server
    try {
      const token = getAuthToken()
      await fetch('/api/notifications/subscribe', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      })
    } catch (err) {
      console.error('[push] Failed to unregister subscription:', err)
    }
    return true
  }

  /**
   * Show a local notification immediately (no server round-trip).
   */
  static async showLocal(title: string, body: string, opts?: { icon?: string; tag?: string; data?: unknown }): Promise<void> {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const registration = await navigator.serviceWorker.ready
    await registration.showNotification(title, {
      body,
      icon: opts?.icon || '/icon-192.png',
      badge: '/icon-72.png',
      tag: opts?.tag,
      data: opts?.data,
    } as NotificationOptions)
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function arrayBufferToB64(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  const bytes = new Uint8Array(buf)
  let str = ''
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i])
  return btoa(str)
}

function getAuthToken(): string | null {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('toptier-store') : null
    if (!stored) return null
    return JSON.parse(stored)?.state?.authToken || null
  } catch {
    return null
  }
}
