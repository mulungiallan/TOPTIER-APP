'use client'

import { useState, useEffect } from 'react'
import { useStore, type Page } from '@/lib/store'
import { adService } from '@/lib/services/ad-service'
import { trackAd } from '@/lib/ads'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AdCreative } from '@/lib/services/ad-service'

interface InterstitialAdProps {
  onComplete: () => void
  onSkip?: () => void
  /** Force show — bypasses frequency cap */
  forceShow?: boolean
}

/**
 * InterstitialAd — full-screen ad shown between activities.
 * Has a 5s countdown timer before the user can skip.
 */
export function InterstitialAd({ onComplete, onSkip, forceShow = false }: InterstitialAdProps) {
  const [visible, setVisible] = useState(false)
  const [countdown, setCountdown] = useState(5)
  const [adData, setAdData] = useState<AdCreative | null>(null)
  const user = useStore((s) => s.user)
  const setPage = useStore((s) => s.setPage)
  const isPremium = user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'pro'
  const userId = user?.id || 'guest'

  useEffect(() => {
    if (isPremium) {
      onComplete()
      return
    }

    const shouldShow = forceShow || adService.shouldShowInterstitial(userId)
    if (!shouldShow) {
      onComplete()
      return
    }

    const creative = adService.getInterstitialAd()
    if (!creative) {
      onComplete()
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdData(creative)
    setCountdown(creative.duration ?? 5)
    setVisible(true)
    if (!isPremium) trackAd('interstitial', 'view')

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [isPremium])

  const handleSkip = () => {
    setVisible(false)
    trackAd('interstitial', 'complete')
    onSkip?.()
    onComplete()
  }

  const handleAction = () => {
    trackAd('interstitial', 'click')
    if (adData?.link?.startsWith('/')) {
      const pageName = adData.link.slice(1) as Page
      setPage(pageName)
    } else if (adData?.link) {
      window.open(adData.link, '_blank', 'noopener')
    }
    setVisible(false)
    onComplete()
  }

  if (!visible || isPremium || !adData) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black p-4">
      <div className="flex h-full max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-background text-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <span className="text-sm font-medium text-muted-foreground">{adData.title}</span>
          <button
            onClick={handleSkip}
            disabled={countdown > 0}
            className={cn(
              'text-sm transition',
              countdown > 0
                ? 'cursor-not-allowed text-muted-foreground/50'
                : 'text-foreground hover:text-primary'
            )}
          >
            {countdown > 0 ? (
              <span className="flex items-center gap-1">
                <Clock className="size-4" />
                Skip in {countdown}s
              </span>
            ) : (
              'Skip Ad →'
            )}
          </button>
        </div>

        <div
          className={cn(
            'flex flex-1 flex-col items-center justify-center bg-gradient-to-br p-8 text-center text-white',
            adData.gradient
          )}
        >
          <div className="mb-4 text-6xl">{adData.emoji}</div>
          <h3 className="text-2xl font-bold">{adData.description}</h3>
          <p className="mt-2 max-w-xs text-sm text-white/90">
            Sponsored content from one of our trusted partners.
          </p>
          <button
            onClick={handleAction}
            className="mt-6 rounded-lg bg-white px-8 py-3 font-semibold text-gray-900 transition hover:bg-white/90"
          >
            {adData.cta}
          </button>
        </div>

        <div className="border-t border-border p-3 text-center text-xs text-muted-foreground">
          {countdown > 0 ? `Ad continues in ${countdown}s` : 'You can skip this ad'}
        </div>
      </div>
    </div>
  )
}
