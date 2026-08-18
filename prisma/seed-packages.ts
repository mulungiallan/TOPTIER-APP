/**
 * Premium Packages Seed Script
 *
 * Usage:
 *   npx tsx prisma/seed-packages.ts
 *
 * Idempotent: re-running updates existing packages.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface SeedPackage {
  name: string
  description: string
  duration: 'monthly' | 'annual'
  price: number
  analyses: number
  splitRatio: number
  features: string[]
  isPopular?: boolean
}

const packages: SeedPackage[] = [
  // ─── Monthly ──────────────────────────────────────────────────────────────
  {
    name: 'Starter',
    description: 'Perfect for casual traders getting started with AI analysis.',
    duration: 'monthly',
    price: 19.99,
    analyses: 50,
    splitRatio: 90,
    features: [
      '50 analyses per month',
      '90% premium AI accuracy',
      'Basic chart pattern recognition',
      'Support / Resistance levels',
      'BUY / SELL / HOLD signals',
      'Email support',
    ],
  },
  {
    name: 'Premium',
    description: 'Most popular — built for active daily traders.',
    duration: 'monthly',
    price: 29.99,
    analyses: 100,
    splitRatio: 90,
    isPopular: true,
    features: [
      '100 analyses per month',
      '90% premium AI accuracy',
      'Advanced pattern recognition',
      'Multi-timeframe analysis',
      'Risk / Reward calculation',
      'Stop Loss & Take Profit levels',
      'Email notifications',
      'Priority support',
    ],
  },
  {
    name: 'Pro',
    description: 'For serious traders who live in the markets.',
    duration: 'monthly',
    price: 49.99,
    analyses: 200,
    splitRatio: 92,
    features: [
      '200 analyses per month',
      '92% AI accuracy (ensemble)',
      'All Premium features',
      'Export to PDF / CSV / Excel',
      'SMS alerts',
      'Unlimited watchlist',
      'Unlimited price alerts',
      '24/7 priority support',
    ],
  },
  {
    name: 'Enterprise',
    description: 'For professional traders and small teams.',
    duration: 'monthly',
    price: 99.99,
    analyses: 500,
    splitRatio: 95,
    features: [
      '500 analyses per month',
      '95% AI accuracy (ensemble)',
      'All Pro features',
      'Dedicated account manager',
      'Custom indicators',
      'API access',
      'White-label reports',
      'SLA guarantee',
    ],
  },
  {
    name: 'Unlimited',
    description: 'Unlimited analyses for power users and teams.',
    duration: 'monthly',
    price: 199.99,
    analyses: 0, // 0 = unlimited
    splitRatio: 90,
    features: [
      'Unlimited analyses',
      '90% premium AI accuracy',
      'All Enterprise features',
      'Priority processing',
      'Custom AI models',
      'Team accounts (up to 5)',
      'Training & onboarding',
    ],
  },

  // ─── Annual (20% discount) ────────────────────────────────────────────────
  {
    name: 'Starter Annual',
    description: 'Save 20% with annual billing.',
    duration: 'annual',
    price: 191.90, // 19.99 * 12 * 0.8
    analyses: 600, // 50 * 12
    splitRatio: 90,
    features: ['All Starter features', '20% annual discount', 'Priority support'],
  },
  {
    name: 'Premium Annual',
    description: 'Save 20% with annual billing.',
    duration: 'annual',
    price: 287.90, // 29.99 * 12 * 0.8
    analyses: 1200, // 100 * 12
    splitRatio: 90,
    features: ['All Premium features', '20% annual discount', 'Priority support'],
  },
  {
    name: 'Pro Annual',
    description: 'Save 20% with annual billing.',
    duration: 'annual',
    price: 479.90, // 49.99 * 12 * 0.8
    analyses: 2400, // 200 * 12
    splitRatio: 92,
    features: ['All Pro features', '20% annual discount', 'Dedicated support'],
  },
  {
    name: 'Enterprise Annual',
    description: 'Save 20% with annual billing.',
    duration: 'annual',
    price: 959.90, // 99.99 * 12 * 0.8
    analyses: 6000, // 500 * 12
    splitRatio: 95,
    features: ['All Enterprise features', '20% annual discount', 'Dedicated account manager'],
  },
]

async function main() {
  console.log('🌱 Seeding premium packages...\n')

  for (const pkg of packages) {
    const result = await prisma.package.upsert({
      where: { name: pkg.name },
      update: {
        description: pkg.description,
        duration: pkg.duration,
        price: pkg.price,
        analyses: pkg.analyses,
        splitRatio: pkg.splitRatio,
        features: JSON.stringify(pkg.features),
        isPopular: pkg.isPopular ?? false,
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
        isPopular: pkg.isPopular ?? false,
        isActive: true,
      },
    })
    console.log(`  ✓ ${result.name.padEnd(20)} $${result.price.toFixed(2).padStart(8)}  ${result.analyses === 0 ? 'unlimited' : `${result.analyses} analyses`.padEnd(15)}  ${result.splitRatio}/${100 - result.splitRatio} split`)
  }

  console.log(`\n✅ Seeded ${packages.length} packages successfully!`)
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
