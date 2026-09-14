// ─── Referral cash milestone rewards ─────────────────────────────────────────
// Every 100 referrals a user earns $10 USD deposited into their wallet cash
// balance (usable for withdrawals, competitions, or premium). Rewards are
// tracked via ReferralReward rows with rewardType 'wallet_cash' so they can
// never be double-granted, even if called from multiple places concurrently /
// repeatedly (ledger postings are idempotent by reference).

import { db } from '@/lib/db'
import { depositCash } from './wallet'

export const REFERRAL_MILESTONE_COUNT = 100
export const REFERRAL_CASH_REWARD = 10

/**
 * Grant every earned-but-not-yet-paid $10 wallet milestone for a user.
 * Safe to call on any read of a user's referral data — existing users who
 * already crossed 100 (or more) referrals get backfilled automatically.
 */
export async function grantReferralCashMilestones(userId: string): Promise<{
  granted: number
  totalMilestones: number
}> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { referralCount: true },
  })
  if (!user) return { granted: 0, totalMilestones: 0 }

  const totalMilestones = Math.floor((user.referralCount || 0) / REFERRAL_MILESTONE_COUNT)
  if (totalMilestones <= 0) return { granted: 0, totalMilestones: 0 }

  const alreadyGranted = await db.referralReward.count({
    where: { userId, rewardType: 'wallet_cash' },
  })

  const toGrant = totalMilestones - alreadyGranted
  if (toGrant <= 0) return { granted: 0, totalMilestones }

  let granted = 0
  for (let i = 0; i < toGrant; i++) {
    const milestoneNum = alreadyGranted + i + 1
    const reference = `REFERRAL_MILESTONE_${userId}_${milestoneNum}`
    // depositCash is idempotent by (txType, reference) — safe under races.
    await depositCash({
      userId,
      asset: 'USD',
      amount: REFERRAL_CASH_REWARD,
      reference,
      memo: `Referral milestone: ${milestoneNum * REFERRAL_MILESTONE_COUNT} referrals — $${REFERRAL_CASH_REWARD} USD reward`,
    })
    await db.referralReward.create({
      data: {
        userId,
        rewardType: 'wallet_cash',
        rewardAmount: REFERRAL_CASH_REWARD,
        status: 'granted',
        reason: `Reached ${milestoneNum * REFERRAL_MILESTONE_COUNT} referrals — $${REFERRAL_CASH_REWARD} USD wallet cash`,
      },
    })
    granted++
  }

  return { granted, totalMilestones }
}