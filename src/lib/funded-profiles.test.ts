// Tests for the app-side mirror of the FundingPips rules in
// mini-services/funded_bot/profiles.py + guard.py's validate().
//
// The point of this file: a funded user must never be shown limits that differ
// from what the Python guard will actually enforce. If profiles.py changes, the
// numbers here must change with it.

import { describe, it, expect } from 'vitest'
import {
  FUNDED_MODELS,
  FUNDED_SIZES,
  FUNDED_PHASES_FOR,
  buildFundedProfile,
  validateFundedRisk,
  fundedSoftFloors,
  normaliseFundedConfig,
  FUNDED_GUARD_DEFAULTS,
} from './funded-profiles'

describe('buildFundedProfile', () => {
  it('rejects an unknown model', () => {
    expect(() => buildFundedProfile('ftmo', 'master', 100000)).toThrow(/Unknown funded model/)
  })

  it('rejects a phase the model does not offer', () => {
    // Zero only has master.
    expect(() => buildFundedProfile('zero', 'phase1', 100000)).toThrow(/phases master/)
  })

  it('rejects an account size the model does not offer', () => {
    // 1step_flex tops out at 100000.
    expect(() => buildFundedProfile('1step_flex', 'master', 250000)).toThrow(/sizes are/)
  })

  it('builds the Zero profile with a trailing lock', () => {
    const p = buildFundedProfile('zero', 'master', 100000)
    expect(p.dailyLossPct).toBe(3)
    expect(p.maxLossPct).toBe(5)
    expect(p.maxLossMode).toBe('trailing_lock')
    expect(p.trailLockProfitPct).toBe(5)
    expect(p.openRiskPct).toBe(1)
    expect(p.profitableDaysNeeded).toBe(7)
    // Zero is news restricted with no weekend holds.
    expect(p.newsRestricted).toBe(true)
    expect(p.weekendHoldAllowed).toBe(false)
  })

  it('lowers the per-idea limit on larger Zero accounts', () => {
    expect(buildFundedProfile('zero', 'master', 25000).ideaLimitPct).toBe(3)
    expect(buildFundedProfile('zero', 'master', 50000).ideaLimitPct).toBe(2)
  })

  it('uses static max loss for the flex models', () => {
    for (const model of ['1step_flex', '2step_flex'] as const) {
      const p = buildFundedProfile(model, 'master', 50000)
      expect(p.maxLossMode).toBe('static')
      expect(p.maxLossPct).toBe(12)
    }
  })

  it('gives 2step_flex a 4% daily limit while others get 3%', () => {
    expect(buildFundedProfile('2step_flex', 'master', 50000).dailyLossPct).toBe(4)
    expect(buildFundedProfile('2step_pro', 'master', 50000).dailyLossPct).toBe(3)
  })

  it('sets evaluation targets per phase and clears them on master', () => {
    expect(buildFundedProfile('2step_standard', 'phase1', 50000).targetPct).toBe(8)
    expect(buildFundedProfile('2step_standard', 'phase2', 50000).targetPct).toBe(5)
    expect(buildFundedProfile('2step_standard', 'master', 50000).targetPct).toBeNull()
  })

  it('switches 2step_flex to a 3-profitable-day rule on the 95% split', () => {
    expect(buildFundedProfile('2step_flex', 'master', 50000, 95).profitableDaysNeeded).toBe(3)
    expect(buildFundedProfile('2step_flex', 'master', 50000, 80).profitableDaysNeeded).toBeNull()
  })

  it('restricts news and weekend holds only on master, except Zero', () => {
    const phase1 = buildFundedProfile('2step_pro', 'phase1', 50000)
    expect(phase1.newsRestricted).toBe(false)
    expect(phase1.weekendHoldAllowed).toBe(true)

    const master = buildFundedProfile('2step_pro', 'master', 50000)
    expect(master.newsRestricted).toBe(true)
    expect(master.weekendHoldAllowed).toBe(false)
  })

  it('carries a note for every limit the source rules did not state', () => {
    expect(buildFundedProfile('zero', 'master', 100000).notes.length).toBeGreaterThan(0)
    expect(buildFundedProfile('2step_standard', 'master', 50000).notes.length).toBeGreaterThan(0)
    expect(buildFundedProfile('2step_pro', 'master', 50000).notes.length).toBeGreaterThan(0)
  })

  it('covers every model/phase/size combination it advertises', () => {
    for (const model of FUNDED_MODELS) {
      for (const phase of FUNDED_PHASES_FOR[model]) {
        for (const size of FUNDED_SIZES[model]) {
          expect(() => buildFundedProfile(model, phase, size)).not.toThrow()
        }
      }
    }
  })
})

