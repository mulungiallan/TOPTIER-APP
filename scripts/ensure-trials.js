// Boot-time backfill: grants a one-time 7-day full-Premium trial to existing
// accounts that have never used one. New registrations (email + social) are
// granted the trial inline at sign-up, so in steady state this only affects
// the pre-change backlog.
//
// Idempotent: it targets only users whose `trialStartDate` is still NULL, and
// setting that column makes them ineligible on every later run. Premium /
// lifetime subscribers and staff are skipped (they already have more access).
const { PrismaClient } = require('../src/generated/prisma')

const TRIAL_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

async function main(client) {
  const prisma = client ?? new PrismaClient()
  const ownsClient = !client

  try {
    const now = new Date()
    const trialEnd = new Date(now.getTime() + TRIAL_DAYS * DAY_MS)

    const result = await prisma.user.updateMany({
      where: {
        trialStartDate: null,
        // Never touch anyone on a paid tier or paid plan: overwriting
        // subscriptionTier/subscriptionEndDate would strip legacy premium
        // access (isLegacyPremiumActive) once the trial window lapses.
        subscriptionTier: { notIn: ['premium', 'premium_with_ads', 'pro', 'lifetime'] },
        plan: { notIn: ['premium', 'pro', 'enterprise', 'unlimited'] },
        role: { notIn: ['admin', 'super_admin', 'owner'] },
      },
      data: {
        subscriptionTier: 'trial',
        trialStartDate: now,
        trialEndDate: trialEnd,
        subscriptionStartDate: now,
        subscriptionEndDate: trialEnd,
      },
    })

    if (result.count > 0) {
      console.log(`[ensure-trials] Granted ${TRIAL_DAYS}-day Premium trial to ${result.count} existing user(s).`)
    } else {
      console.log('[ensure-trials] No users needed a trial grant.')
    }
  } finally {
    if (ownsClient) await prisma.$disconnect()
  }
}

module.exports = { main }

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('[ensure-trials] FAILED:', err)
    process.exit(1)
  })
}
