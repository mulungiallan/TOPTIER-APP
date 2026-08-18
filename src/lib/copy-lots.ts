// src/lib/copy-lots.ts
// Position sizing for copy trading.
//
// TWO sizing modes:
//   1. Progressive lot sizing (legacy): mirrored lot size grows with follower
//      account size at a stepped rate. Kept as fallback.
//   2. Risk-normalized sizing (NEW — per copytrading feature.txt rule #1):
//      calculate the provider's risk as a % of their own equity (using lot
//      size, symbol, and SL distance), then replicate that same % risk against
//      the master account's equity. This is the only sane way to handle
//      heterogeneous account sizes and trading styles.
//
// Hard cap: no single trade risks more than maxRiskPct (default 2%) of master
// equity, regardless of what the % risk math says.
// Minimum lot floor: if the computed lot size is below the broker's minimum,
// skip the trade entirely (safer than flooring at minimum which over-risks).

const round2 = (v: number) => Math.round(v * 100) / 100

// ─── Per-asset-class sizing config ────────────────────────────────────────
// Volatility ordering: forex < metals < crypto
// Lot sizes scale inversely with volatility — lower vol = more lots allowed.

export interface AssetSizingConfig {
  baseLotsPer100Usd: number
  minLotSize: number
  maxLots: number
  maxRiskPct: number
}

// Progressive tiers per asset class.
// Forex: generous tiers (low vol, tight spreads)
const FOREX_TIERS: { upTo: number; rateMultiplier: number }[] = [
  { upTo: 1000, rateMultiplier: 1.0 },
  { upTo: 5000, rateMultiplier: 1.5 },
  { upTo: Infinity, rateMultiplier: 2.5 },
]
// Metals: moderate tiers (gold/silver ~$20-30/day swings)
const METALS_TIERS: { upTo: number; rateMultiplier: number }[] = [
  { upTo: 1000, rateMultiplier: 0.8 },
  { upTo: 5000, rateMultiplier: 1.2 },
  { upTo: Infinity, rateMultiplier: 1.8 },
]
// Crypto: conservative tiers (BTC/ETH can swing 5-10% in a day)
const CRYPTO_TIERS: { upTo: number; rateMultiplier: number }[] = [
  { upTo: 1000, rateMultiplier: 0.5 },
  { upTo: 5000, rateMultiplier: 0.8 },
  { upTo: Infinity, rateMultiplier: 1.2 },
]

const ASSET_CLASS_TIERS: Record<AssetClass, { upTo: number; rateMultiplier: number }[]> = {
  forex: FOREX_TIERS,
  metals: METALS_TIERS,
  crypto: CRYPTO_TIERS,
  unknown: FOREX_TIERS, // unknown pairs default to forex-like sizing
}

/**
 * Get the sizing config for a given asset class from the trader's settings.
 * Falls back to sensible defaults if fields are missing (old traders without
 * per-class fields).
 */
export function getAssetSizingConfig(
  symbol: string,
  trader?: {
    forexBaseLotsPer100Usd?: number | null
    forexMinLotSize?: number | null
    forexMaxLots?: number | null
    forexMaxRiskPct?: number | null
    metalsBaseLotsPer100Usd?: number | null
    metalsMinLotSize?: number | null
    metalsMaxLots?: number | null
    metalsMaxRiskPct?: number | null
    cryptoBaseLotsPer100Usd?: number | null
    cryptoMinLotSize?: number | null
    cryptoMaxLots?: number | null
    cryptoMaxRiskPct?: number | null
    lotsPer100Usd?: number | null
    maxRiskPerTradePct?: number | null
  },
): AssetSizingConfig {
  const cls = getAssetClass(symbol)
  const legacyBase = trader?.lotsPer100Usd ?? 0.01
  const legacyRisk = trader?.maxRiskPerTradePct ?? 2.0

  switch (cls) {
    case 'forex':
      return {
        baseLotsPer100Usd: trader?.forexBaseLotsPer100Usd ?? legacyBase,
        minLotSize: trader?.forexMinLotSize ?? 0.01,
        maxLots: trader?.forexMaxLots ?? 15,
        maxRiskPct: trader?.forexMaxRiskPct ?? legacyRisk,
      }
    case 'metals':
      return {
        baseLotsPer100Usd: trader?.metalsBaseLotsPer100Usd ?? legacyBase * 0.5,
        minLotSize: trader?.metalsMinLotSize ?? 0.01,
        maxLots: trader?.metalsMaxLots ?? 5,
        maxRiskPct: trader?.metalsMaxRiskPct ?? legacyRisk,
      }
    case 'crypto':
      return {
        baseLotsPer100Usd: trader?.cryptoBaseLotsPer100Usd ?? legacyBase * 0.5,
        minLotSize: trader?.cryptoMinLotSize ?? 0.02,
        maxLots: trader?.cryptoMaxLots ?? 5,
        maxRiskPct: trader?.cryptoMaxRiskPct ?? 1.5,
      }
    default:
      return {
        baseLotsPer100Usd: legacyBase,
        minLotSize: 0.01,
        maxLots: 10,
        maxRiskPct: legacyRisk,
      }
  }
}

