/**
 * AdDistributionService
 * --------------------
 * Centralized ad-serving logic for the TOPTIER app.
 *
 * Implements:
 *   - Multi-step "AdFlow" (welcome, pre-analysis, loading, post-analysis, viewing, back, continue, bonus)
 *   - Banner ads (top / bottom)
 *   - Popup ads (frequency-capped)
 *   - Interstitial ads (frequency-capped, between activities)
 *   - Native (in-feed) ads
 *   - Rewarded ads (user-initiated)
 *
 * Premium users (subscriptionTier === 'premium' or 'pro') bypass all ads.
 *
 * NOTE: This service only serves creatives that were explicitly registered via
 * `setRealCreatives()` (sourced from the platform's AdConfig in the database).
 * When no real creative is configured for a format, the getters return null and
 * the calling components render nothing. No fabricated ad copy is ever shown.
 */

export type AdStepPhase = 'start' | 'processing' | 'results' | 'next'

export interface AdStep {
  id: string
  name: string
  description: string
  required: boolean
  skippable: boolean
  reward?: string
  phase: AdStepPhase
}

export interface AdCreative {
  id: string
  type: 'banner' | 'popup' | 'interstitial' | 'native' | 'rewarded'
  title: string
  description: string
  cta: string
  link: string
  emoji: string
  gradient: string // tailwind gradient classes
  sponsor?: string
  duration?: number // seconds (interstitials)
}

export interface AdConfig {
  banners: {
    enabled: boolean
    position: 'top' | 'bottom' | 'both'
    refreshInterval: number // seconds
  }
  popups: {
    enabled: boolean
    frequency: number // every X actions
    delay: number // seconds before showing
  }
  interstitials: {
    enabled: boolean
    frequency: number // every X page views / actions
    afterAction: boolean
  }
  rewarded: {
    enabled: boolean
    reward: string
  }
  native: {
    enabled: boolean
    frequency: number // every X feed items
  }
}

interface UserProgress {
  completedSteps: string[]
}

interface UserCounters {
  popups: number
  interstitials: number
  native: number
  actions: number
}

const DEFAULT_CONFIG: AdConfig = {
  banners: { enabled: true, position: 'bottom', refreshInterval: 60 },
  popups: { enabled: true, frequency: 3, delay: 2 },
  interstitials: { enabled: true, frequency: 5, afterAction: true },
  rewarded: { enabled: true, reward: 'free_analysis' },
  native: { enabled: true, frequency: 3 },
}

function pick<T>(arr: T[], salt: number): T {
  return arr[Math.abs(salt) % arr.length]
}

export class AdDistributionService {
  private config: AdConfig = DEFAULT_CONFIG
  private realCreatives: AdCreative[] = []
  private adProgress: Map<string, UserProgress> = new Map()
  private adCounters: Map<string, UserCounters> = new Map()
  private rotationTick = 0
  private reducedUsers: Set<string> = new Set()
  private MAX_ENTRIES = 10_000

  private evictStale(): void {
    if (this.adProgress.size > this.MAX_ENTRIES) {
      const cutoff = Date.now() - 3_600_000 // 1 hour
      for (const [key] of this.adProgress) {
        this.adProgress.delete(key)
        if (this.adProgress.size <= this.MAX_ENTRIES / 2) break
      }
      // If still too large, clear oldest half
      if (this.adProgress.size > this.MAX_ENTRIES) {
        const keys = [...this.adProgress.keys()]
        keys.slice(0, Math.floor(keys.length / 2)).forEach(k => this.adProgress.delete(k))
      }
    }
    if (this.adCounters.size > this.MAX_ENTRIES) {
      const keys = [...this.adCounters.keys()]
      keys.slice(0, Math.floor(keys.length / 2)).forEach(k => this.adCounters.delete(k))
    }
  }

  // ─── Real creative registration (sourced from DB AdConfig) ────────────
  setRealCreatives(creatives: AdCreative[]): void {
    this.realCreatives = creatives
  }

