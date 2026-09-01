import { describe, it, expect } from 'vitest'
import {
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  paymentInitSchema,
  authRouteSchema,
  paginationSchema,
  validateBody,
  validateQuery,
} from '@/lib/validation'

describe('login schema', () => {
  it('accepts a valid login', () => {
    const r = loginSchema.safeParse({ action: 'login', email: 'User@Test.com', password: 'secret' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.email).toBe('user@test.com') // lowercased+trimmed
  })

  it('rejects invalid email', () => {
    expect(loginSchema.safeParse({ action: 'login', email: 'not-an-email', password: 'x' }).success).toBe(false)
  })

  it('rejects empty password', () => {
    expect(loginSchema.safeParse({ action: 'login', email: 'a@b.com', password: '' }).success).toBe(false)
  })
})

describe('register schema', () => {
  it('accepts a valid registration', () => {
    const r = registerSchema.safeParse({
      action: 'register',
      email: 'a@b.com',
      password: 'StrongPass1',
      name: 'Alice',
    })
    expect(r.success).toBe(true)
  })

  it('rejects weak passwords', () => {
    expect(registerSchema.safeParse({ action: 'register', email: 'a@b.com', password: 'short' }).success).toBe(false)
    expect(registerSchema.safeParse({ action: 'register', email: 'a@b.com', password: 'alllowercase1' }).success).toBe(false)
    expect(registerSchema.safeParse({ action: 'register', email: 'a@b.com', password: 'ALLUPPER1' }).success).toBe(false)
    expect(registerSchema.safeParse({ action: 'register', email: 'a@b.com', password: 'NoNumbersAtAll' }).success).toBe(false)
  })
})

describe('auth route discriminated union', () => {
  it('accepts login or register but rejects other actions', () => {
    expect(authRouteSchema.safeParse({ action: 'login', email: 'a@b.com', password: 'x' }).success).toBe(true)
    expect(authRouteSchema.safeParse({ action: 'register', email: 'a@b.com', password: 'StrongPass1' }).success).toBe(true)
    expect(authRouteSchema.safeParse({ action: 'reset', email: 'a@b.com' }).success).toBe(false)
  })
})

describe('reset password schema', () => {
  it('accepts valid payload', () => {
    expect(resetPasswordSchema.safeParse({ token: 'abc', newPassword: 'StrongPass1' }).success).toBe(true)
  })
  it('rejects missing token / weak password', () => {
    expect(resetPasswordSchema.safeParse({ token: '', newPassword: 'StrongPass1' }).success).toBe(false)
    expect(resetPasswordSchema.safeParse({ token: 'abc', newPassword: 'weak' }).success).toBe(false)
  })
})

describe('payment init schema', () => {
  it('accepts a valid provider/plan', () => {
    const r = paymentInitSchema.safeParse({ provider: 'paystack', planType: 'premium_monthly' })
    expect(r.success).toBe(true)
  })

  it('rejects unknown providers', () => {
    expect(paymentInitSchema.safeParse({ provider: 'bitcoin', planType: 'monthly' }).success).toBe(false)
  })

  it('rejects unknown plan types', () => {
    expect(paymentInitSchema.safeParse({ provider: 'stripe', planType: 'annual' }).success).toBe(false)
  })
})

describe('pagination schema', () => {
  it('coerces string numbers and caps limit at 100', () => {
    const r = paginationSchema.safeParse({ limit: '5', offset: '10' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.limit).toBe(5)
      expect(r.data.offset).toBe(10)
    }
  })

  it('rejects NaN and over-cap limits', () => {
    expect(paginationSchema.safeParse({ limit: 'abc' }).success).toBe(false)
    expect(paginationSchema.safeParse({ limit: '1000' }).success).toBe(false)
  })
})

describe('validateBody helper', () => {
  it('returns typed data on success', () => {
    const r = validateBody(paginationSchema, { limit: '7', offset: '0' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.limit).toBe(7)
  })

  it('returns a readable error message on failure', () => {
    const r = validateBody(loginSchema, { action: 'login', email: 'bad', password: '' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.length).toBeGreaterThan(0)
  })
})

describe('validateQuery helper', () => {
  it('works with URLSearchParams', () => {
    const params = new URLSearchParams('limit=3&offset=1')
    const r = validateQuery(paginationSchema, params)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.limit).toBe(3)
      expect(r.data.offset).toBe(1)
    }
  })
})