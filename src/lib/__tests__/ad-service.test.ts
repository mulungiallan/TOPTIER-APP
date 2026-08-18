import { describe, it, expect, beforeEach } from 'vitest'
import { AdDistributionService } from '@/lib/services/ad-service'
import type { AdCreative } from '@/lib/services/ad-service'

function creative(type: AdCreative['type'], id: string = type): AdCreative {
  return { id, type, title: `${type} title`, description: 'desc', cta: 'Go', link: '/', emoji: '🎯', gradient: 'from-gray-500 to-gray-700' }
}

describe('AdDistributionService', () => {
  let ads: AdDistributionService

  beforeEach(() => {
    ads = new AdDistributionService()
  })

  it('returns null getters when no real creatives are registered', () => {
    expect(ads.getBannerAd()).toBeNull()
    expect(ads.getRewardedAd()).toBeNull()
  })

  it('serves only registered creatives', () => {
    const banner = creative('banner', 'banner-1')
    const rewarded = creative('rewarded', 'rewarded-1')
    ads.setRealCreatives([banner, rewarded])
    expect(ads.getBannerAd()).toEqual(banner)
    expect(ads.getRewardedAd()).toEqual(rewarded)
    expect(ads.getNativeAd()).toBeNull()
  })

  it('rotates among creatives of the same type', () => {
    const b1 = creative('banner', 'b1')
    const b2 = creative('banner', 'b2')
    ads.setRealCreatives([b1, b2])
    const seen = new Set<string>()
    for (let i = 0; i < 6; i++) {
      seen.add(ads.getBannerAd()!.id)
    }
    expect(seen.size).toBe(2)
  })

  it('AdFlow: requires all 10 required steps before unlocking', () => {
    const rewarded = creative('rewarded', 'rewarded-1')
    ads.setRealCreatives([rewarded])
    expect(ads.isAnalysisUnlocked('u1')).toBe(false)

    const steps = ads.getAdSteps()
    const required = steps.filter((s) => s.required)
    expect(required.length).toBe(10)

    for (const s of required) {
      ads.completeAdStep('u1', s.id)
    }
    expect(ads.isAnalysisUnlocked('u1')).toBe(true)
    expect(ads.getRemainingAds('u1', 'start')).toBe(0)
  })

  it('returns null next step when no rewarded creative exists', () => {
    expect(ads.getNextAdStep('u1', 'start')).toBeNull()
  })

  it('getNextAdStep returns phase-appropriate steps in order', () => {
    ads.setRealCreatives([creative('rewarded', 'r')])
    const first = ads.getNextAdStep('u1', 'start')
    expect(first!.id).toBe('welcome')
    ads.completeAdStep('u1', 'welcome')
    const second = ads.getNextAdStep('u1', 'start')
    expect(second!.id).toBe('market_brief')
  })

  it('resetForNewAnalysis clears progress', () => {
    ads.setRealCreatives([creative('rewarded', 'r')])
    const required = ads.getAdSteps().filter((s) => s.required)
    for (const s of required) ads.completeAdStep('u1', s.id)
    expect(ads.isAnalysisUnlocked('u1')).toBe(true)
    ads.resetForNewAnalysis('u1')
    expect(ads.isAnalysisUnlocked('u1')).toBe(false)
  })

  it('frequency-caps popups/interstitials/native per user', () => {
    const r: boolean[] = []
    for (let i = 0; i < 6; i++) r.push(ads.shouldShowPopup('u1'))
    // default frequency 3 -> shows on 3rd, 6th
    expect(r).toEqual([false, false, true, false, false, true])
  })

  it('respects disabled banner config', () => {
    expect(ads.shouldShowBanner('u1')).toBe(true)
    ads.updateConfig({ banners: { enabled: false, position: 'bottom', refreshInterval: 60 } })
    expect(ads.shouldShowBanner('u1')).toBe(false)
  })

  it('tracks per-user counters independently', () => {
    ads.shouldShowPopup('u1')
    expect(ads.shouldShowPopup('u2')).toBe(false) // u2 counter at 1, not 3
    ads.resetUser('u1')
    expect(ads.shouldShowPopup('u1')).toBe(false) // reset -> count from 1 again
  })
})