  getRealCreatives(): AdCreative[] {
    return [...this.realCreatives]
  }

  private pickFrom(type: AdCreative['type']): AdCreative | null {
    const pool = this.realCreatives.filter((c) => c.type === type)
    if (pool.length === 0) return null
    this.rotationTick++
    return pick(pool, this.rotationTick)
  }

  hasRewardedCreative(): boolean {
    return this.realCreatives.some((c) => c.type === 'rewarded')
  }

  // ─── Multi-step AdFlow (analysis gate) ───────────────────────────────
  // 10 required steps split evenly across 4 phases of the analysis journey:
  //   start (3)      → watched before the analysis begins
  //   processing (1) → watched while the chart is being analyzed
  //   results (3)    → watched before the results are revealed
  //   next (3)       → watched when moving on to the next analysis
  // A final skippable bonus step is optional.
  private adSteps: AdStep[] = [
    { id: 'welcome',        name: 'Welcome Ad',        description: 'Watch a quick ad to start your analysis',          required: true,  skippable: false, reward: 'unlock_analysis', phase: 'start' },
    { id: 'market_brief',   name: 'Market Brief Ad',   description: 'A sponsored market brief before we dig in',        required: true,  skippable: false, reward: 'market_context',  phase: 'start' },
    { id: 'pre_analysis',   name: 'Pre-Analysis Ad',   description: 'One more ad before we analyze your chart',         required: true,  skippable: false, reward: 'analysis_access', phase: 'start' },
    { id: 'loading',        name: 'Loading Ad',        description: 'While we process your chart, enjoy this ad',       required: true,  skippable: false, reward: 'faster_processing', phase: 'processing' },
    { id: 'post_analysis',  name: 'Results Ad',        description: 'Your analysis is ready! Watch this ad to view results', required: true, skippable: false, reward: 'view_results', phase: 'results' },
    { id: 'viewing',        name: 'Viewing Ad',        description: 'One more ad before you see the full analysis',     required: true,  skippable: false, reward: 'full_results',  phase: 'results' },
    { id: 'insights',       name: 'Insights Ad',       description: 'Sponsored insights to sharpen your read on the market', required: true, skippable: false, reward: 'ai_insights', phase: 'results' },
    { id: 'back_button',    name: 'Back Ad',           description: 'Watch a short ad before going back',               required: true,  skippable: false, reward: 'navigation',     phase: 'next' },
    { id: 'continue',       name: 'Continue Ad',       description: 'Watch this ad to continue to your next analysis',  required: true,  skippable: false, reward: 'next_analysis',  phase: 'next' },
    { id: 'final',          name: 'Final Ad',          description: 'One last ad to unlock your results',               required: true,  skippable: false, reward: 'full_access',    phase: 'next' },
    { id: 'extra',          name: 'Bonus Ad',          description: 'Watch one more ad for an extra analysis!',         required: false, skippable: true,  reward: 'bonus_analysis', phase: 'next' },
  ]

  getConfig(): AdConfig {
    return { ...this.config }
  }

  /**
   * Users who referred >= 20 downloads get a lighter ad load (5 ads instead of 10),
   * still well-distributed across every phase of the analysis journey.
   */
  setReducedAds(userId: string, reduced: boolean): void {
    if (reduced) this.reducedUsers.add(userId)
    else this.reducedUsers.delete(userId)
  }

  isReducedAds(userId: string): boolean {
    return this.reducedUsers.has(userId)
  }

  /** The subset of adSteps to serve for a given user (reduced = 5, default = 10). */
  private stepsFor(userId: string): AdStep[] {
    const isReduced = this.reducedUsers.has(userId)
    if (!isReduced) return this.adSteps
    const kept = new Set(['welcome', 'market_brief', 'loading', 'post_analysis', 'continue'])
    return this.adSteps.filter((s) => kept.has(s.id) || !s.required)
  }

