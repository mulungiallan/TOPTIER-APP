import { describe, it, expect } from 'vitest'
import { computeProgressiveLots } from '@/lib/copy-lots'

describe('computeProgressiveLots', () => {
  it('returns 0 for zero or negative balances', () => {
    expect(computeProgressiveLots(0)).toBe(0)
    expect(computeProgressiveLots(-500)).toBe(0)
  })

  it('applies the base tier below $1k', () => {
    // $100 at base 0.01/100 -> 0.01 lots
    expect(computeProgressiveLots(100)).toBe(0.01)
    // $1,000 at base -> 0.10 lots
    expect(computeProgressiveLots(1000)).toBe(0.1)
  })

  it('applies the 1.5x tier from $1k to $5k', () => {
    // $1,000 @ 1.0x = 0.10; remaining $4,000 @ 1.5x = 0.60 -> 0.70
    expect(computeProgressiveLots(5000)).toBe(0.7)
  })

  it('applies the 2x tier above $5k', () => {
    // $1,000 @1.0x=0.10 + $4,000 @1.5x=0.60 + $5,000 @2.0x=1.00 -> 1.70
    expect(computeProgressiveLots(10000)).toBe(1.7)
  })

  it('respects maxLots cap', () => {
    expect(computeProgressiveLots(100000, 0.01, 10)).toBe(10)
    expect(computeProgressiveLots(100000, 0.01, 3)).toBe(3)
  })

  it('respects minLots floor', () => {
    // $50 at base would be 0.005 -> floors to 0.01
    expect(computeProgressiveLots(50)).toBe(0.01)
  })

  it('handles custom base lot rates', () => {
    // $100 at base 0.05/100 -> 0.05
    expect(computeProgressiveLots(100, 0.05)).toBe(0.05)
  })

  it('guards against invalid inputs', () => {
    expect(computeProgressiveLots(NaN as unknown as number)).toBe(0)
    expect(computeProgressiveLots(1000, 0 as unknown as number)).toBe(0.1)
  })
})