// ─── Progressive lot sizing (fallback when no SL distance provided) ────────

export function computeProgressiveLots(
  balanceUsd: number,
  baseLotsPer100Usd = 0.01,
  maxLots = 10,
  minLots = 0.01,
  assetClass: AssetClass = 'forex',
): number {
  const balance = Number(balanceUsd) || 0
  const base = Math.max(0.0001, Number(baseLotsPer100Usd) || 0.01)
  if (balance <= 0) return 0

  const tiers = ASSET_CLASS_TIERS[assetClass] ?? FOREX_TIERS
  let lots = 0
  let remaining = balance
  let prevCap = 0
  for (const tier of tiers) {
    const span = Math.min(remaining, tier.upTo - prevCap)
    if (span > 0) lots += (span / 100) * base * tier.rateMultiplier
    remaining -= span
    prevCap = tier.upTo
    if (remaining <= 0) break
  }

  const raw = Math.max(0, lots)
  if (raw === 0) return 0
  return round2(Math.min(maxLots, Math.max(minLots, raw)))
}

// ─── Risk-normalized position sizing (rule #1) ───────────────────────────

// Approximate pip/tick values for common asset classes. These are used to
// estimate the monetary risk of a trade when the provider's SL distance is
// known. For symbols not in this map we fall back to a conservative estimate.
// Values are per-lot, per-pip (where 1 pip = 0.0001 for forex, 0.01 for
// JPY pairs, 0.1 for metals, 1.0 for crypto).
const PIP_VALUES: Record<string, { pipSize: number; valuePerPip: number }> = {
  // Forex majors
  EURUSD: { pipSize: 0.0001, valuePerPip: 10 },
  GBPUSD: { pipSize: 0.0001, valuePerPip: 10 },
  AUDUSD: { pipSize: 0.0001, valuePerPip: 10 },
  NZDUSD: { pipSize: 0.0001, valuePerPip: 10 },
  USDCAD: { pipSize: 0.0001, valuePerPip: 7.5 },
  USDCHF: { pipSize: 0.0001, valuePerPip: 10 },
  USDJPY: { pipSize: 0.01, valuePerPip: 6.7 },
  EURJPY: { pipSize: 0.01, valuePerPip: 6.7 },
  GBPJPY: { pipSize: 0.01, valuePerPip: 6.7 },
  AUDJPY: { pipSize: 0.01, valuePerPip: 6.7 },
  EURGBP: { pipSize: 0.0001, valuePerPip: 10 },
  EURAUD: { pipSize: 0.0001, valuePerPip: 10 },
  EURNZD: { pipSize: 0.0001, valuePerPip: 10 },
  GBPAUD: { pipSize: 0.0001, valuePerPip: 10 },
  GBPNZD: { pipSize: 0.0001, valuePerPip: 10 },
  AUDNZD: { pipSize: 0.0001, valuePerPip: 10 },
  // Forex exotics
  USDSEK: { pipSize: 0.0001, valuePerPip: 9.5 },
  USDNOK: { pipSize: 0.0001, valuePerPip: 9.5 },
  USDSGD: { pipSize: 0.0001, valuePerPip: 7.5 },
  USDHKD: { pipSize: 0.0001, valuePerPip: 1.3 },
  USDMXN: { pipSize: 0.0001, valuePerPip: 5.0 },
  // Metals (XAU = gold, XAG = silver, XPT = platinum, XPD = palladium)
  // For metals, pipSize is $0.10 movement, value per pip per lot varies by broker.
  // These are approximate — real value depends on contract size and broker.
  XAUUSD: { pipSize: 0.10, valuePerPip: 1.0 },
  XAGUSD: { pipSize: 0.01, valuePerPip: 50 },
  XPTUSD: { pipSize: 0.10, valuePerPip: 1.0 },
  XPDUSD: { pipSize: 0.10, valuePerPip: 1.0 },
}

