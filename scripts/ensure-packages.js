// Boot-time catalog sync: makes sure the sellable Premium packages are the
// daily / weekly / quarterly / yearly tiers, and legacy packages are inactive.
// Mirrors prisma/seed-packages.ts so the catalog is stable across restarts.
const { PrismaClient } = require('@prisma/client')

const PACKAGES = [
  {
    name: 'Premium Daily',
    description: 'One day of full Premium access.',
    duration: 'daily',
    price: 1.5,
    analyses: 0,
    splitRatio: 90,
    isPopular: false,
    features: [
      'No ads',
      'Trading bot access',
      'TOPTIER signals',
      'Copy trading',
      'Real-time instant signals',
      'All market coverage',
      'AI screenshot analysis',
      'Custom alerts',
      'Priority support',
    ],
  },
  {
    name: 'Premium Weekly',
    description: 'Seven days of full Premium access.',
    duration: 'weekly',
    price: 7,
    analyses: 0,
    splitRatio: 90,
    isPopular: true,
    features: [
      'No ads',
      'Trading bot access',
      'TOPTIER signals',
      'Copy trading',
      'Real-time instant signals',
      'All market coverage',
      'AI screenshot analysis',
      'Custom alerts',
      'Priority support',
    ],
  },
  {
    name: 'Premium Quarterly',
    description: 'Three months of full Premium access.',
    duration: 'quarterly',
    price: 75,
    analyses: 0,
    splitRatio: 90,
    isPopular: false,
    features: [
      'No ads',
      'Trading bot access',
      'TOPTIER signals',
      'Copy trading',
      'Real-time instant signals',
      'All market coverage',
      'AI screenshot analysis',
      'Custom alerts',
      'Data export (CSV/Excel)',
      'Early access to features',
      'Priority support',
    ],
  },
  {
    name: 'Premium Yearly',
    description: 'A full year of Premium — best value.',
    duration: 'annual',
    price: 120,
    analyses: 0,
    splitRatio: 90,
    isPopular: false,
    features: [
      'No ads',
      'Trading bot access',
      'TOPTIER signals',
      'Copy trading',
      'Real-time instant signals',
      'All market coverage',
      'AI screenshot analysis',
      'Custom alerts',
      'Data export (CSV/Excel)',
      'Early access to features',
      'Exclusive webinars',
      'Priority support',
    ],
  },
]

const LEGACY_NAMES = [
  'Starter',
  'Premium',
  'Pro',
  'Enterprise',
  'Unlimited',
  'Starter Annual',
  'Premium Annual',
  'Pro Annual',
  'Enterprise Annual',
]

async function main() {
  const prisma = new PrismaClient()

  try {
    const legacy = await prisma.package.updateMany({
      where: { name: { in: LEGACY_NAMES } },
      data: { isActive: false },
    })
    if (legacy.count > 0) {
      console.log(`[ensure-packages] Deactivated ${legacy.count} legacy package(s)`)
    }

    for (const pkg of PACKAGES) {
      await prisma.package.upsert({
        where: { name: pkg.name },
        update: {
          description: pkg.description,
          duration: pkg.duration,
          price: pkg.price,
          analyses: pkg.analyses,
          splitRatio: pkg.splitRatio,
          features: JSON.stringify(pkg.features),
          isPopular: pkg.isPopular,
          isActive: true,
        },
        create: {
          name: pkg.name,
          description: pkg.description,
          duration: pkg.duration,
          price: pkg.price,
          analyses: pkg.analyses,
          splitRatio: pkg.splitRatio,
          features: JSON.stringify(pkg.features),
          isPopular: pkg.isPopular,
          isActive: true,
        },
      })
      console.log(`[ensure-packages] ✓ ${pkg.name} $${pkg.price.toFixed(2)} (${pkg.duration})`)
    }

    console.log('[ensure-packages] Package catalog synced.')
  } finally {
    await prisma.$disconnect()
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[ensure-packages] FAILED:', err)
  process.exit(1)
})