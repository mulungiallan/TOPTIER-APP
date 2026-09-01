'use client'

import { useState, useEffect } from 'react'
import { useStore, type Page } from '@/lib/store'
import { adService } from '@/lib/services/ad-service'
import { trackAd } from '@/lib/ads'
import { TrendingUp, ExternalLink, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AdCreative } from '@/lib/services/ad-service'

interface NativeAdProps {
  className?: string
  /** Force render regardless of frequency cap (used when explicitly placed in a feed) */
  forceShow?: boolean
}

/**
 * NativeAd — in-feed sponsored card. Looks like a real feed item but is
 * clearly labeled "Sponsored".
 */
export function NativeAd({ className = '', forceShow = false }: NativeAdProps) {
  const [adData, setAdData] = useState<AdCreative | null>(null)
  const [visible, setVisible] = useState(true)
  const user = useStore((s) => s.user)
  const setPage = useStore((s) => s.setPage)
  const isPremium = user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'pro'
  const userId = user?.id || 'guest'

  useEffect(() => {
    if (isPremium) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(false)
      return
    }
    if (forceShow || adService.shouldShowNative(userId)) {
      setAdData(adService.getNativeAd())
      trackAd('native', 'view')
    }
  }, [isPremium, forceShow, userId])

  if (!visible || isPremium || !adData) return null

  const handleClick = () => {
    trackAd('native', 'click')
    if (adData.link?.startsWith('/')) {
      const pageName = adData.link.slice(1) as Page
      setPage(pageName)
    } else if (adData.link) {
      window.open(adData.link, '_blank', 'noopener')
    }
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-muted/40 p-4',
        className
      )}
    >
      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <TrendingUp className="size-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">
              Sponsored
            </span>
            {adData.sponsor && (
              <span className="text-xs text-muted-foreground">· {adData.sponsor}</span>
            )}
          </div>
          <h4 className="mt-1 text-sm font-semibold">{adData.title}</h4>
          <p className="mt-0.5 text-sm text-muted-foreground">{adData.description}</p>
          <button
            onClick={handleClick}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {adData.cta} <ExternalLink className="size-3" />
          </button>
        </div>
        <button
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
