const { PrismaClient } = require('@prisma/client')
const { scryptSync, randomBytes } = require('crypto')

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64
const SALT_LENGTH = 16

function hashPassword(password) {
  const salt = randomBytes(SALT_LENGTH).toString('hex')
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString('hex')
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived}`
}

async function uniqueReferralCode(prisma) {
  for (let i = 0; i < 10; i++) {
    const code = randomBytes(4).toString('hex').toUpperCase()
    const existing = await prisma.user.findUnique({ where: { referralCode: code } })
    if (!existing) return code
  }
  throw new Error('Could not generate a unique referral code')
}

async function main() {
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('[ensure-admin] ADMIN_PASSWORD not set - skipping (existing admin password unchanged).')
    return
  }

  const prisma = new PrismaClient()
  try {
    const adminEmail = 'admin@toptier.app'
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } })

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          password: hashPassword(process.env.ADMIN_PASSWORD),
          role: 'admin',
          name: 'TOPTIER Admin',
          isEmailVerified: true,
          onboardingCompleted: true,
          subscriptionTier: 'premium',
        },
      })
      console.log('[ensure-admin] Admin password updated from ADMIN_PASSWORD.')
    } else {
      await prisma.user.create({
        data: {
          email: adminEmail,
          password: hashPassword(process.env.ADMIN_PASSWORD),
          name: 'TOPTIER Admin',
          role: 'admin',
          subscriptionTier: 'premium',
          onboardingCompleted: true,
          onboardingStep: 7,
          referralCode: await uniqueReferralCode(prisma),
          isEmailVerified: true,
          country: 'Kenya',
        },
      })
      console.log('[ensure-admin] Admin user created from ADMIN_PASSWORD.')
    }

    const verified = await prisma.user.findUnique({ where: { email: adminEmail } })
    if (!verified || verified.role !== 'admin') {
      throw new Error('Failed to verify admin account after ensure-admin ran')
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[ensure-admin] FAILED:', err)
  process.exit(1)
})