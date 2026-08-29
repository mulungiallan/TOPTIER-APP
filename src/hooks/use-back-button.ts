'use client'

import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { useStore } from '@/lib/store'

/**
 * Handles the Android hardware back button.
 * - If on dashboard → shows exit confirmation or closes app
 * - Otherwise → navigates back to dashboard
 * - If sidebar is open → closes it first
 */
export function useBackButton() {
  const { currentPage, setPage, sidebarOpen, setSidebarOpen } = useStore()

  useEffect(() => {
    let handler: any

    App.addListener('backButton', ({ canGoBack }: { canGoBack: boolean }) => {
      // Close sidebar first if open
      if (sidebarOpen) {
        setSidebarOpen(false)
        return
      }

      // If on dashboard, let the OS handle it (exit app)
      if (currentPage === 'dashboard') {
        // On Android, this allows the default behavior (app goes to background)
        return
      }

      // Otherwise navigate to dashboard
      setPage('dashboard')
    }).then((handle) => {
      handler = handle
    })

    return () => {
      handler?.remove()
    }
  }, [currentPage, sidebarOpen, setPage, setSidebarOpen])
}