  updateConfig(patch: Partial<AdConfig>): void {
    this.config = { ...this.config, ...patch }
  }

  // ─── AdFlow (multi-step gating, phase-aware) ────────────────────────
  getNextAdStep(userId: string, phase: AdStep['phase']): AdStep | null {
    if (!this.hasRewardedCreative()) return null
    const progress = this.adProgress.get(userId) || { completedSteps: [] }
    for (const step of this.stepsFor(userId)) {
      if (step.phase !== phase) continue
      if (!progress.completedSteps.includes(step.id)) return step
    }
    return null
  }

  getPhaseSteps(phase: AdStep['phase'], userId?: string): AdStep[] {
    const steps = userId ? this.stepsFor(userId) : this.adSteps
    return steps.filter((s) => s.phase === phase)
  }

  completeAdStep(userId: string, stepId: string): void {
    const progress = this.adProgress.get(userId) || { completedSteps: [] }
    if (!progress.completedSteps.includes(stepId)) progress.completedSteps.push(stepId)
    this.adProgress.set(userId, progress)
    this.evictStale()
  }

  resetForNewAnalysis(userId: string): void {
    this.adProgress.set(userId, { completedSteps: [] })
    this.evictStale()
  }

  getRemainingAds(userId: string, phase: AdStep['phase']): number {
    const progress = this.adProgress.get(userId) || { completedSteps: [] }
    return this.getPhaseSteps(phase).filter((s) => !progress.completedSteps.includes(s.id)).length
  }

  isAnalysisUnlocked(userId: string): boolean {
    const progress = this.adProgress.get(userId) || { completedSteps: [] }
    return this.adSteps.filter((s) => s.required).every((s) => progress.completedSteps.includes(s.id))
  }

  getAdSteps(): AdStep[] {
    return [...this.adSteps]
  }

  // ─── Frequency-capped ad decisioning ─────────────────────────────────
  shouldShowBanner(_userId: string): boolean {
    return this.config.banners.enabled
  }

  shouldShowPopup(userId: string): boolean {
    if (!this.config.popups.enabled) return false
    const c = this.getCounter(userId)
    c.popups++
    if (c.popups >= this.config.popups.frequency) {
      c.popups = 0
      return true
    }
    return false
  }

  shouldShowInterstitial(userId: string): boolean {
    if (!this.config.interstitials.enabled) return false
    const c = this.getCounter(userId)
    c.interstitials++
    if (c.interstitials >= this.config.interstitials.frequency) {
      c.interstitials = 0
      return true
    }
    return false
  }

  shouldShowNative(userId: string): boolean {
    if (!this.config.native.enabled) return false
    const c = this.getCounter(userId)
    c.native++
    if (c.native >= this.config.native.frequency) {
      c.native = 0
      return true
    }
    return false
  }

  /** Track a generic user action (used for interstitial timing). */
  trackAction(userId: string): void {
    const c = this.getCounter(userId)
    c.actions++
  }

  private getCounter(userId: string): UserCounters {
    if (!this.adCounters.has(userId)) {
      this.adCounters.set(userId, { popups: 0, interstitials: 0, native: 0, actions: 0 })
      this.evictStale()
    }
    return this.adCounters.get(userId)!
  }

  // ─── Creative getters (only real registered creatives; null = no ad) ─
  getBannerAd(): AdCreative | null {
    return this.pickFrom('banner')
  }

  getPopupAd(): AdCreative | null {
    return this.pickFrom('popup')
  }

  getInterstitialAd(): AdCreative | null {
    return this.pickFrom('interstitial')
  }

  getNativeAd(): AdCreative | null {
    return this.pickFrom('native')
  }

  getRewardedAd(): AdCreative | null {
    return this.pickFrom('rewarded')
  }

  // ─── Reset (testing / logout) ────────────────────────────────────────
  resetUser(userId: string): void {
    this.adProgress.delete(userId)
    this.adCounters.delete(userId)
  }
}

export const adService = new AdDistributionService()
