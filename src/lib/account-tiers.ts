// src/lib/account-tiers.ts
// Account-size tier classification for the bot, mirrored from the engine's
// rules in mt5_trading_bot/config.py (the engine remains authoritative — this
// is display-only so the UI can tell a user which caps apply to their account).

export type AccountTier = 'small' | 'mid' | 'standard'

export interface AccountTierInfo {
  tier: AccountTier | null
  maxEntries: number | null
  maxLot: number | null
  metalsEnabled: boolean
  scalpingProfile: boolean
  label: string
  summary: string
}

const num = (v: unknown, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function classifyAccountTier(
  balance: number | null | undefined,
  settings: Record<string, unknown>
): AccountTierInfo {
  if (balance == null || !Number.isFinite(balance)) {
    return {
      tier: null,
      maxEntries: null,
      maxLot: null,
      metalsEnabled: false,
      scalpingProfile: false,
      label: 'Unknown',
      summary: 'Link & run the bot once to report your account balance.',
    }
  }

  const smallMaxEquity = num(settings.ACCOUNT_TIER_SMALL_MAX_EQUITY, 50)
  const midMaxEquity = num(settings.ACCOUNT_TIER_MID_MAX_EQUITY, 100)
  const smallEntries = num(settings.ACCOUNT_TIER_SMALL_MAX_ENTRIES, 3)
  const smallLot = num(settings.ACCOUNT_TIER_SMALL_MAX_LOT, 0.02)
  const midEntries = num(settings.ACCOUNT_TIER_MID_MAX_ENTRIES, 2)
  const midLot = num(settings.ACCOUNT_TIER_MID_MAX_LOT, 0.02)
  const metals = settings.ACCOUNT_TIER_MID_ENABLE_METALS !== false
  const scalp = settings.ACCOUNT_TIER_MID_SCALP_PROFILE !== false
  const presentMax = num(settings.MAX_OPEN_POSITIONS, 3)

  if (balance <= smallMaxEquity) {
    return {
      tier: 'small',
      maxEntries: smallEntries,
      maxLot: smallLot,
      metalsEnabled: true,
      scalpingProfile: false,
      label: `≤ $${smallMaxEquity}`,
      summary: `Max ${smallEntries} open entries · ${smallLot} lots max per trade · all instruments`,
    }
  }
  if (balance <= midMaxEquity) {
    return {
      tier: 'mid',
      maxEntries: midEntries,
      maxLot: midLot,
      metalsEnabled: metals,
      scalpingProfile: scalp,
      label: `$${smallMaxEquity}–$${midMaxEquity}`,
      summary: `Max ${midEntries} open entries · ${midLot} lots max · metals enabled (${midLot * 0.5}–${midLot}) · mostly scalping`,
    }
  }
  return {
    tier: 'standard',
    maxEntries: presentMax,
    maxLot: null,
    metalsEnabled: true,
    scalpingProfile: false,
    label: `> $${midMaxEquity}`,
    summary: `Present rules — per-asset-class sizing, max ${presentMax} open entries, no tier lot cap`,
  }
}
