import { PrismaClient } from '@prisma/client'
import { scryptSync, randomBytes } from 'crypto'

const prisma = new PrismaClient()

// Password format matches src/lib/auth.ts: scrypt$N$r$p$salt$hash
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64
const SALT_LENGTH = 16

function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString('hex')
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString('hex')
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`
}

function generateReferralCode(): string {
  return randomBytes(4).toString('hex').toUpperCase()
}

const SIGNAL_CONFIGS = [
  { asset: 'EUR/USD', entry: 1.0842, sl: 1.0790, tp1: 1.0895, tp2: 1.0930, tp3: 1.0970, market: 'forex' },
  { asset: 'GBP/USD', entry: 1.2715, sl: 1.2660, tp1: 1.2775, tp2: 1.2810, tp3: 1.2850, market: 'forex' },
  { asset: 'BTC/USD', entry: 67250.00, sl: 66400.00, tp1: 68100.00, tp2: 69000.00, tp3: 70200.00, market: 'crypto' },
  { asset: 'ETH/USD', entry: 3540.00, sl: 3480.00, tp1: 3600.00, tp2: 3660.00, tp3: 3740.00, market: 'crypto' },
  { asset: 'XAU/USD', entry: 2345.50, sl: 2330.00, tp1: 2362.00, tp2: 2375.00, tp3: 2390.00, market: 'commodities' },
]

async function main() {
  console.log('Seeding database...')

  const existingAdmin = await prisma.user.findFirst({ where: { role: 'admin' } })
  if (existingAdmin) {
    console.log('Admin user already exists, skipping seed.')
    return
  }

  const password = process.env.ADMIN_PASSWORD || 'Admin@2024'
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('WARNING: ADMIN_PASSWORD not set — using default. Change this in production!')
  }

  let referralCode = generateReferralCode()
  let codeExists = await prisma.user.findUnique({ where: { referralCode } })
  while (codeExists) {
    referralCode = generateReferralCode()
    codeExists = await prisma.user.findUnique({ where: { referralCode } })
  }

  const admin = await prisma.user.create({
    data: {
      email: 'admin@toptier.app',
      password: hashPassword(password),
      name: 'TOPTIER Admin',
      role: 'admin',
      subscriptionTier: 'premium',
      onboardingCompleted: true,
      onboardingStep: 7,
      referralCode,
      isEmailVerified: true,
      country: 'Kenya',
    },
  })

  await prisma.watchlist.create({
    data: { userId: admin.id, name: 'My Watchlist', isDefault: true },
  })

  await prisma.signalFilter.create({
    data: { userId: admin.id, minConfidence: 50 },
  })

  console.log('Admin user created:')
  console.log('  Email: admin@toptier.app')
  console.log('  Password: (from ADMIN_PASSWORD env var — not logged for security)')

  const strategies = ['scalp', 'swing']
  const timeframes = ['5m', '15m', '1H', '4H', '1D']

  for (let i = 0; i < SIGNAL_CONFIGS.length; i++) {
    const cfg = SIGNAL_CONFIGS[i]
    const direction = Math.random() > 0.5 ? 'BUY' : 'SELL'
    const sl = direction === 'BUY' ? cfg.sl : cfg.entry + (cfg.entry - cfg.sl)
    const tp1 = direction === 'BUY' ? cfg.tp1 : cfg.entry - (cfg.tp1 - cfg.entry)
    const tp2 = direction === 'BUY' ? cfg.tp2 : cfg.entry - (cfg.tp2 - cfg.entry)
    const tp3 = direction === 'BUY' ? cfg.tp3 : cfg.entry - (cfg.tp3 - cfg.entry)
    const rr = Math.abs(tp1 - cfg.entry) / Math.max(Math.abs(cfg.entry - sl), 0.0001)
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + (i < 2 ? 1 : i < 4 ? 3 : 7))

    await prisma.signal.create({
      data: {
        type: direction,
        asset: cfg.asset,
        entryPrice: cfg.entry,
        stopLoss: sl,
        takeProfit1: tp1,
        takeProfit2: tp2,
        takeProfit3: tp3,
        riskRewardRatio: Math.round(rr * 100) / 100,
        confidence: 65 + Math.floor(Math.random() * 30),
        strategy: strategies[i % 2],
        timeframe: timeframes[i],
        reason: `AI-detected ${direction.toLowerCase()} opportunity based on technical analysis and pattern recognition.`,
        status: 'active',
        marketType: cfg.market,
        tradingSession: i % 2 === 0 ? 'european' : 'us',
        expiryDate: expiry,
        userId: admin.id,
      },
    })
  }
  console.log('Created 5 sample trading signals with realistic prices')

  const notifTypes = [
    { title: 'Welcome to TOPTIER!', message: 'Your account is ready. Explore the dashboard to get started.' },
    { title: 'Signal Alert: EUR/USD', message: 'New BUY signal detected with 87% confidence.' },
    { title: 'Subscription Active', message: 'Your Pro subscription is active. Enjoy premium features!' },
  ]

  for (const notif of notifTypes) {
    await prisma.notification.create({
      data: { userId: admin.id, title: notif.title, message: notif.message, type: 'info' },
    })
  }
  console.log('Created 3 sample notifications')

  console.log('')
  console.log('Database seeded successfully!')
}

main()
  .catch((e) => {
    console.error('Seed error:', e.message)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
