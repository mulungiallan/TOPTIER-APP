import { db } from '@/lib/db'

// Invite-only gate for bot trading and copy trading. Users unlock these
// features by registering through a valid referral link (they end up with a
// `referredBy` referrer id). Admins are always exempt so the owner can test
// and operate the platform even without a referral chain.
//
// Environment overrides:
//   REFERRAL_LOCK_ENABLED=false  -> disable the gate entirely (default: on)
//   REFERRAL_LOCK_CODE=<code>    -> only users referred by THIS code unlock
//   REFERRAL_LOCK_URL=<url>      -> referral link shown on the lock screen
export const REFERRAL_LOCK_MESSAGE =
  'Invite-only access — bot trading and copy trading unlock when you sign up through an active referral link.'

export function referralLockEnabled(): boolean {
  return process.env.REFERRAL_LOCK_ENABLED !== 'false'
}

export function getReferralLockCode(): string | null {
  return process.env.REFERRAL_LOCK_CODE || null
}

export function getReferralUrl(): string | null {
  return process.env.REFERRAL_LOCK_URL || null
}

export async function isReferralUnlocked(userId: string): Promise<boolean> {
  if (!referralLockEnabled()) return true

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, referredBy: true },
  })
  if (!user) return false
  if (user.role === 'admin' || user.role === 'super_admin') return true
  if (!user.referredBy) return false

  const lockCode = getReferralLockCode()
  if (!lockCode) return true

  const referrer = await db.user.findUnique({
    where: { id: user.referredBy },
    select: { referralCode: true },
  })
  return !!referrer && referrer.referralCode === lockCode
}

export async function assertReferralUnlocked(userId: string): Promise<void> {
  if (!(await isReferralUnlocked(userId))) {
    const err = new Error(REFERRAL_LOCK_MESSAGE) as Error & { status?: number }
    err.status = 403
    throw err
  }
}