// Crypto: value per $1 price movement per lot is approximately the contract
// size. For BTCUSD 1 lot ≈ 1 BTC, for ETHUSD 1 lot ≈ 10 ETH, etc.
// We use a generic approach: for crypto, risk = lots * SL_distance * approxMultiplier.
const CRYPTO_SYMBOLS = new Set([
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'ADAUSD', 'DOGEUSD',
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT',
  'BNBUSD', 'DOTUSD', 'AVAXUSD', 'LINKUSD', 'MATICUSD', 'SHIBUSD',
  'LTCUSD', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'BNBUSDT',
])

const FOREX_MAJORS = new Set([
  'EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY',
  'EURJPY', 'GBPJPY', 'AUDJPY', 'EURGBP', 'EURAUD', 'EURNZD',
  'GBPAUD', 'GBPNZD', 'AUDNZD',
])

const METALS = new Set(['XAUUSD', 'XAGUSD', 'XPTUSD', 'XPDUSD'])

export type AssetClass = 'forex' | 'metals' | 'crypto' | 'unknown'

/** Classify a symbol into an asset class for correlation/exposure tracking. */
export function getAssetClass(symbol: string): AssetClass {
  const upper = symbol.toUpperCase().replace(/[^A-Z]/g, '')
  if (CRYPTO_SYMBOLS.has(upper) || upper.endsWith('USDT')) return 'crypto'
  if (METALS.has(upper)) return 'metals'
  if (FOREX_MAJORS.has(upper) || /^[A-Z]{6}$/.test(upper)) return 'forex'
  // Heuristic: 6-letter all-alpha = likely forex; digits = likely crypto
  if (/^\d/.test(symbol) || upper.includes('BTC') || upper.includes('ETH')) return 'crypto'
  return 'unknown'
}

/**
 * Estimate the monetary risk of a single trade for a given lot size, symbol,
 * and SL distance. Returns the risk in account currency (typically USD).
 *
 * If SL distance is unknown (0 or null), returns null — caller must fall
 * back to progressive sizing.
 */
export function estimateTradeRisk(
  lots: number,
  symbol: string,
  stopLossDistance: number | null | undefined,
): number | null {
  if (!lots || lots <= 0 || !stopLossDistance || stopLossDistance <= 0) return null

  const upper = symbol.toUpperCase().replace(/[^A-Z]/g, '')

  if (CRYPTO_SYMBOLS.has(upper) || upper.endsWith('USDT')) {
    // For crypto, approximate: 1 lot ≈ 1 unit of base currency.
    // Risk = lots * SL_distance * contract_multiplier(approx 1 for BTC, 10 for ETH, etc.)
    // Conservative approximation: treat 1 lot as ~$1 per $1 movement for BTC-like,
    // and scale down for smaller cryptos.
    const multiplier = upper.startsWith('BTC') ? 1.0 :
      upper.startsWith('ETH') ? 10.0 :
        upper.startsWith('SOL') ? 100.0 :
          1000.0 // smaller caps
    return lots * stopLossDistance * multiplier
  }

  const pipInfo = PIP_VALUES[upper]
  if (pipInfo) {
    const pips = stopLossDistance / pipInfo.pipSize
    return lots * pips * pipInfo.valuePerPip
  }

  // Unknown symbol: conservative fallback — assume $10 per pip per lot (forex-like)
  return lots * stopLossDistance * 10
}

