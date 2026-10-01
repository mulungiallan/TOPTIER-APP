// src/lib/funded-profiles.ts
// Mirror of mini-services/funded_bot/profiles.py + the `validate()` rules from
// guard.py, so the app can show a funded user the exact limits their account
// carries and refuse an unsafe combination before the bot service ever starts.
//
// This file is deliberately the ONLY place in the app that knows FundingPips
// rule numbers. If a model is added to profiles.py it must be added here too,
// or the picker will not offer it.
//
// Note the limits the firm's own rules did not state are carried in `notes`,
// exactly like the Python side, so the UI can surface them rather than hide
// the uncertainty.

export const FUNDED_MODELS = [
  'zero',
  '1step_flex',
  '2step_standard',
  '2step_flex',
  '2step_pro',
] as const

export type FundedModel = (typeof FUNDED_MODELS)[number]

export const FUNDED_PHASES = ['phase1', 'phase2', 'master'] as const
export type FundedPhase = (typeof FUNDED_PHASES)[number]

export const FUNDED_SPLITS = [80, 95] as const

export const FUNDED_SIZES: Record<FundedModel, readonly number[]> = {
  zero: [5000, 10000, 25000, 50000, 100000, 200000],
  '1step_flex': [5000, 10000, 25000, 50000, 100000],
  '2step_standard': [5000, 10000, 25000, 50000, 100000],
  '2step_flex': [5000, 10000, 25000, 50000, 100000],
  '2step_pro': [5000, 10000, 25000, 50000, 100000, 200000],
}

export const FUNDED_PHASES_FOR: Record<FundedModel, readonly FundedPhase[]> = {
  zero: ['master'],
  '1step_flex': ['phase1', 'master'],
  '2step_standard': ['phase1', 'phase2', 'master'],
  '2step_flex': ['phase1', 'phase2', 'master'],
  '2step_pro': ['phase1', 'phase2', 'master'],
}

export const FUNDED_LABELS: Record<FundedModel, string> = {
  zero: 'FundingPips Zero',
  '1step_flex': '1 Step Flex',
  '2step_standard': '2 Step Standard',
  '2step_flex': '2 Step Flex',
  '2step_pro': '2 Step Pro',
}

export const FUNDED_PHASE_LABELS: Record<FundedPhase, string> = {
  phase1: 'Phase 1',
  phase2: 'Phase 2',
  master: 'Master',
}

export interface FundedLimits {
  dailyLossPct: number
  maxLossPct: number
  maxLossMode: 'trailing_lock' | 'static'
  trailLockProfitPct: number
  openRiskPct: number | null
  ideaLimitPct: number | null
  newsRestricted: boolean
  weekendHoldAllowed: boolean
  targetPct: number | null
  minTradingDays: number
  profitableDaysNeeded: number | null
  notes: string[]
}

export interface FundedProfile extends FundedLimits {
  key: FundedModel
  phase: FundedPhase
  size: number
  split: number
}

