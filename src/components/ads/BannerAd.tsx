'use client'

import { useState, useEffect } from 'react'
import { useStore, type Page } from '@/lib/store'
import { adService } from '@/lib/services/ad-service'
import { getAdSettings, trackAd, type AdSettings } from '@/lib/ads'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AdCreative } from '@/lib/services/ad-service'

interface BannerAdProps {
  position?: 'top' | 'bottom'
  className?: string
}

/**
 * BannerAd — fixed top or bottom banner.
 *
 * Only renders real advertising:
 *   - Google AdSense unit when provider is "google" and a client ID is set
 *   - Custom banner image when provider is "custom" and an image is configured
 *   - A registered real creative (from DB config) when one is available
 * Renders nothing otherwise.
 */
export function BannerAd({ position = 'bottom', className = '' }: BannerAdProps) {
  const [visible, setVisible] = useState(true)
  const [adData, setAdData] = useState<AdCreative | null>(null)
  const [settings, setSettings] = useState<AdSettings | null>(null)
  const user = useStore((s) => s.user)
  const setPage = useStore((s) => s.setPage)
  const isPremium = user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'pro'
  const userId = user?.id || 'guest'

  useEffect(() => {
    getAdSettings().then((s) => {
      if (s) setSettings(s)
    })
  }, [])

  useEffect(() => {
    if (isPremium) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(false)
      return
    }
    if (!adService.shouldShowBanner(userId)) return
    setAdData(adService.getBannerAd())
    setVisible(true)
    trackAd('banner', 'view')

    const interval = setInterval(() => {
      setAdData(adService.getBannerAd())
      trackAd('banner', 'view')
    }, adService.getConfig().banners.refreshInterval * 1000)

    return () => clearInterval(interval)
  }, [isPremium, userId])

  const adsEnabled = settings ? settings.enabled && settings.provider !== 'none' : false

  if (!visible || isPremium) return null

  const hasAdSense = adsEnabled && settings?.provider === 'google' && settings?.adSenseClientId
  const customImage = adsEnabled && settings?.provider === 'custom' && settings?.customBannerImage

  const renderReal = adData && adsEnabled && settings?.bannerEnabled

  if (!hasAdSense && !customImage && !renderReal) return null

  const containerClass = cn(
    'fixed left-0 right-0 z-40',
    position === 'bottom' ? 'bottom-0' : 'top-0',
    className
  )

  // Google AdSense unit
  if (hasAdSense && settings) {
    return (
      <div className={containerClass}>
        <div className="flex items-center justify-between gap-2 border-t border-border bg-background p-1.5">
          <div className="flex-1">
            <div className="mx-auto max-w-7xl">
              <ins
                className="adsbygoogle block"
                style={{ display: 'block' }}
                data-ad-client={settings.adSenseClientId}
                data-ad-slot={settings.adSenseSlotId || undefined}
                data-ad-format="auto"
                data-full-width-responsive="true"
              />
            </div>
          </div>
          <button
            onClick={() => setVisible(false)}
            aria-label="Dismiss ad"
            className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    )
  }

  // Custom banner image
  if (customImage && settings) {
    const link = settings.customBannerLink || ''
    const img = (
      <img
        src={settings.customBannerImage || ''}
        alt={settings.customBannerAlt || 'Advertisement'}
        className="h-12 w-full object-cover"
      />
    )
    return (
      <div className={containerClass}>
        <div className="relative">
          {link.startsWith('/') ? (
            <button className="block w-full cursor-pointer" onClick={() => setPage(link.slice(1) as Page)}>
              {img}
            </button>
          ) : (
            <a className="block w-full" href={link} target={link ? '_blank' : undefined} rel="noopener noreferrer">
              {img}
            </a>
          )}
          <button
            onClick={() => setVisible(false)}
            aria-label="Dismiss ad"
            className="absolute right-2 top-2 rounded bg-black/40 p-1 text-white transition hover:bg-black/60"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    )
  }

  // Registered real creative (custom banner from DB)
  if (!adData) return null

  const handleClick = () => {
    trackAd('banner', 'click')
    if (adData.link?.startsWith('/')) {
      const pageName = adData.link.slice(1) as Page
      setPage(pageName)
    } else if (adData.link) {
      window.open(adData.link, '_blank', 'noopener')
    }
  }

  return (
    <div className={containerClass}>
      <div className={cn('bg-gradient-to-r p-2.5 shadow-lg', adData.gradient || 'from-muted to-muted')}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-bold text-white">
              AD
            </span>
            {adData.emoji && <span className="text-lg leading-none">{adData.emoji}</span>}
            <p className="truncate text-sm font-medium text-white">
              {adData.title}{adData.description ? ` — ${adData.description}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handleClick}
              className="rounded bg-white/20 px-3 py-1 text-sm text-white transition hover:bg-white/30"
            >
              {adData.cta}
            </button>
            <button
              onClick={() => setVisible(false)}
              aria-label="Dismiss ad"
              className="rounded p-1 transition hover:bg-white/20"
            >
              <X className="size-4 text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