/**
 * Compute the risk as a % of equity for a given trade.
 * riskPct = (estimatedRisk / equity) * 100
 */
export function computeRiskPct(
  lots: number,
  symbol: string,
  stopLossDistance: number | null | undefined,
  equityUsd: number,
): number | null {
  const risk = estimateTradeRisk(lots, symbol, stopLossDistance)
  if (risk == null || equityUsd <= 0) return null
  return (risk / equityUsd) * 100
}

/**
 * Risk-normalized position sizing (rule #1 from feature spec).
 *
 * Given the provider's risk as a % of their equity, replicate that same %
 * risk against the master account's equity. Then apply:
 *   - Hard per-trade risk cap (maxRiskPct, default 2% of master equity)
 *   - Minimum lot floor (skip trade if below broker minimum)
 *
 * Returns { lots, riskPct, skipped, reason }
 */
export function computeRiskNormalizedLots(
  providerRiskPct: number,
  masterEquityUsd: number,
  symbol: string,
  stopLossDistance: number | null | undefined,
  opts?: {
    maxRiskPct?: number       // hard cap, default 2.0
    minLotSize?: number       // broker minimum, default 0.01
    maxLots?: number          // absolute max, default 10
  },
): { lots: number; riskPct: number; skipped: boolean; reason?: string } {
  const maxRiskPct = opts?.maxRiskPct ?? 2.0
  const minLotSize = opts?.minLotSize ?? 0.01
  const maxLots = opts?.maxLots ?? 10

  if (providerRiskPct <= 0 || masterEquityUsd <= 0) {
    return { lots: 0, riskPct: 0, skipped: true, reason: 'Invalid risk or equity' }
  }

  // Clamp to hard cap
  const targetRiskPct = Math.min(providerRiskPct, maxRiskPct)
  const targetRiskUsd = (targetRiskPct / 100) * masterEquityUsd

  // Reverse-engineer the lot size from the target risk
  // risk = lots * riskPerLot => lots = targetRiskUsd / riskPerLot
  const upper = symbol.toUpperCase().replace(/[^A-Z]/g, '')
  let riskPerLot: number

  if (CRYPTO_SYMBOLS.has(upper) || upper.endsWith('USDT')) {
    const multiplier = upper.startsWith('BTC') ? 1.0 :
      upper.startsWith('ETH') ? 10.0 :
        upper.startsWith('SOL') ? 100.0 : 1000.0
    riskPerLot = (stopLossDistance ?? 100) * multiplier
  } else {
    const pipInfo = PIP_VALUES[upper]
    if (pipInfo) {
      const pips = (stopLossDistance ?? pipInfo.pipSize * 50) / pipInfo.pipSize
      riskPerLot = pips * pipInfo.valuePerPip
    } else {
      riskPerLot = (stopLossDistance ?? 50) * 10
    }
  }

  if (riskPerLot <= 0) {
    return { lots: 0, riskPct: 0, skipped: true, reason: 'Cannot calculate risk per lot' }
  }

  let lots = round2(targetRiskUsd / riskPerLot)

  // Minimum lot floor rule: skip trade entirely if below broker minimum
  if (lots < minLotSize) {
    return {
      lots: 0,
      riskPct: 0,
      skipped: true,
      reason: `Computed lots (${lots}) below broker minimum (${minLotSize}). Skipping is safer than flooring.`,
    }
  }

  // Clamp to max
  lots = Math.min(lots, maxLots)
  lots = round2(Math.max(minLotSize, lots))

  // Compute actual risk % after rounding
  const actualRiskUsd = lots * riskPerLot
  const actualRiskPct = (actualRiskUsd / masterEquityUsd) * 100

  return { lots, riskPct: round2(actualRiskPct), skipped: false }
}

/**
 * Compute the stop-loss distance in price units from SL price and entry price.
 * Returns null if either is missing or zero.
 */
export function computeSLDistance(
  entryPrice: number,
  stopLoss: number | null | undefined,
): number | null {
  if (!entryPrice || !stopLoss || stopLoss <= 0 || entryPrice <= 0) return null
  return Math.abs(entryPrice - stopLoss)
}

// ─── Time-based rules (rule #4) ──────────────────────────────────────────

