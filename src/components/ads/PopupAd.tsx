'use client'

import { useState, useEffect } from 'react'
import { useStore, type Page } from '@/lib/store'
import { adService } from '@/lib/services/ad-service'
import { X, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AdCreative } from '@/lib/services/ad-service'

interface PopupAdProps {
  onComplete?: () => void
  delay?: number // ms before showing
}

/**
 * PopupAd — center-screen modal popup, frequency-capped (every N actions).
 * Self-mounts; will decide at mount whether to actually show.
 */
export function PopupAd({ onComplete, delay = 2000 }: PopupAdProps) {
  const [visible, setVisible] = useState(false)
  const [adData, setAdData] = useState<AdCreative | null>(null)
  const user = useStore((s) => s.user)
  const setPage = useStore((s) => s.setPage)
  const isPremium = user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'pro'
  const userId = user?.id || 'guest'

  useEffect(() => {
    if (isPremium) return

    const timer = setTimeout(() => {
      if (adService.shouldShowPopup(userId)) {
        setAdData(adService.getPopupAd())
        setVisible(true)
      }
    }, delay)

    return () => clearTimeout(timer)
  }, [isPremium, delay, userId])

  const handleClose = () => {
    setVisible(false)
    onComplete?.()
  }

  const handleAction = () => {
    if (adData?.link?.startsWith('/')) {
      const pageName = adData.link.slice(1) as Page
      setPage(pageName)
    } else if (adData?.link) {
      window.open(adData.link, '_blank', 'noopener')
    }
    setVisible(false)
    onComplete?.()
  }

  if (!visible || isPremium || !adData) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        className={cn(
          'relative w-full max-w-sm rounded-2xl bg-gradient-to-br p-6 text-white shadow-2xl',
          'animate-in slide-in-from-bottom duration-300',
          adData.gradient || 'from-rose-500 to-red-500'
        )}
      >
        <button
          onClick={handleClose}
          aria-label="Close"
          className="absolute right-2 top-2 rounded-full bg-black/20 p-1 transition hover:bg-black/40"
        >
          <X className="size-5 text-white" />
        </button>

        <div className="mb-4 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-white/20">
            <span className="text-3xl">{adData.emoji}</span>
          </div>
        </div>

        <h3 className="text-center text-xl font-bold">{adData.title}</h3>
        <p className="mt-2 text-center text-sm text-white/90">{adData.description}</p>

        <div className="mt-6 space-y-3">
          <button
            onClick={handleAction}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 font-semibold text-gray-900 transition hover:bg-white/90"
          >
            <Zap className="size-4" />
            {adData.cta}
          </button>
          <button
            onClick={handleClose}
            className="w-full px-4 py-2 text-sm text-white/80 transition hover:text-white"
          >
            Maybe later
          </button>
        </div>

        <p className="mt-4 text-center text-[11px] text-white/70">
          💎 Upgrade to Premium to remove all ads
        </p>
      </div>
    </div>
  )
}