/** Mirrors profiles.build_profile. Throws on an unknown model/phase/size. */
export function buildFundedProfile(
  model: string,
  phase: string,
  size: number,
  split = 80
): FundedProfile {
  if (!FUNDED_MODELS.includes(model as FundedModel)) {
    throw new Error(`Unknown funded model "${model}".`)
  }
  const m = model as FundedModel
  const p = String(phase || '').toLowerCase() as FundedPhase
  if (!FUNDED_PHASES_FOR[m].includes(p)) {
    throw new Error(
      `${m} has phases ${FUNDED_PHASES_FOR[m].join(', ')}, not "${phase}".`
    )
  }
  if (!FUNDED_SIZES[m].includes(size)) {
    throw new Error(`${m} sizes are ${FUNDED_SIZES[m].join(', ')}, not ${size}.`)
  }

  const master = p === 'master'
  // News restriction + weekend ban apply on Master accounts, and always on Zero.
  const newsRestricted = master || m === 'zero'
  const weekendHoldAllowed = !newsRestricted

  const base = {
    key: m,
    phase: p,
    size,
    split,
    newsRestricted,
    weekendHoldAllowed,
    profitableDaysNeeded: null as number | null,
    minTradingDays: 0,
  }

  switch (m) {
    case 'zero':
      return {
        ...base,
        dailyLossPct: 3,
        maxLossPct: 5,
        maxLossMode: 'trailing_lock',
        trailLockProfitPct: 5,
        openRiskPct: 1,
        ideaLimitPct: size < 50000 ? 3 : 2,
        targetPct: null,
        profitableDaysNeeded: 7,
        notes: [
          'News window times were not in the source rules. Set them to what the FundingPips page states before you rely on the news filter.',
        ],
      }
    case '1step_flex':
      return {
        ...base,
        dailyLossPct: 3,
        maxLossPct: 12,
        maxLossMode: 'static',
        trailLockProfitPct: 0,
        openRiskPct: null,
        ideaLimitPct: null,
        targetPct: master ? null : 12,
        notes: [],
      }
    case '2step_standard':
      return {
        ...base,
        dailyLossPct: 3,
        maxLossPct: 10,
        maxLossMode: 'static',
        trailLockProfitPct: 0,
        openRiskPct: null,
        ideaLimitPct: null,
        targetPct: master ? null : p === 'phase1' ? 8 : 5,
        minTradingDays: master ? 0 : 3,
        notes: [
          'The source rules do NOT state 2 Step Standard loss limits. This assumes 3% daily (safe for both the default and the "3% daily add-on" variants) and 10% static max loss. Verify against your own dashboard.',
        ],
      }
    case '2step_flex':
      return {
        ...base,
        dailyLossPct: 4,
        maxLossPct: 12,
        maxLossMode: 'static',
        trailLockProfitPct: 0,
        openRiskPct: null,
        ideaLimitPct: null,
        targetPct: master ? null : p === 'phase1' ? 10 : 8,
        ...(split === 95
          ? { profitableDaysNeeded: 3 }
          : { minTradingDays: master ? 0 : 1 }),
        notes: [],
      }
    case '2step_pro':
      return {
        ...base,
        dailyLossPct: 3,
        maxLossPct: 6,
        maxLossMode: 'static',
        trailLockProfitPct: 0,
        openRiskPct: null,
        ideaLimitPct: null,
        targetPct: master ? null : 6,
        minTradingDays: master ? 0 : 2,
        notes: [
          'The source rules do not say whether the 2 Step Pro 6% max loss is static or trailing. This treats it as static from the starting balance. Verify against your own dashboard.',
        ],
      }
  }
}

// Guard defaults, mirroring GuardConfig. The app needs them to reproduce the
// worst-case-day check below and to label the sliders. Typed as a mutable
// interface because callers pass partial overrides with different literal
// types, which `as const` would otherwise pin too tightly.
export interface FundedGuardConfig {
  risk_per_trade_pct: number
  max_positions: number
  soft_frac: number
  open_risk_soft_frac: number
  idea_soft_frac: number
  daily_profit_stop_pct: number
  daily_loss_stop_pct: number
  max_consecutive_losses: number
  symbol_cooldown_min: number
}

export const FUNDED_GUARD_DEFAULTS: FundedGuardConfig = {
  risk_per_trade_pct: 0.25,
  max_positions: 2,
  soft_frac: 0.5,
  open_risk_soft_frac: 0.7,
  idea_soft_frac: 0.5,
  daily_profit_stop_pct: 0.6,
  daily_loss_stop_pct: 0.5,
  max_consecutive_losses: 3,
  symbol_cooldown_min: 30,
}

