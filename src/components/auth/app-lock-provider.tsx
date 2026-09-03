'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AppLockScreen } from '@/components/auth/app-lock-screen'
import { isEnabled } from '@/lib/security/app-lock'

interface AppLockContextValue {
  /** True while the app is currently showing the lock screen. */
  locked: boolean
  /** Force-lock immediately (e.g. from a Settings toggle turning it on). */
  lockNow: () => void
}

const AppLockContext = createContext<AppLockContextValue | null>(null)

export function useAppLock(): AppLockContextValue {
  const ctx = useContext(AppLockContext)
  if (!ctx) throw new Error('useAppLock must be used within <AppLockProvider>')
  return ctx
}

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(false)
  const enabledRef = useRef(isEnabled())
  const everHiddenRef = useRef(false)
  const unlockedAtRef = useRef(0)

  const maybeLock = useCallback(() => {
    // Only lock if app lock is enabled AND the user hasn't unlocked within a tiny
    // grace window (avoids flashing the lock on a same-frame re-render).
    if (!enabledRef.current) return
    const now = Date.now()
    if (now - unlockedAtRef.current < 500) return
    setLocked(true)
  }, [])

  useEffect(() => {
    enabledRef.current = isEnabled()

    // Capability 1: browser visibility (works everywhere).
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        everHiddenRef.current = true
      } else if (document.visibilityState === 'visible' && everHiddenRef.current) {
        maybeLock()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Capability 2: push the app to background / return (native via Capacitor,
    // but harmless as a no-op elsewhere). Rely on the public App plugin if present.
    // We use the plugin's registered listener via dynamic import to avoid pulling
    // native code into every bundle.
    let removeAppListener: (() => void) | undefined

    const initNativeLocks = async () => {
      try {
        const { App } = await import('@capacitor/app')
        // Register a one-time "appStateChange" handler; on iOS/Android this fires
        // when the app is backgrounded/foregrounded, covering the same reopen path.
        const handler = App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) {
            everHiddenRef.current = true
          } else if (everHiddenRef.current) {
            maybeLock()
          }
        })
        // App.addListener returns a Promise in Capacitor 8
        const plugin = await handler
        removeAppListener = () => plugin?.remove()
      } catch {
        // Not running inside Capacitor — visibilitychange handles it.
      }
    }
    initNativeLocks()

    // Keep the enabled flag in sync if changed elsewhere (Settings).
    const syncInterval = window.setInterval(() => {
      enabledRef.current = isEnabled()
    }, 2000)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      removeAppListener?.()
      window.clearInterval(syncInterval)
    }
  }, [maybeLock])

  const lockNow = useCallback(() => {
    enabledRef.current = isEnabled()
    if (!enabledRef.current) return
    everHiddenRef.current = true
    setLocked(true)
  }, [])

  const handleUnlock = useCallback(() => {
    unlockedAtRef.current = Date.now()
    setLocked(false)
  }, [])

  return (
    <AppLockContext.Provider value={{ locked, lockNow }}>
      {children}
      <AnimatePresence>
        {locked && <AppLockScreen key="app-lock" onUnlock={handleUnlock} />}
      </AnimatePresence>
    </AppLockContext.Provider>
  )
}