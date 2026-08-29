'use client'

import { useEffect, useRef } from 'react'
import { useStore } from '@/lib/store'

/**
 * Automatically refreshes the JWT before expiry.
 * Checks every 15 minutes and refreshes if the token expires within 1 day.
 */
export function useTokenRefresh() {
  const { authToken, isAuthenticated } = useStore()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!isAuthenticated || !authToken) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }

    const refresh = async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        })
        if (res.ok) {
          const { data } = await res.json()
          if (data?.token) {
            useStore.setState({ authToken: data.token })
          }
        }
      } catch {
        // Silently fail — will retry on next interval
      }
    }

    // Check every 15 minutes
    timerRef.current = setInterval(refresh, 15 * 60 * 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isAuthenticated, authToken])
}
