import { db } from '@/lib/db'

// A-la-carte feature entitlements.
//
// Features are sold as standalone products (see PLANS in
// /api/subscriptions): signals_monthly ($20/mo), bot_quarterly
// ($100/3mo), remove_ads ($5 one-time). Legacy premium subscribers and
// admins keep access to everything; active trial users are granted the
// same entitlements for the trial window.

export const SIGNALS_PAYWALL_MESSAGE =
  'Signals are a paid feature — subscribe to Signals ($20/month) to see today\'s top signals.'
export const BOT_PAYWALL_MESSAGE =
  'Bot access requires the Trading Bot package ($100 for 3 months).'
export const ADS_PAYWALL_MESSAGE =
  'Remove ads app-wide with a one-time $5 purchase.'

export interface EntitlementRow {
  role?: string | null
  subscriptionTier?: string | null
  subscriptionEndDate?: Date | null
  plan?: string | null
  planExpiresAt?: Date | null
  trialEndDate?: Date | null
  signalsUnlocked?: boolean
  signalsExpiresAt?: Date | null
  botExpiresAt?: Date | null
  adsRemoved?: boolean
  mentorshipExpiresAt?: Date | null
  mentorshipType?: string | null
}

export function isAdminUser(u: EntitlementRow): boolean {
  return u.role === 'admin' || u.role === 'super_admin' || u.role === 'owner'
}

function isActiveEndDate(d?: Date | null): boolean {
  return !d || new Date(d).getTime() > Date.now()
}

// Legacy premium gate (kept for copy trading + existing subscribers).
// Mirrors isPremiumActive in src/lib/premium-gate.ts without a DB refetch.
export function isLegacyPremiumActive(u: EntitlementRow): boolean {
  if (isAdminUser(u)) return true
  const tier = u.subscriptionTier || ''
  if (tier === 'lifetime') return true
  if (tier === 'premium' || tier === 'premium_with_ads' || tier === 'pro') {
    return isActiveEndDate(u.subscriptionEndDate)
  }
  const plan = u.plan || ''
  if (plan === 'premium' || plan === 'pro' || plan === 'enterprise' || plan === 'unlimited') {
    return isActiveEndDate(u.planExpiresAt)
  }
  return false
}

export function isTrialActive(u: EntitlementRow): boolean {
  return u.subscriptionTier === 'trial' && isActiveEndDate(u.trialEndDate)
}

export interface Entitlements {
  signals: boolean
  bot: boolean
  adFree: boolean
  mentorship: boolean
  legacyPremium: boolean
}

export function deriveEntitlements(u: EntitlementRow): Entitlements {
  const admin = isAdminUser(u)
  const legacy = isLegacyPremiumActive(u)
  const trial = isTrialActive(u)
  return {
    signals:
      admin || legacy || trial ||
      (u.signalsUnlocked === true && u.signalsExpiresAt != null && isActiveEndDate(u.signalsExpiresAt)),
    bot: admin || legacy || trial || (u.botExpiresAt != null && isActiveEndDate(u.botExpiresAt)),
    adFree: admin || legacy || trial || u.adsRemoved === true,
    mentorship: admin || (u.mentorshipExpiresAt != null && isActiveEndDate(u.mentorshipExpiresAt)),
    legacyPremium: legacy,
  }
}

const ENTITLEMENT_SELECT = {
  role: true,
  subscriptionTier: true,
  subscriptionEndDate: true,
  plan: true,
  planExpiresAt: true,
  trialEndDate: true,
  signalsUnlocked: true,
  signalsExpiresAt: true,
  botExpiresAt: true,
  adsRemoved: true,
  mentorshipExpiresAt: true,
  mentorshipType: true,
} as const

export async function getEntitlements(userId: string): Promise<Entitlements> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: ENTITLEMENT_SELECT,
  })
  if (!user) return { signals: false, bot: false, adFree: false, mentorship: false, legacyPremium: false }
  return deriveEntitlements(user)
}

export async function hasSignalsAccess(userId: string): Promise<boolean> {
  return (await getEntitlements(userId)).signals
}

export async function hasBotAccess(userId: string): Promise<boolean> {
  return (await getEntitlements(userId)).bot
}

export async function hasAdFree(userId: string): Promise<boolean> {
  return (await getEntitlements(userId)).adFree
}

export async function hasMentorshipAccess(userId: string): Promise<boolean> {
  return (await getEntitlements(userId)).mentorship
}

export const MENTORSHIP_PAYWALL_MESSAGE =
  '1-on-1 mentorship is a paid program — online $100 or in person $150 for 2 months.'