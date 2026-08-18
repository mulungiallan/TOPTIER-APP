// ─── Multi-Currency converter + Localized Pricing ──────────────────────────
//
// Rates come from a FREE live FX source (open.er-api.com, no API key) with the
// static table below as an offline fallback. `refreshCurrencyRates()` is called
// from the API routes before serving prices; sync helpers always read the
// latest cached rates so client code doesn't need to change.

export interface CurrencyMeta {
  code: string
  symbol: string
  name: string
  rate: number // rate relative to USD (1 USD = rate * currency) — FALLBACK default
  decimals: number
}

export const currencies: Record<string, CurrencyMeta> = {
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', rate: 1, decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', rate: 0.92, decimals: 2 },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', rate: 0.79, decimals: 2 },
  KES: { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', rate: 130, decimals: 0 },
  NGN: { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', rate: 1500, decimals: 0 },
  ZAR: { code: 'ZAR', symbol: 'R', name: 'South African Rand', rate: 18.5, decimals: 2 },
  GHS: { code: 'GHS', symbol: '₵', name: 'Ghanaian Cedi', rate: 14.5, decimals: 2 },
  UGX: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', rate: 3750, decimals: 0 },
  TZS: { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling', rate: 2530, decimals: 0 },
  RWF: { code: 'RWF', symbol: 'FRw', name: 'Rwandan Franc', rate: 1280, decimals: 0 },
  INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee', rate: 83, decimals: 0 },
  AED: { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', rate: 3.67, decimals: 2 },
  CAD: { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', rate: 1.36, decimals: 2 },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', rate: 1.52, decimals: 2 },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen', rate: 150, decimals: 0 },
  CNY: { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', rate: 7.2, decimals: 2 },
  BRL: { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', rate: 5.05, decimals: 2 },
  SAR: { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal', rate: 3.75, decimals: 2 },
  KRW: { code: 'KRW', symbol: '₩', name: 'South Korean Won', rate: 1330, decimals: 0 },
  RUB: { code: 'RUB', symbol: '₽', name: 'Russian Ruble', rate: 90, decimals: 2 },
  PLN: { code: 'PLN', symbol: 'zł', name: 'Polish Zloty', rate: 4.0, decimals: 2 },
  UAH: { code: 'UAH', symbol: '₴', name: 'Ukrainian Hryvnia', rate: 39, decimals: 2 },
  VND: { code: 'VND', symbol: '₫', name: 'Vietnamese Dong', rate: 24500, decimals: 0 },
  THB: { code: 'THB', symbol: '฿', name: 'Thai Baht', rate: 36, decimals: 2 },
  IDR: { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', rate: 15800, decimals: 0 },
  TRY: { code: 'TRY', symbol: '₺', name: 'Turkish Lira', rate: 32, decimals: 2 },
}

export const currencyList = Object.values(currencies)

// ─── Live FX rates (cached) ─────────────────────────────────────────────────

let liveRates: Record<string, number> | null = null
let ratesSource: 'live' | 'fallback' = 'fallback'
let lastUpdated: Date | null = null
let lastAttempt = 0

const RATE_CACHE_MS = 6 * 60 * 60 * 1000 // re-fetch at most every 6h
const RATE_SOURCE_URL = 'https://open.er-api.com/v6/latest/USD'

export function getRateSource() {
  return { source: ratesSource, updatedAt: lastUpdated }
}

function effectiveRate(code: string): number {
  if (liveRates && liveRates[code]) return liveRates[code]
  return currencies[code]?.rate || 1
}

/**
 * Fetch fresh USD-anchored FX rates from a free public API. Falls back to the
 * static table on failure and never throws. Coalesced so concurrent callers
 * share a single in-flight fetch.
 */
export async function refreshCurrencyRates(force = false): Promise<void> {
  const now = Date.now()
  if (!force && lastAttempt && now - lastAttempt < RATE_CACHE_MS) return
  lastAttempt = now

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(RATE_SOURCE_URL, { signal: controller.signal })
    clearTimeout(timer)

    if (!res.ok) throw new Error(`FX API error: ${res.status}`)

    const json = (await res.json()) as { result?: string; rates?: Record<string, number> }
    if (json.result !== 'success' || !json.rates) throw new Error('Invalid FX API response')

    liveRates = json.rates
    ratesSource = 'live'
    lastUpdated = new Date()
  } catch (err) {
    console.warn('[currency] Live FX fetch failed, using fallback rates:', (err as Error).message)
    ratesSource = 'fallback'
    lastUpdated = null
  }
}

export function convertCurrency(amount: number, from: string, to: string): number {
  const fromRate = effectiveRate(from)
  const toRate = effectiveRate(to)
  return (amount / fromRate) * toRate
}

export function formatCurrency(amount: number, currency: string, opts?: { compact?: boolean }): string {
  const cur = currencies[currency]
  if (!cur) return `$${amount.toFixed(2)}`
  const value = convertCurrency(amount, 'USD', currency)
  if (opts?.compact && Math.abs(value) >= 1000) {
    const abs = Math.abs(value)
    let str: string
    if (abs >= 1_000_000) str = (value / 1_000_000).toFixed(1) + 'M'
    else if (abs >= 1000) str = (value / 1000).toFixed(1) + 'K'
    else str = value.toFixed(0)
    return `${cur.symbol}${str}`
  }
  return `${cur.symbol}${value.toLocaleString('en-US', {
    minimumFractionDigits: cur.decimals,
    maximumFractionDigits: cur.decimals,
  })}`
}

// ─── Localized Pricing — apply regional discount based on country ────────────

export interface LocalizedPrice {
  currency: string
  originalPrice: number
  discountedPrice: number
  discountPct: number
  formatted: string
  formattedOriginal: string
  region: string
  reason: string
}

// Purchasing Power Parity (PPP) discount tiers by country code
const PPP_DISCOUNTS: Record<string, { discountPct: number; region: string; reason: string }> = {
  // Tier 1 — developing markets with weaker currencies
  KE: { discountPct: 60, region: 'Kenya', reason: 'Regional pricing for Kenya' },
  NG: { discountPct: 65, region: 'Nigeria', reason: 'Regional pricing for Nigeria' },
  UG: { discountPct: 65, region: 'Uganda', reason: 'Regional pricing for Uganda' },
  TZ: { discountPct: 65, region: 'Tanzania', reason: 'Regional pricing for Tanzania' },
  RW: { discountPct: 70, region: 'Rwanda', reason: 'Regional pricing for Rwanda' },
  GH: { discountPct: 60, region: 'Ghana', reason: 'Regional pricing for Ghana' },
  IN: { discountPct: 55, region: 'India', reason: 'Regional pricing for India' },
  ID: { discountPct: 55, region: 'Indonesia', reason: 'Regional pricing for Indonesia' },
  VN: { discountPct: 55, region: 'Vietnam', reason: 'Regional pricing for Vietnam' },
  PH: { discountPct: 50, region: 'Philippines', reason: 'Regional pricing for Philippines' },
  PK: { discountPct: 65, region: 'Pakistan', reason: 'Regional pricing for Pakistan' },
  BD: { discountPct: 65, region: 'Bangladesh', reason: 'Regional pricing for Bangladesh' },
  EG: { discountPct: 60, region: 'Egypt', reason: 'Regional pricing for Egypt' },
  // Tier 2 — moderate discounts
  BR: { discountPct: 40, region: 'Brazil', reason: 'Regional pricing for Brazil' },
  ZA: { discountPct: 40, region: 'South Africa', reason: 'Regional pricing for South Africa' },
  MX: { discountPct: 35, region: 'Mexico', reason: 'Regional pricing for Mexico' },
  TR: { discountPct: 50, region: 'Turkey', reason: 'Regional pricing for Turkey' },
  RU: { discountPct: 40, region: 'Russia', reason: 'Regional pricing for Russia' },
  TH: { discountPct: 35, region: 'Thailand', reason: 'Regional pricing for Thailand' },
  UA: { discountPct: 45, region: 'Ukraine', reason: 'Regional pricing for Ukraine' },
  PL: { discountPct: 25, region: 'Poland', reason: 'Regional pricing for Poland' },
  // Tier 3 — minor discounts
  CN: { discountPct: 20, region: 'China', reason: 'Regional pricing for China' },
  MY: { discountPct: 15, region: 'Malaysia', reason: 'Regional pricing for Malaysia' },
  SA: { discountPct: 10, region: 'Saudi Arabia', reason: 'Regional pricing for Saudi Arabia' },
  AE: { discountPct: 10, region: 'UAE', reason: 'Regional pricing for UAE' },
  // Tier 0 — no discount
  US: { discountPct: 0, region: 'United States', reason: 'Standard pricing' },
  CA: { discountPct: 0, region: 'Canada', reason: 'Standard pricing' },
  GB: { discountPct: 0, region: 'United Kingdom', reason: 'Standard pricing' },
  AU: { discountPct: 0, region: 'Australia', reason: 'Standard pricing' },
  DE: { discountPct: 0, region: 'Germany', reason: 'Standard pricing' },
  FR: { discountPct: 0, region: 'France', reason: 'Standard pricing' },
  JP: { discountPct: 0, region: 'Japan', reason: 'Standard pricing' },
  KR: { discountPct: 0, region: 'South Korea', reason: 'Standard pricing' },
}

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  KE: 'KES', NG: 'NGN', UG: 'UGX', TZ: 'TZS', RW: 'RWF', GH: 'GHS', ZA: 'ZAR',
  IN: 'INR', ID: 'IDR', VN: 'VND', PH: 'PHP', PK: 'PKR', BD: 'BDT', EG: 'EGP',
  BR: 'BRL', MX: 'MXN', TR: 'TRY', RU: 'RUB', TH: 'THB', UA: 'UAH', PL: 'PLN',
  CN: 'CNY', MY: 'MYR', SA: 'SAR', AE: 'AED', US: 'USD', CA: 'CAD', GB: 'GBP',
  AU: 'AUD', DE: 'EUR', FR: 'EUR', JP: 'JPY', KR: 'KRW',
}

export function getLocalizedPrice(usdPrice: number, countryCode?: string): LocalizedPrice {
  const ppp = countryCode ? PPP_DISCOUNTS[countryCode.toUpperCase()] : null
  const currency = countryCode ? (COUNTRY_TO_CURRENCY[countryCode.toUpperCase()] || 'USD') : 'USD'

  const discountedPrice = ppp ? usdPrice * (1 - ppp.discountPct / 100) : usdPrice
  const discountPct = ppp?.discountPct || 0

  return {
    currency,
    originalPrice: usdPrice,
    discountedPrice,
    discountPct,
    formatted: formatCurrency(discountedPrice, currency),
    formattedOriginal: formatCurrency(usdPrice, currency),
    region: ppp?.region || 'Global',
    reason: ppp?.reason || 'Standard pricing',
  }
}