/** Check if the current time is within a weekend gap window for forex/metals.
 *  Crypto trades 24/7 but forex/metals don't. Weekend opens/holds carry gap risk.
 */
export function isWeekendGapWindow(now?: Date): boolean {
  const d = now ?? new Date()
  const utcDay = d.getUTCDay() // 0=Sun, 6=Sat
  const utcHour = d.getUTCHours()
  // Friday 22:00 UTC to Sunday 22:00 UTC — typical forex/metal market closure
  if (utcDay === 5 && utcHour >= 22) return true
  if (utcDay === 6) return true
  if (utcDay === 0 && utcHour < 22) return true
  return false
}

/**
 * Check if a trade is within a news blackout window.
 * Returns true if the current time is within `blackoutMinutes` of a major
 * news release. This is a simplified check — in production you'd want a
 * calendar of actual release dates/times.
 */
export function isNewsBlackoutWindow(
  blackoutMinutes: number,
  now?: Date,
): boolean {
  if (blackoutMinutes <= 0) return false
  const d = now ?? new Date()
  const utcHour = d.getUTCHours()
  const utcMinute = d.getUTCMinutes()
  // Major news windows (approximate, UTC): NFP 12:30, CPI 12:30, Rate decisions 14:00
  // Check within ±blackoutMinutes of these times
  const majorHours = [12, 14] // hour 12 (NFP/CPI at :30), hour 14 (rate decisions at :00)
  for (const h of majorHours) {
    const totalMinutes = utcHour * 60 + utcMinute
    const eventMinutes = h * 60 + (h === 12 ? 30 : 0)
    if (Math.abs(totalMinutes - eventMinutes) <= blackoutMinutes) return true
  }
  return false
}

// ─── Correlation helpers (rule #3) ───────────────────────────────────────

/**
 * Compute net exposure for a set of open trades.
 * Returns { longLots, shortLots, netExposure } where netExposure = longLots - shortLots.
 */
export function computeNetExposure(
  trades: Array<{ symbol: string; direction: string; size: number }>,
  targetSymbol?: string,
): { longLots: number; shortLots: number; netExposure: number } {
  let longLots = 0
  let shortLots = 0
  for (const t of trades) {
    if (targetSymbol && t.symbol !== targetSymbol) continue
    if (t.direction === 'BUY') longLots += t.size
    else shortLots += t.size
  }
  return { longLots, shortLots, netExposure: longLots - shortLots }
}

/**
 * Check if adding a new trade would exceed the per-symbol net exposure cap.
 * Returns true if the trade should be blocked.
 */
export function wouldExceedSymbolCap(
  currentTrades: Array<{ symbol: string; direction: string; size: number }>,
  newSymbol: string,
  newDirection: string,
  newSize: number,
  masterEquityUsd: number,
  maxSymbolExposurePct: number,
): boolean {
  const current = computeNetExposure(currentTrades, newSymbol)
  const delta = newDirection === 'BUY' ? newSize : -newSize
  const newNet = Math.abs(current.netExposure + delta)
  const capUsd = (maxSymbolExposurePct / 100) * masterEquityUsd
  // Rough approximation: assume 1 lot ≈ $10,000 notional for forex
  const newNetUsd = newNet * 10000
  return newNetUsd > capUsd
}

/**
 * Check if adding a new trade would exceed the per-asset-class net exposure cap.
 */
export function wouldExceedAssetClassCap(
  currentTrades: Array<{ symbol: string; direction: string; size: number }>,
  newSymbol: string,
  newDirection: string,
  newSize: number,
  masterEquityUsd: number,
  maxAssetClassExposurePct: number,
): boolean {
  const newClass = getAssetClass(newSymbol)
  const classTrades = currentTrades.filter(t => getAssetClass(t.symbol) === newClass)
  const current = computeNetExposure(classTrades)
  const delta = newDirection === 'BUY' ? newSize : -newSize
  const newNet = Math.abs(current.netExposure + delta)
  const capUsd = (maxAssetClassExposurePct / 100) * masterEquityUsd
  const newNetUsd = newNet * 10000
  return newNetUsd > capUsd
}
