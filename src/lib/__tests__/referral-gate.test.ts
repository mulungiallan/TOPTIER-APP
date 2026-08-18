import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: { user: { findUnique: vi.fn() } },
}))

import { db } from '@/lib/db'
import {
  referralLockEnabled,
  getReferralLockCode,
  getReferralUrl,
  REFERRAL_LOCK_MESSAGE,
  isReferralUnlocked,
  assertReferralUnlocked,
} from '@/lib/referral-gate'

const findUnique = db.user.findUnique as unknown as ReturnType<typeof vi.fn>

describe('referral-gate', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...savedEnv }
    delete process.env.REFERRAL_LOCK_ENABLED
    delete process.env.REFERRAL_LOCK_CODE
    delete process.env.REFERRAL_LOCK_URL
  })

  afterEach(() => {
    process.env = savedEnv
  })

  it('is enabled by default', () => {
    expect(referralLockEnabled()).toBe(true)
  })

  it('can be disabled via env', () => {
    process.env.REFERRAL_LOCK_ENABLED = 'false'
    expect(referralLockEnabled()).toBe(false)
  })

  it('reads the lock code and URL', () => {
    process.env.REFERRAL_LOCK_CODE = 'ABC'
    process.env.REFERRAL_LOCK_URL = 'https://example.com/register?ref=ABC'
    expect(getReferralLockCode()).toBe('ABC')
    expect(getReferralUrl()).toBe('https://example.com/register?ref=ABC')
  })

  it('unlocks everyone when the gate is disabled', async () => {
    process.env.REFERRAL_LOCK_ENABLED = 'false'
    expect(await isReferralUnlocked('anyone')).toBe(true)
  })

  it('locks users with no referredBy', async () => {
    findUnique.mockResolvedValueOnce({ role: 'user', referredBy: null })
    expect(await isReferralUnlocked('u1')).toBe(false)
  })

  it('unlocks admins regardless of referral', async () => {
    findUnique.mockResolvedValueOnce({ role: 'admin', referredBy: null })
    expect(await isReferralUnlocked('u1')).toBe(true)
  })

  it('unlocks referred users when no lock code is configured', async () => {
    findUnique.mockResolvedValueOnce({ role: 'user', referredBy: 'r1' })
    expect(await isReferralUnlocked('u1')).toBe(true)
  })

  it('unlocks only users referred by the lock code when configured', async () => {
    process.env.REFERRAL_LOCK_CODE = '86446820'
    findUnique.mockResolvedValueOnce({ role: 'user', referredBy: 'r1' })
    findUnique.mockResolvedValueOnce({ role: 'user', referredBy: 'r1', referralCode: '86446820' })
    expect(await isReferralUnlocked('u1')).toBe(true)

    vi.clearAllMocks()
    findUnique.mockResolvedValueOnce({ role: 'user', referredBy: 'r2' })
    findUnique.mockResolvedValueOnce({ role: 'user', referredBy: 'r2', referralCode: 'OTHER' })
    expect(await isReferralUnlocked('u2')).toBe(false)
  })

  it('assertReferralUnlocked throws 403 when locked', async () => {
    findUnique.mockResolvedValueOnce({ role: 'user', referredBy: null })
    await expect(assertReferralUnlocked('u1')).rejects.toMatchObject({ status: 403, message: REFERRAL_LOCK_MESSAGE })
  })

  it('assertReferralUnlocked resolves when unlocked', async () => {
    findUnique.mockResolvedValueOnce({ role: 'admin', referredBy: null })
    await expect(assertReferralUnlocked('u1')).resolves.toBeUndefined()
  })
})
