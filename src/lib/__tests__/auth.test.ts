import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import jwt from 'jsonwebtoken'
import {
  generateToken,
  verifyToken,
  getJwtSecret,
  verifyPassword,
  needsRehash,
  rehashPassword,
  generateReferralCode,
} from '@/lib/auth'

const ORIGINAL_SECRET = process.env.NEXTAUTH_SECRET

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-at-least-32-characters-long'
})

afterAll(() => {
  if (ORIGINAL_SECRET) process.env.NEXTAUTH_SECRET = ORIGINAL_SECRET
  else delete process.env.NEXTAUTH_SECRET
})

describe('JWT tokens', () => {
  it('signs and verifies a token with userId', () => {
    const token = generateToken('user-123')
    const decoded = verifyToken(token)
    expect(decoded).not.toBeNull()
    expect(decoded!.userId).toBe('user-123')
  })

  it('embeds the provided tokenVersion', () => {
    const token = generateToken('user-1', { tokenVersion: 4 })
    const decoded = verifyToken(token)
    expect(decoded!.tokenVersion).toBe(4)
  })

  it('defaults tokenVersion to 0 when not supplied', () => {
    const token = generateToken('user-1')
    const decoded = verifyToken(token)
    expect(decoded!.tokenVersion).toBe(0)
  })

  it('rejects a tampered token', () => {
    const token = generateToken('user-1')
    const [h, p, s] = token.split('.')
    const forgedPayload = Buffer.from(JSON.stringify({ userId: 'attacker', tokenVersion: 0 })).toString('base64url')
    const forged = `${h}.${forgedPayload}.${s}`
    expect(verifyToken(forged)).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    const token = jwt.sign({ userId: 'x' }, 'wrong-secret-that-is-long-enough-000')
    expect(verifyToken(token)).toBeNull()
  })

  it('rejects garbage input', () => {
    expect(verifyToken('not.a.jwt')).toBeNull()
    expect(verifyToken('')).toBeNull()
    expect(verifyToken(null as unknown as string)).toBeNull()
  })

  it('requires a string userId claim', () => {
    const token = jwt.sign({ userId: 123 }, getJwtSecret())
    expect(verifyToken(token)).toBeNull()
  })

  it('expires tokens after the TTL', () => {
    const token = generateToken('user-1', { expiresInMs: -1000 })
    const decoded = verifyToken(token)
    // jsonwebtoken should reject expired tokens
    expect(decoded).toBeNull()
  })
})

describe('password hashing', () => {
  it('hashes to the scrypt format', () => {
    const hash = rehashPassword('Aa1password')
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/)
  })

  it('round-trips verify', async () => {
    const hash = rehashPassword('Aa1password')
    expect(await verifyPassword('Aa1password', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  it('produces unique salts', () => {
    const a = rehashPassword('Aa1password')
    const b = rehashPassword('Aa1password')
    expect(a).not.toBe(b)
  })

  it('reports legacy hashes as needing rehash', () => {
    expect(needsRehash('not-scrypt')).toBe(true)
    expect(needsRehash(`scrypt$16384$8$1$${'0'.repeat(32)}${'0'.repeat(128)}`)).toBe(false)
  })

  it('rejects empty stored hashes', async () => {
    expect(await verifyPassword('pw', '')).toBe(false)
  })

  it('handles non-scrypt legacy hashes via the legacy path without crashing', async () => {
    const legacy = 'sha256-sample-hash'
    // Should not throw and should return false for mismatched expectations
    const result = await verifyPassword('anything', legacy)
    expect(typeof result).toBe('boolean')
  })
})

describe('referral codes', () => {
  it('generates uppercase hex codes', () => {
    const code = generateReferralCode()
    expect(code).toMatch(/^[0-9A-F]{8}$/)
  })
})