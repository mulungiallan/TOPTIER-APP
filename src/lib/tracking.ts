import { useStore } from '@/lib/store'

// ─── Client-side usage tracking (fire-and-forget, never blocks the UI) ───

const ENDPOINT = '/api/tracking/event'

let sessionStarted = false
let sessionStart = 0

function tokenHeader(): Record<string, string> {
  const token = useStore.getState().authToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function post(payload: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  try {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tokenHeader() },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => { /* tracking is fire-and-forget; never block the UI */ })
  } catch {
    // ignore — tracking must never break the app
  }
}

export function trackEvent(feature: string, action: string, meta?: Record<string, unknown> | string | number) {
  if (typeof window === 'undefined') return
  if (!useStore.getState().isAuthenticated) return
  post({ action, feature, meta: meta ?? null })
}

function beginSession() {
  sessionStart = Date.now()
  post({ action: 'session_start' })
}

function endSession() {
  if (!sessionStart) return
  post({ action: 'session_end', durationSec: Math.round((Date.now() - sessionStart) / 1000) })
  sessionStart = 0
}

function syncSession() {
  if (!sessionStart) {
    beginSession()
    return
  }
  post({ action: 'session_update', durationSec: Math.round((Date.now() - sessionStart) / 1000) })
}

export function initUsageTracking(): (() => void) | void {
  if (typeof window === 'undefined' || sessionStarted) return
  sessionStarted = true

  beginSession()

  const intervalId = window.setInterval(() => {
    if (!useStore.getState().isAuthenticated) return
    if (document.visibilityState === 'visible') syncSession()
  }, 60000)

  const onVisibility = () => {
    if (!useStore.getState().isAuthenticated) return
    if (document.visibilityState === 'hidden') endSession()
    else beginSession()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', endSession)
  window.addEventListener('beforeunload', endSession)

  return () => {
    window.clearInterval(intervalId)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', endSession)
    window.removeEventListener('beforeunload', endSession)
    endSession()
    sessionStarted = false
  }
}
