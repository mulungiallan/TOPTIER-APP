import { useStore, type User } from '@/lib/store'
import { api } from '@/lib/api'
import { adService } from '@/lib/services/ad-service'

// ─── Client-side ad configuration + gating ──────────────────────────────────

export interface AdSettings {
  id: string
  enabled: boolean
  provider: string // none | google | custom
  adSenseClientId?: string | null
  adSenseSlotId?: string | null
  customBannerImage?: string | null
  customBannerLink?: string | null
  customBannerAlt?: string | null
  bannerEnabled: boolean
  interstitialEnabled: boolean
  stepFrequency: number
  freeUsersOnly: boolean
  rewardedEnabled: boolean
  rewardedTitle?: string | null
  rewardedDescription?: string | null
  rewardedCta?: string | null
  rewardedLink?: string | null
  rewardedEmoji?: string | null
  rewardedGradient?: string | null
  rewardedDuration: number
  updatedAt: string
}

let cachedConfig: AdSettings | null = null

export async function getAdSettings(force = false): Promise<AdSettings | null> {
  if (cachedConfig && !force) return cachedConfig
  try {
    const res = await api.get<{ success: boolean; data: AdSettings }>('/ads/config')
    cachedConfig = (res as any)?.data ?? res
    return cachedConfig
  } catch {
    return null
  }
}

/**
 * Push a loaded AdSettings object into the ad service: registers the real
 * creatives that exist in the DB config and enables/disables each ad format.
 * Only configured creatives are shown — no fabricated ad copy is ever served.
 */
export function applyAdSettings(s: AdSettings): void {
  const enabled = s.enabled && s.provider !== 'none'
  const creatives: Parameters<typeof adService.setRealCreatives>[0] = []

  if (enabled && s.provider === 'custom' && s.customBannerImage) {
    creatives.push({
      id: 'custom_banner',
      type: 'banner',
      title: s.customBannerAlt || 'Advertisement',
      description: '',
      cta: 'Learn More',
      link: s.customBannerLink || '/',
      emoji: '',
      gradient: 'from-muted to-muted',
    })
  }

  // Rewarded AdFlow gate: only activates when the owner configured a real
  // rewarded creative (title + link). No configured creative → no gate.
  const rewardedEnabled = enabled && s.rewardedEnabled && !!s.rewardedTitle && !!s.rewardedLink
  if (rewardedEnabled) {
    creatives.push({
      id: 'rewarded_adflow',
      type: 'rewarded',
      title: s.rewardedTitle || 'Sponsored',
      description: s.rewardedDescription || '',
      cta: s.rewardedCta || 'Open',
      link: s.rewardedLink || '/',
      emoji: s.rewardedEmoji || '📈',
      gradient: s.rewardedGradient || 'from-indigo-500 via-purple-500 to-pink-500',
      duration: Math.max(1, s.rewardedDuration || 4),
    })
  }

  adService.setRealCreatives(creatives)

  adService.updateConfig({
    banners: { ...adService.getConfig().banners, enabled: enabled && s.bannerEnabled },
    popups: {
      ...adService.getConfig().popups,
      enabled: enabled && s.bannerEnabled,
      frequency: Math.max(2, s.stepFrequency || 5),
    },
    interstitials: {
      ...adService.getConfig().interstitials,
      enabled: enabled && s.interstitialEnabled,
      frequency: Math.max(2, s.stepFrequency || 5),
    },
    native: { ...adService.getConfig().native, enabled: enabled && s.bannerEnabled },
    rewarded: { ...adService.getConfig().rewarded, enabled: rewardedEnabled },
  })
}

// Free / trial users get ads; paying plans do not.
export function shouldShowAds(user: User | null): boolean {
  if (!user) return false
  const tier = (user.subscriptionTier || '').toLowerCase()
  const plan = (user.plan || '').toLowerCase()
  if (
    tier === 'premium' ||
    tier === 'lifetime' ||
    plan === 'premium' ||
    plan === 'pro' ||
    plan === 'enterprise' ||
    plan === 'unlimited'
  ) {
    return false
  }
  return true
}

// Module-level page-step counter for the interstitial frequency.
let stepCount = 0

export function recordPageStep(): number {
  stepCount += 1
  return stepCount
}

export function resetStepCounter() {
  stepCount = 0
}

export function setStepCounter(n: number) {
  stepCount = n
}

export function isAuthenticated(): boolean {
  return useStore.getState().isAuthenticated
}