/** Mirrors guard.validate(). Returns null when the config is safe. */
export function validateFundedRisk(
  profile: FundedProfile,
  guard: Partial<FundedGuardConfig> = {}
): string | null {
  const cfg = { ...FUNDED_GUARD_DEFAULTS, ...guard }
  const r = Number(cfg.risk_per_trade_pct)
  const n = Number(cfg.max_positions)

  if (!Number.isFinite(r) || r <= 0) return 'Risk per trade must be a positive number.'
  if (!Number.isInteger(n) || n < 1) return 'Max open positions must be a whole number of at least 1.'
  if (Number(cfg.symbol_cooldown_min) < 10) {
    return 'Same-pair cooldown must be at least 10 minutes (the firm\'s 10-minute rule).'
  }

  if (profile.openRiskPct != null) {
    const cap = cfg.open_risk_soft_frac * profile.openRiskPct
    if (r * n > cap + 1e-9) {
      return (
        `${r}% risk x ${n} positions = ${round2(r * n)}% exceeds the open-risk soft cap ` +
        `${round2(cap)}% (${profile.openRiskPct}% hard limit). Lower the risk or the position count.`
      )
    }
  }
  if (profile.ideaLimitPct != null && r > cfg.idea_soft_frac * profile.ideaLimitPct + 1e-9) {
    return `Risk per trade (${r}%) exceeds the per-trade-idea soft cap (${round2(cfg.idea_soft_frac * profile.ideaLimitPct)}%).`
  }
  const worstDay = cfg.daily_loss_stop_pct + n * r
  if (worstDay > cfg.soft_frac * profile.dailyLossPct + 1e-9) {
    return (
      `Worst-case day ${round2(worstDay)}% (loss stop plus open trades at their stops) exceeds the ` +
      `daily soft limit ${round2(cfg.soft_frac * profile.dailyLossPct)}%.`
    )
  }
  return null
}

/** Money the guard stops at: 50% of the distance to each hard limit. */
export function fundedSoftFloors(profile: FundedProfile) {
  const dailyDistance = profile.size * (profile.dailyLossPct / 100)
  const maxDistance = profile.size * (profile.maxLossPct / 100)
  const dailyFloor = profile.size - dailyDistance * FUNDED_GUARD_DEFAULTS.soft_frac
  const maxFloor = profile.size - maxDistance * FUNDED_GUARD_DEFAULTS.soft_frac
  return {
    dailyHard: round2(profile.size - dailyDistance),
    maxHard: round2(profile.size - maxDistance),
    dailyFloor: round2(dailyFloor),
    maxFloor: round2(maxFloor),
  }
}

export interface FundedConfigInput {
  model: string
  phase: string
  size: number
  split?: number
  peakEquity?: number | null
  symbols?: string[] | null
  avoidNews?: boolean
  dryRun?: boolean
  guard?: Record<string, unknown> | null
  strategy?: Record<string, unknown> | null
  news?: Record<string, unknown> | null
}

export interface FundedConfig extends FundedConfigInput {
  model: FundedModel
  phase: FundedPhase
  size: number
  split: number
}

/**
 * Validate and normalise a funded config. Returns the config to persist, or an
 * error message. Refuses anything the guard would reject at start time.
 */
export function normaliseFundedConfig(input: FundedConfigInput):
  | { ok: true; config: FundedConfig; profile: FundedProfile }
  | { ok: false; error: string } {
  const split = input.split === 95 ? 95 : 80
  let profile: FundedProfile
  try {
    profile = buildFundedProfile(input.model, input.phase, Number(input.size), split)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const guard = (input.guard ?? {}) as Partial<FundedGuardConfig>
  const riskError = validateFundedRisk(profile, guard)
  if (riskError) return { ok: false, error: riskError }

  const symbols = Array.isArray(input.symbols)
    ? input.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    : []

  return {
    ok: true,
    profile,
    config: {
      model: profile.key,
      phase: profile.phase,
      size: profile.size,
      split,
      peakEquity: typeof input.peakEquity === 'number' && input.peakEquity > 0 ? input.peakEquity : null,
      symbols,
      avoidNews: input.avoidNews !== false,
      dryRun: input.dryRun === true,
      guard: input.guard ?? {},
      strategy: input.strategy ?? {},
      news: input.news ?? {},
    },
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}