describe('validateFundedRisk', () => {
  const zero = buildFundedProfile('zero', 'master', 100000)

  it('accepts the default guard settings', () => {
    expect(validateFundedRisk(zero)).toBeNull()
  })

  it('rejects a same-pair cooldown below the 10-minute rule', () => {
    expect(validateFundedRisk(zero, { symbol_cooldown_min: 5 })).toMatch(/at least 10 minutes/)
  })

  it('rejects risk x positions that exceed the open-risk soft cap', () => {
    // Zero: 1% open risk, soft cap 0.7%. 1% x 2 positions = 2% > 0.7%.
    const msg = validateFundedRisk(zero, { risk_per_trade_pct: 1, max_positions: 2 })
    expect(msg).toMatch(/open-risk soft cap/)
  })

  it('rejects a worst-case day past the daily soft limit', () => {
    // Uses 2step_flex because Zero trips the open-risk cap first, which would
    // mask this rule. 4% daily => 2% soft limit. loss stop 0.5% + 2 x 1% = 2.5%.
    const flex = buildFundedProfile('2step_flex', 'master', 100000)
    const msg = validateFundedRisk(flex, { risk_per_trade_pct: 1, max_positions: 2 })
    expect(msg).toMatch(/Worst-case day/)
  })

  it('does not apply the open-risk cap to models without one', () => {
    const flex = buildFundedProfile('2step_flex', 'master', 100000)
    expect(flex.openRiskPct).toBeNull()
    // A larger per-trade risk is still capped by the worst-case-day rule, but
    // the specific open-risk message must not fire.
    const msg = validateFundedRisk(flex, { risk_per_trade_pct: 0.25, max_positions: 2 })
    expect(msg).toBeNull()
  })

  it('rejects a non-positive risk or a zero position count', () => {
    expect(validateFundedRisk(zero, { risk_per_trade_pct: 0 })).toMatch(/positive/)
    expect(validateFundedRisk(zero, { max_positions: 0 })).toMatch(/at least 1/)
  })

  it('keeps the worst-case-day headroom at the default settings', () => {
    const { risk_per_trade_pct, max_positions, daily_loss_stop_pct, soft_frac } =
      FUNDED_GUARD_DEFAULTS
    const worst = daily_loss_stop_pct + max_positions * risk_per_trade_pct
    const limit = soft_frac * zero.dailyLossPct
    expect(worst).toBeLessThanOrEqual(limit)
  })
})

describe('fundedSoftFloors', () => {
  it('halves the distance to each hard limit', () => {
    const f = fundedSoftFloors(buildFundedProfile('zero', 'master', 100000))
    // 3% of 100k = 3000 hard, floor at 50% of that distance = 98500.
    expect(f.dailyHard).toBe(97000)
    expect(f.dailyFloor).toBe(98500)
    // 5% of 100k = 5000 hard, floor = 97500.
    expect(f.maxHard).toBe(95000)
    expect(f.maxFloor).toBe(97500)
  })

  it('scales with account size', () => {
    const f = fundedSoftFloors(buildFundedProfile('zero', 'master', 50000))
    expect(f.dailyFloor).toBe(49250)
    expect(f.maxFloor).toBe(48750)
  })
})

describe('normaliseFundedConfig', () => {
  it('accepts a valid profile and normalises it', () => {
    const res = normaliseFundedConfig({ model: 'zero', phase: 'master', size: 100000 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.config.model).toBe('zero')
    expect(res.config.split).toBe(80)
    expect(res.config.avoidNews).toBe(true)
    expect(res.config.dryRun).toBe(false)
    expect(res.config.peakEquity).toBeNull()
  })

  it('uppercases and trims symbols', () => {
    const res = normaliseFundedConfig({
      model: 'zero', phase: 'master', size: 50000, symbols: [' eurusd ', 'xauusd'],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.config.symbols).toEqual(['EURUSD', 'XAUUSD'])
  })

  it('keeps a peak equity and coerces the split', () => {
    const res = normaliseFundedConfig({
      model: 'zero', phase: 'master', size: 100000, peakEquity: 104500, split: 95,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.config.peakEquity).toBe(104500)
    expect(res.config.split).toBe(95)
  })

  it('drops a non-positive peak equity', () => {
    const res = normaliseFundedConfig({
      model: 'zero', phase: 'master', size: 100000, peakEquity: 0,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.config.peakEquity).toBeNull()
  })

  it('rejects an unsafe guard override', () => {
    const res = normaliseFundedConfig({
      model: 'zero', phase: 'master', size: 100000,
      guard: { risk_per_trade_pct: 1, max_positions: 2 },
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/open-risk soft cap/)
  })

  it('rejects a bad model, phase or size with a readable message', () => {
    expect(normaliseFundedConfig({ model: 'nope', phase: 'master', size: 100000 })).toMatchObject(
      { ok: false }
    )
    expect(
      normaliseFundedConfig({ model: 'zero', phase: 'phase2', size: 100000 })
    ).toMatchObject({ ok: false })
    expect(
      normaliseFundedConfig({ model: 'zero', phase: 'master', size: 7 })
    ).toMatchObject({ ok: false })
  })
})