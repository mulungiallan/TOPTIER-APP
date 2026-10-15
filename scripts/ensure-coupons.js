// Boot-time promo-code sync: guarantees the Product Hunt launch coupon exists
// and stays active, so the code shown on the launch page is always redeemable.
//
// Idempotent: upsert keyed on `code`. We re-assert the discount/limit/expiry on
// every boot but deliberately never touch `usedCount`, so restarts do not
// restore redemptions.
//
// Mirrors scripts/ensure-packages.js: exports main(client) so the Next.js boot
// hook (src/instrumentation.ts) can run it against the app's existing Prisma
// instance, and falls back to a standalone client for `node scripts/...` use.
const { PrismaClient } = require('../src/generated/prisma')

const COUPONS = [
  {
    code: 'PRODUCTHUNT',
    discountType: 'percentage',
    discountAmount: 30,
    maxUses: 500,
    maxPerUser: 1,
    // ~90 days from launch. Kept as a fixed date so the boot hook re-asserts the
    // same expiry instead of rolling it forward on every restart.
    expiresAt: new Date('2027-01-15T00:00:00.000Z'),
    minPlan: null,
    isActive: true,
  },
]

async function main(client) {
  const prisma = client ?? new PrismaClient()
  const ownsClient = !client

  try {
    for (const c of COUPONS) {
      await prisma.couponCode.upsert({
        where: { code: c.code },
        update: {
          discountType: c.discountType,
          discountAmount: c.discountAmount,
          maxUses: c.maxUses,
          maxPerUser: c.maxPerUser,
          expiresAt: c.expiresAt,
          minPlan: c.minPlan,
          isActive: c.isActive,
        },
        create: {
          code: c.code,
          discountType: c.discountType,
          discountAmount: c.discountAmount,
          maxUses: c.maxUses,
          maxPerUser: c.maxPerUser,
          expiresAt: c.expiresAt,
          minPlan: c.minPlan,
          isActive: c.isActive,
        },
      })
      const label =
        c.discountType === 'percentage'
          ? `${c.discountAmount}% off`
          : `$${c.discountAmount.toFixed(2)} off`
      console.log(
        `[ensure-coupons] ✓ ${c.code} (${label}, maxUses=${c.maxUses ?? '∞'}, expires=${c.expiresAt.toISOString().slice(0, 10)})`
      )
    }

    console.log('[ensure-coupons] Promo codes synced.')
  } finally {
    if (ownsClient) await prisma.$disconnect()
  }
}

module.exports = { main }

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error('[ensure-coupons] FAILED:', err)
    process.exit(1)
  })
}
