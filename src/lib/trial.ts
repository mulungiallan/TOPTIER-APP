// ─── Free Premium trial ─────────────────────────────────────────────────
// Every new account is granted a 7-day full-Premium trial automatically at
// sign-up (email + social), so users can explore signals, the trading bot and
// an ad-free experience before paying. Existing accounts that never used a
// trial are backfilled on deploy by scripts/ensure-trials.js.
//
// `deriveEntitlements` (src/lib/entitlements.ts) treats an active trial as
// full Premium: signals + bot + ad-free.

export const TRIAL_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export interface TrialWindow {
  subscriptionTier: 'trial'
  trialStartDate: Date
  trialEndDate: Date
  subscriptionStartDate: Date
  subscriptionEndDate: Date
}

export function trialWindow(now: Date = new Date()): TrialWindow {
  const end = new Date(now.getTime() + TRIAL_DAYS * DAY_MS)
  return {
    subscriptionTier: 'trial',
    trialStartDate: now,
    trialEndDate: end,
    subscriptionStartDate: now,
    subscriptionEndDate: end,
  }
}
