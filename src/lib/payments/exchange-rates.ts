// Shared live exchange-rate lookup for payment pricing.
// Cache per-base refresh every 5 minutes; falls back to an approximate rate
// when the free rates API is unavailable (never silently overcharge).

let rateCache: { base: string; rates: Record<string, number>; fetchedAt: number } | null = null

const RATE_CACHE_TTL = 5 * 60 * 1000

export async function getExchangeRate(from: string, to: string, fallback: number): Promise<number> {
  try {
    const now = Date.now()
    if (!rateCache || rateCache.base !== from || now - rateCache.fetchedAt > RATE_CACHE_TTL) {
      const res = await fetch(
        `https://api.exchangerate-api.com/v4/latest/${from}`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (res.ok) {
        const data = await res.json()
        rateCache = { base: from, rates: data.rates || {}, fetchedAt: now }
      }
    }
    const rate = rateCache?.rates[to]
    if (rate && rate > 0) return rate
  } catch {
    // API unavailable — use fallback
  }
  return fallback
}