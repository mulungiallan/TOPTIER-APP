import { describe, it, expect } from 'vitest'
import { classifyAccountTier } from '@/lib/account-tiers'

describe('classifyAccountTier', () => {
  it('returns Unknown for missing balances', () => {
    const r = classifyAccountTier(null, {})
    expect(r.tier).toBeNull()
    expect(r.maxEntries).toBeNull()
    expect(r.label).toBe('Unknown')
  })

  it('classifies small accounts (<= $50 default)', () => {
    const r = classifyAccountTier(30, {})
    expect(r.tier).toBe('small')
    expect(r.maxEntries).toBe(3)
    expect(r.maxLot).toBe(0.02)
    expect(r.metalsEnabled).toBe(true)
    expect(r.scalpingProfile).toBe(false)
  })

  it('classifies mid accounts ($50–$100 default)', () => {
    const r = classifyAccountTier(75, {})
    expect(r.tier).toBe('mid')
    expect(r.maxEntries).toBe(2)
    expect(r.maxLot).toBe(0.02)
    expect(r.scalpingProfile).toBe(true)
  })

  it('boundary at $50 is small, just above is mid', () => {
    expect(classifyAccountTier(50, {}).tier).toBe('small')
    expect(classifyAccountTier(50.01, {}).tier).toBe('mid')
    expect(classifyAccountTier(100, {}).tier).toBe('mid')
    expect(classifyAccountTier(100.01, {}).tier).toBe('standard')
  })

  it('classifies standard accounts above $100', () => {
    const r = classifyAccountTier(5000, {})
    expect(r.tier).toBe('standard')
    expect(r.maxLot).toBeNull()
  })

  it('honors custom tier thresholds from settings', () => {
    const settings = {
      ACCOUNT_TIER_SMALL_MAX_EQUITY: 25,
      ACCOUNT_TIER_MID_MAX_EQUITY: 60,
      ACCOUNT_TIER_SMALL_MAX_ENTRIES: 4,
      ACCOUNT_TIER_SMALL_MAX_LOT: 0.01,
      ACCOUNT_TIER_MID_MAX_ENTRIES: 1,
      ACCOUNT_TIER_MID_MAX_LOT: 0.05,
      ACCOUNT_TIER_MID_ENABLE_METALS: false,
      ACCOUNT_TIER_MID_SCALP_PROFILE: false,
    }
    const small = classifyAccountTier(20, settings)
    expect(small.tier).toBe('small')
    expect(small.maxEntries).toBe(4)
    expect(small.maxLot).toBe(0.01)

    const mid = classifyAccountTier(40, settings)
    expect(mid.tier).toBe('mid')
    expect(mid.metalsEnabled).toBe(false)
    expect(mid.scalpingProfile).toBe(false)
  })

  it('uses MAX_OPEN_POSITIONS for standard accounts', () => {
    const r = classifyAccountTier(500, { MAX_OPEN_POSITIONS: 5 })
    expect(r.tier).toBe('standard')
    expect(r.maxEntries).toBe(5)
  })
})
