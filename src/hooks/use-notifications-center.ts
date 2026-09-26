'use client'

// Instant in-app notification delivery.
//
// The app has no socket server in production (Railway runs the plain Next.js
// standalone server), so "instant" is delivered with reliable short polling:
// every 15s (plus on window focus) this hook fetches the user's notification
// center and pops a sonner toast for anything new since the previous poll.
//
// Historical unread notifications are seeded silently on first load so they
// don't burst out of the box — only notifications issued AFTER the session
// started trigger a popup. The bell badge/count in app-shell reads the same
// store state this hook writes.

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useStore, type AppNotification, type Page } from '@/lib/store'
import { api } from '@/lib/api'

const POLL_MS = 15_000
const MAX_POPUPS_PER_POLL = 3

const ACTION_PAGE_HINTS: Array<{ prefix: string; page: Page }> = [
  { prefix: '/signals', page: 'signals' },
  { prefix: '/news', page: 'news' },
  { prefix: '/alerts', page: 'alerts' },
  { prefix: '/performance', page: 'performance' },
  { prefix: '/wallet', page: 'wallet' },
  { prefix: '/subscriptions', page: 'subscriptions' },
  { prefix: '/pricing', page: 'pricing' },
  { prefix: '/admin', page: 'admin' },
]

function pageFromUrl(url: string | null): Page | null {
  if (!url) return null
  for (const hint of ACTION_PAGE_HINTS) {
    if (url.startsWith(hint.prefix)) return hint.page
  }
  return null
}

export const notificationPageFromUrl = pageFromUrl

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function useNotificationsCenter(enabled = true): void {
  const authToken = useStore((s) => s.authToken)
  const setNotifications = useStore((s) => s.setNotifications)
  const knownIds = useRef<Set<string>>(new Set())
  const bootstrapped = useRef(false)

  useEffect(() => {
    if (!enabled || !authToken) return

    let cancelled = false

    const load = async () => {
      try {
        const res = await api.get<{
          data: { notifications: AppNotification[]; unreadCount: number }
        }>('/notifications/center')
        const list = res?.data?.notifications || []
        if (cancelled) return
        setNotifications(list)

        if (!bootstrapped.current) {
          bootstrapped.current = true
          list.forEach((n) => knownIds.current.add(n.id))
          return
        }

        const fresh = list.filter((n) => !knownIds.current.has(n.id) && !n.isRead)
        fresh.slice(0, MAX_POPUPS_PER_POLL).forEach((n) => {
          const page = pageFromUrl(n.actionUrl)
          toast(n.title || 'New notification', {
            description: n.message,
            action: page
              ? {
                  label: 'View',
                  onClick: () => {
                    useStore.getState().markNotificationRead(n.id)
                    useStore.getState().setPage(page)
                    void api.post('/notifications/center', { id: n.id }).catch(() => {})
                  },
                }
              : undefined,
          })
        })
        fresh.forEach((n) => knownIds.current.add(n.id))
        list.forEach((n) => knownIds.current.add(n.id))
      } catch {
        // Unauthorized / transient failure — wait for the next poll.
      }
    }

    void load()
    const id = setInterval(() => void load(), POLL_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const onFocus = () => void load()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [authToken, enabled, setNotifications])
}