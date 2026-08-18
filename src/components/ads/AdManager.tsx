'use client'

import { useState, useEffect, useRef } from 'react'
import { useStore } from '@/lib/store'
import { adService } from '@/lib/services/ad-service'
import { getAdSettings, applyAdSettings, shouldShowAds, type AdSettings } from '@/lib/ads'
import { BannerAd } from './BannerAd'
import { PopupAd } from './PopupAd'
import { InterstitialAd } from './InterstitialAd'
import { NativeAd } from './NativeAd'

interface AdManagerProps {
  children: React.ReactNode
  showBanner?: boolean
  showNative?: boolean
  onInterstitialComplete?: () => void
}

/**
 * AdManager — wraps the app and orchestrates all ad types:
 *   - BannerAd (fixed bottom)
 *   - PopupAd (self-fires after delay, frequency-capped)
 *   - InterstitialAd (fires every N navigations)
 *   - NativeAd (used in-feed by individual pages, NOT auto-rendered here)
 *
 * Settings come from the database (AdConfig) so the platform owner controls
 * whether ads are on, how often they fire and which users see them.
 * Free / trial users see ads; premium users see nothing.
 */
export function AdManager({
  children,
  showBanner = true,
  showNative = true,
  onInterstitialComplete,
}: AdManagerProps) {
  const user = useStore((s) => s.user)
  const currentPage = useStore((s) => s.currentPage)
  const userId = user?.id || 'guest'

  const [settings, setSettings] = useState<AdSettings | null>(null)
  const [showInterstitial, setShowInterstitial] = useState(false)
  const navCountRef = useRef(0)

  // Load DB ad config once and push it into the ad service.
  useEffect(() => {
    getAdSettings().then((s) => {
      if (!s) return
      setSettings(s)
      applyAdSettings(s)
    })
  }, [])

  const adsEnabled = settings ? settings.enabled && settings.provider !== 'none' : false
  const seeAds = adsEnabled && shouldShowAds(user)

  // Trigger interstitial on every Nth navigation (per DB ad config)
  useEffect(() => {
    if (!seeAds) return
    if (currentPage === 'login' || currentPage === 'register' || currentPage === 'onboarding') return

    navCountRef.current += 1
    const freq = adService.getConfig().interstitials.frequency
    if (navCountRef.current >= freq) {
      navCountRef.current = 0
      // Slight delay so the page can paint before we hijack the screen
      const t = setTimeout(() => setShowInterstitial(true), 400)
      return () => clearTimeout(t)
    }
  }, [currentPage, seeAds])

  const handleInterstitialComplete = () => {
    setShowInterstitial(false)
    onInterstitialComplete?.()
  }

  // Don't render any ad chrome on auth pages or for premium users
  const isAuthPage =
    currentPage === 'login' || currentPage === 'register' || currentPage === 'onboarding'

  if (!seeAds || isAuthPage) {
    return <>{children}</>
  }

  return (
    <>
      {/* Bottom-padded wrapper so banner doesn't cover content */}
      <div className="pb-[52px]">{children}</div>

      {showBanner && <BannerAd position="bottom" />}
      <PopupAd delay={4000} />

      {showInterstitial && (
        <InterstitialAd onComplete={handleInterstitialComplete} />
      )}

      {/* NativeAd is exported as a standalone component for in-feed use,
          but we also expose a default one here for pages that opt-in. */}
      {showNative && <NativeAd className="hidden" />}
    </>
  )
}
