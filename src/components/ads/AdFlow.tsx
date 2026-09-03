'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '@/lib/store'
import { getAdSettings, applyAdSettings } from '@/lib/ads'
import { adService, type AdStep, type AdCreative, type AdStepPhase } from '@/lib/services/ad-service'
import { trackAd } from '@/lib/ads'
import { X, Gift, Zap, Crown, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AdFlowProps {
  onComplete: () => void
  onSkip?: () => void
  onUpgrade?: () => void
  analysisId?: string
  phase?: AdStepPhase
}

/**
 * AdFlow — phased rewarded-ad gate used by the Screenshot Analyzer.
 *
 * Walks the user through the AdStep sequence of a single phase defined in
 * adService. The 10 required steps are split evenly across four phases
 * (start / processing / results / next) so ads are distributed across the
 * whole analysis journey instead of dumping all at once. Required steps must
 * be watched; the final "bonus" step is skippable. When a phase is complete,
 * `onComplete` is called.
 */
export function AdFlow({ onComplete, onSkip, onUpgrade, phase = 'start' }: AdFlowProps) {
  const user = useStore((s) => s.user)
  const setPage = useStore((s) => s.setPage)
  const userId = user?.id || 'guest'

  const [currentStep, setCurrentStep] = useState<AdStep | null>(null)
  const [progress, setProgress] = useState<AdStep[]>([])
  const [watchProgress, setWatchProgress] = useState(0) // 0–100 for current ad
  const [creative, setCreative] = useState<AdCreative | null>(null)
  const [done, setDone] = useState(false)
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current)
    }
  }, [])

  const refresh = useCallback(() => {
    const step = adService.getNextAdStep(userId, phase)
    setCurrentStep(step)
    setProgress(adService.getPhaseSteps(phase, userId))
    if (step) setCreative(adService.getRewardedAd())
  }, [userId, phase])

  useEffect(() => {
    // Progress is reset once per analysis, only when the first phase starts.
    if (phase === 'start') adService.resetForNewAnalysis(userId)
    let cancelled = false
    // Force a fresh copy of the DB ad config so the gate state is correct even
    // if AdManager hasn't finished loading when this component mounts.
    getAdSettings(true).then((s) => {
      if (cancelled) return
      if (s) applyAdSettings(s)
      // No real rewarded creative is configured — don't gate the user behind
      // fake ads; proceed straight to the analysis.
      if (!adService.hasRewardedCreative()) {
        onComplete()
        return
      }
      refresh()
    })
    return () => {
      cancelled = true
    }
  }, [userId, phase, refresh, onComplete])

  // Simulate ad playback
  useEffect(() => {
    if (!currentStep || !creative) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWatchProgress(0)
    const duration = (creative.duration || 4) * 1000 // seconds per step, from config
    const tickMs = 100
    const inc = (tickMs / duration) * 100
    const timer = setInterval(() => {
      setWatchProgress((p) => {
        const next = p + inc
        if (next >= 100) {
          clearInterval(timer)
          return 100
        }
        return next
      })
    }, tickMs)
    return () => clearInterval(timer)
  }, [currentStep, creative])

  const handleStepComplete = () => {
    if (!currentStep) return
    trackAd('rewarded', 'complete', { step: currentStep.id })
    adService.completeAdStep(userId, currentStep.id)
    const next = adService.getNextAdStep(userId, phase)
    if (next) {
      setCurrentStep(next)
      setCreative(adService.getRewardedAd())
      setWatchProgress(0)
    } else {
      setDone(true)
      completeTimerRef.current = setTimeout(() => onComplete(), 1200)
    }
  }

  const handleSkip = () => {
    if (!currentStep?.skippable) return
    adService.completeAdStep(userId, currentStep.id)
    onSkip?.()
    const next = adService.getNextAdStep(userId, phase)
    if (next) {
      setCurrentStep(next)
      setCreative(adService.getRewardedAd())
      setWatchProgress(0)
    } else {
      setDone(true)
      completeTimerRef.current = setTimeout(() => onComplete(), 1200)
    }
  }

  if (!currentStep && !done) return null

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
        <div className="flex w-full max-w-sm flex-col items-center rounded-2xl bg-background p-8 text-center shadow-2xl">
          <CheckCircle2 className="size-16 text-green-500" />
          <h3 className="mt-4 text-xl font-bold">All ads complete!</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Unlocking your analysis…
          </p>
        </div>
      </div>
    )
  }

  if (!currentStep || !creative) return null

  const phaseSteps = progress
  const currentIndex = phaseSteps.findIndex((s) => s.id === currentStep.id)
  const requiredTotal = phaseSteps.filter((s) => s.required).length
  const requiredDone = phaseSteps.slice(0, currentIndex).filter((s) => s.required).length
  const remaining = adService.getRemainingAds(userId, phase)
  const overallPct = Math.round((requiredDone / requiredTotal) * 100)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-background shadow-2xl">
        {/* Premium escape hatch */}
        {onUpgrade && (
          <button
            onClick={onUpgrade}
            className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2.5 py-1 text-[11px] font-semibold text-yellow-600 transition hover:bg-yellow-500/25 dark:text-yellow-400"
          >
            <Crown className="size-3" />
            Remove Ads
          </button>
        )}

        {/* Step progress bar */}
        <div className="border-b border-border bg-muted/40 px-4 py-2.5">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Step {progress.findIndex(s => s.id === currentStep.id) + 1} / {phaseSteps.length}
            </span>
            <span>{overallPct}% complete</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${overallPct}%` }}
            />
          </div>
        </div>

        {/* Ad "creative" */}
        <div
          className={cn(
            'relative flex flex-col items-center justify-center bg-gradient-to-br p-8 text-center text-white',
            creative.gradient
          )}
        >
          <div className="absolute left-3 top-3 rounded bg-black/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
            Ad · {currentStep.name}
          </div>
          <div className="text-6xl">{creative.emoji}</div>
          <h3 className="mt-4 text-xl font-bold">{creative.title}</h3>
          <p className="mt-1 max-w-xs text-sm text-white/90">{creative.description}</p>

          {/* Watch progress ring / bar */}
          <div className="mt-6 w-full max-w-[220px]">
            <div className="mb-1 flex items-center justify-between text-[11px] text-white/80">
              <span>Watching ad…</span>
              <span>{Math.round(watchProgress)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full bg-white transition-all"
                style={{ width: `${watchProgress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Description + reward */}
        <div className="px-4 py-4">
          <p className="text-center text-sm text-muted-foreground">{currentStep.description}</p>
          {currentStep.reward && (
            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <Gift className="size-3.5" />
              Reward: <code className="rounded bg-green-500/10 px-1.5 py-0.5">{currentStep.reward}</code>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {currentStep.skippable && (
              <button
                onClick={handleSkip}
                className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-muted"
              >
                Skip
              </button>
            )}
            <button
              onClick={handleStepComplete}
              disabled={watchProgress < 100}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition',
                watchProgress < 100
                  ? 'cursor-not-allowed bg-muted-foreground/40'
                  : 'bg-primary hover:bg-primary/90'
              )}
            >
              <Zap className="size-4" />
              {watchProgress < 100 ? 'Watch to continue…' : 'Continue'}
            </button>
          </div>

          {/* Close entirely (abandon flow) */}
          <button
            onClick={() => {
              onSkip?.()
              setPage('dashboard')
            }}
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-3" /> Cancel analysis
          </button>
        </div>
      </div>
    </div>
  )
}
