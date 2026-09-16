import { describe, it, expect, afterEach } from 'vitest'
import { normalizeGooglePayload, normalizeApplePayload, isSocialLoginEnabled } from '@/lib/auth/social'
import { socialAuthSchema } from '@/lib/validation'

describe('normalizeGooglePayload', () => {
  it('extracts fields from a valid Google payload', () => {
    const result = normalizeGooglePayload({
      sub: 'google-uid-123',
      email: 'user@gmail.com',
      email_verified: true,
      name: 'Test User',
      picture: 'https://example.com/photo.jpg',
    })
    expect(result).toEqual({
      providerId: 'google-uid-123',
      email: 'user@gmail.com',
      emailVerified: true,
      name: 'Test User',
      picture: 'https://example.com/photo.jpg',
    })
  })

  it('handles missing optional fields', () => {
    const result = normalizeGooglePayload({
      sub: 'uid-1',
      email: 'a@b.com',
      email_verified: false,
    })
    expect(result.providerId).toBe('uid-1')
    expect(result.email).toBe('a@b.com')
    expect(result.emailVerified).toBe(false)
    expect(result.name).toBeUndefined()
    expect(result.picture).toBeUndefined()
  })

  it('throws when sub is missing', () => {
    expect(() => normalizeGooglePayload({ email: 'a@b.com' })).toThrow('missing required fields')
  })

  it('throws when email is missing', () => {
    expect(() => normalizeGooglePayload({ sub: 'uid-1' })).toThrow('missing required fields')
  })
})

describe('normalizeApplePayload', () => {
  it('extracts fields from a valid Apple payload', () => {
    const result = normalizeApplePayload({
      sub: 'apple-uid-456',
      email: 'user@privaterelay.appleid.com',
      email_verified: true,
    })
    expect(result).toEqual({
      providerId: 'apple-uid-456',
      email: 'user@privaterelay.appleid.com',
      emailVerified: true,
    })
  })

  it('throws when sub is missing', () => {
    expect(() => normalizeApplePayload({ email: 'a@b.com' })).toThrow('missing required field (sub)')
  })

  it('throws when email is empty', () => {
    expect(() => normalizeApplePayload({ sub: 'uid-1', email: '' })).toThrow('did not return an email')
  })

  it('throws when email is undefined', () => {
    expect(() => normalizeApplePayload({ sub: 'uid-1' })).toThrow('did not return an email')
  })
})

describe('isSocialLoginEnabled', () => {
  const origGoogle = process.env.GOOGLE_CLIENT_ID
  const origApple = process.env.APPLE_CLIENT_ID

  afterEach(() => {
    if (origGoogle !== undefined) process.env.GOOGLE_CLIENT_ID = origGoogle
    else delete process.env.GOOGLE_CLIENT_ID
    if (origApple !== undefined) process.env.APPLE_CLIENT_ID = origApple
    else delete process.env.APPLE_CLIENT_ID
  })

  it('returns false for both when env vars are not set', () => {
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.APPLE_CLIENT_ID
    expect(isSocialLoginEnabled()).toEqual({ google: false, apple: false })
  })

  it('returns true for google when GOOGLE_CLIENT_ID is set', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-id.apps.googleusercontent.com'
    delete process.env.APPLE_CLIENT_ID
    expect(isSocialLoginEnabled()).toEqual({ google: true, apple: false })
  })

  it('returns true for apple when APPLE_CLIENT_ID is set', () => {
    delete process.env.GOOGLE_CLIENT_ID
    process.env.APPLE_CLIENT_ID = 'com.example.service'
    expect(isSocialLoginEnabled()).toEqual({ google: false, apple: true })
  })

  it('returns true for both when both env vars are set', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-id'
    process.env.APPLE_CLIENT_ID = 'apple-id'
    expect(isSocialLoginEnabled()).toEqual({ google: true, apple: true })
  })
})

describe('socialAuthSchema', () => {
  it('accepts valid google payload', () => {
    const result = socialAuthSchema.safeParse({ provider: 'google', token: 'a'.repeat(30) })
    expect(result.success).toBe(true)
  })

  it('accepts valid apple payload', () => {
    const result = socialAuthSchema.safeParse({ provider: 'apple', token: 'b'.repeat(30) })
    expect(result.success).toBe(true)
  })

  it('accepts optional name', () => {
    const result = socialAuthSchema.safeParse({ provider: 'google', token: 'c'.repeat(30), name: 'Test' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid provider', () => {
    const result = socialAuthSchema.safeParse({ provider: 'facebook', token: 'd'.repeat(30) })
    expect(result.success).toBe(false)
  })

  it('rejects short token', () => {
    const result = socialAuthSchema.safeParse({ provider: 'google', token: 'short' })
    expect(result.success).toBe(false)
  })
})
