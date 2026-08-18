import { describe, it, expect } from 'vitest'
import {
  convertCurrency,
  formatCurrency,
  getLocalizedPrice,
  currencyList,
  getRateSource,
} from '@/lib/currency'

describe('currency module', () => {
  it('exposes the full static currency table', () => {
    expect(currencyList.length).toBeGreaterThanOrEqual(26)
    const codes = currencyList.map((c) => c.code)
    for (const code of ['USD', 'EUR', 'KES', 'NGN', 'INR']) {
      expect(codes).toContain(code)
    }
  })

  it('converts between currencies using fallback rates', () => {
    // 100 USD -> KES (rate 130) = 13,000
    expect(convertCurrency(100, 'USD', 'KES')).toBeCloseTo(13000, 2)
    // 1300 KES -> USD = 10
    expect(convertCurrency(1300, 'KES', 'USD')).toBeCloseTo(10, 2)
    // USD -> USD is identity
    expect(convertCurrency(42, 'USD', 'USD')).toBeCloseTo(42, 2)
  })

  it('falls back to 1.0 for unknown currencies', () => {
    expect(convertCurrency(10, 'USD', 'XXX')).toBeCloseTo(10, 2)
  })

  it('formats currency with locale decimals', () => {
    expect(formatCurrency(100, 'USD')).toBe('$100.00')
    expect(formatCurrency(100, 'KES')).toContain('KSh')
    expect(formatCurrency(100, 'JPY')).toContain('¥')
  })

  it('formats compact values', () => {
    expect(formatCurrency(2500, 'USD', { compact: true })).toBe('$2.5K')
    expect(formatCurrency(1500000, 'USD', { compact: true })).toBe('$1.5M')
  })

  it('applies PPP discounts per country', () => {
    const ke = getLocalizedPrice(29, 'KE')
    expect(ke.discountPct).toBe(60)
    expect(ke.discountedPrice).toBeCloseTo(29 * 0.4, 2)
    expect(ke.currency).toBe('KES')
    expect(ke.region).toBe('Kenya')

    const us = getLocalizedPrice(29, 'US')
    expect(us.discountPct).toBe(0)
    expect(us.discountedPrice).toBe(29)
    expect(us.currency).toBe('USD')
  })

  it('treats unknown countries as standard global pricing', () => {
    const r = getLocalizedPrice(10, 'ZZ')
    expect(r.discountPct).toBe(0)
    expect(r.region).toBe('Global')
    expect(r.currency).toBe('USD')
  })

  it('getRateSource reports fallback before any fetch', () => {
    expect(getRateSource().source).toBe('fallback')
  })
})
