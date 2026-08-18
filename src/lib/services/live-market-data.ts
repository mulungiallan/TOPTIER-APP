// src/lib/services/live-market-data.ts
// Live market data integration powered by Finnhub (real-time).
//
// - Stocks (AAPL, TSLA, MSFT, ...)        -> Finnhub /quote
// - Crypto (BTC/USD, ETH/USD, ...)        -> Finnhub /quote via BINANCE:BTCUSDT
// - ETFs (SPY, QQQ, GLD, ...)             -> Finnhub /quote
// - Indices proxy (SPX500 -> SPY, etc.)   -> Finnhub /quote (ETF proxy)
// - Forex / commodities / indices (native) -> graceful fallback to Yahoo Finance
//   (Finnhub free tier blocks OANDA:* and /forex/candle endpoints)
//
// All symbols flow through one normalized `LivePrice` interface so callers
// don't need to know which upstream source was used.

import { marketDataService } from '@/lib/services/market-data'
import { env } from '@/lib/env'

const FINNHUB_API_KEY = env.finnhubApiKey
const BASE_URL = 'https://finnhub.io/api/v1'

export interface LivePrice {
  symbol: string // The original TOPTIER symbol (e.g. "BTC/USD", "AAPL", "SPX500")
  price: number
  change: number
  changePercent: number
  high?: number
  low?: number
  open?: number
  previousClose?: number
  volume?: number
  timestamp: Date
  source: 'finnhub' | 'yahoo' | 'mock'
}

export interface HistoricalCandle {
  date: string // ISO date string (YYYY-MM-DD)
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type CandleResolution = '1' | '5' | '15' | '30' | '60' | 'D' | 'W' | 'M'

// ─── Symbol Mapping ──────────────────────────────────────────────────────────────
// Maps TOPTIER-style symbols to Finnhub-compatible symbols. If a symbol is not
// in this map, it is passed through to Finnhub as-is (works for stock tickers).

const FINNHUB_SYMBOL_MAP: Record<string, string> = {
  // Crypto (via Binance)
  'BTC/USD': 'BINANCE:BTCUSDT',
  'BTC-USD': 'BINANCE:BTCUSDT',
  'ETH/USD': 'BINANCE:ETHUSDT',
  'ETH-USD': 'BINANCE:ETHUSDT',
  'SOL/USD': 'BINANCE:SOLUSDT',
  'XRP/USD': 'BINANCE:XRPUSDT',
  'LTC/USD': 'BINANCE:LTCUSDT',
  'ADA/USD': 'BINANCE:ADAUSDT',
  'BNB/USD': 'BINANCE:BNBUSDT',
  'DOGE/USD': 'BINANCE:DOGEUSDT',
  // Indices via ETF proxy (Finnhub doesn't return live data for ^GSPC on free tier)
  'SPX 500': 'SPY',
  SPX500: 'SPY',
  NASDAQ: 'QQQ',
  'NAS 100': 'QQQ',
  'NAS100': 'QQQ',
  DOW: 'DIA',
  // Commodities via ETF proxy
  GOLD: 'GLD',
  'XAU/USD': 'GLD',
  SILVER: 'SLV',
  'XAG/USD': 'SLV',
  OIL: 'USO',
  BRENT: 'BNO',
}

// Symbols that Finnhub free tier CANNOT serve — OR where we prefer Yahoo
// Finance because it returns the true spot/index price (e.g. ^GSPC ~ $5,500)
// instead of an ETF proxy (e.g. SPY ~ $746) which confuses users.
const FINNHUB_UNSUPPORTED = new Set([
  // Forex (Finnhub free tier blocks OANDA:* symbols)
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
  'USD/CHF',
  'AUD/USD',
  'USD/CAD',
  'NZD/USD',
  'EUR/GBP',
  'GBP/JPY',
  'DXY',
  // Indices — Yahoo returns the actual index value (^GSPC, ^IXIC, ^DJI)
  // which matches what users see on Bloomberg/CNBC. Finnhub ETF proxies
  // (SPY/QQQ/DIA) return ~1/10 the value and break the UI.
  'SPX 500',
  'SPX500',
  'NASDAQ',
  'NAS 100',
  'NAS100',
  'DOW',
  'DAX',
  'FTSE',
  'NIKKEI',
  // Commodities — Yahoo returns the futures spot price (GC=F, SI=F, CL=F)
  // which matches the actual commodity price. ETF proxies (GLD/SLV/USO)
  // return ~1/10 (GLD) or 1/100 (USO) the value.
  'GOLD',
  'XAU/USD',
  'SILVER',
  'XAG/USD',
  'OIL',
  'BRENT',
])

function resolveFinnhubSymbol(symbol: string): string {
  const upper = symbol.toUpperCase()
  return FINNHUB_SYMBOL_MAP[upper] || upper
}

function isFinnhubSupported(symbol: string): boolean {
  return !FINNHUB_UNSUPPORTED.has(symbol.toUpperCase())
}

// ─── Live Market Data Service ────────────────────────────────────────────────────

export class LiveMarketData {
  private cache: Map<string, { data: LivePrice; timestamp: number }> = new Map()
  private historicalCache: Map<
    string,
    { data: HistoricalCandle[]; timestamp: number }
  > = new Map()
  private CACHE_DURATION = 15_000 // 15 seconds for quotes (balances freshness + rate limits)
  private HISTORICAL_CACHE_DURATION = 600_000 // 10 minutes for candles
  private MAX_CACHE_SIZE = 500

  private evictexpired(): void {
    if (this.cache.size > this.MAX_CACHE_SIZE) {
      const now = Date.now()
      for (const [key, val] of this.cache) {
        if (now - val.timestamp > this.CACHE_DURATION) this.cache.delete(key)
      }
    }
    if (this.historicalCache.size > this.MAX_CACHE_SIZE) {
      const now = Date.now()
      for (const [key, val] of this.historicalCache) {
        if (now - val.timestamp > this.HISTORICAL_CACHE_DURATION) this.historicalCache.delete(key)
      }
    }
  }

  /**
   * Get a live price for any supported symbol.
   * Strategy: Finnhub first → Yahoo fallback. No fabricated data — if both
   * upstreams fail, null is returned so the UI can show "unavailable".
   */
  async getPrice(symbol: string): Promise<LivePrice | null> {
    if (!symbol) return null

    // Cache hit?
    const cached = this.cache.get(symbol)
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.data
    }

    let result: LivePrice | null = null

    // 1) Try Finnhub (stocks / crypto / ETFs / ETF-proxied indices)
    if (isFinnhubSupported(symbol)) {
      result = await this.fetchFromFinnhub(symbol)
    }

    // 2) Fall back to Yahoo Finance (forex, commodities native, indices native)
    if (!result) {
      result = await this.fetchFromYahoo(symbol)
    }

    if (result) {
      this.cache.set(symbol, { data: result, timestamp: Date.now() })
      this.evictexpired()
    }

    return result
  }

  /**
   * Get multiple prices at once. Batches parallel requests to respect rate
   * limits (Finnhub free tier: 60 req/min).
   */
  async getMultiplePrices(symbols: string[]): Promise<Map<string, LivePrice>> {
    const results = new Map<string, LivePrice>()
    const unique = [...new Set(symbols.filter(Boolean))]

    // Process in chunks of 8 to stay well under the 60 req/min cap
    const CHUNK_SIZE = 8
    for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
      const chunk = unique.slice(i, i + CHUNK_SIZE)
      const prices = await Promise.all(chunk.map(s => this.getPrice(s)))
      prices.forEach((p, idx) => {
        if (p) results.set(chunk[idx], p)
      })
    }

    return results
  }

  /**
   * Get historical OHLCV candles for charting.
   * Tries Finnhub /stock/candle (and /crypto/candle) first, falls back to
   * Yahoo Finance historical data.
   */
  async getHistoricalData(
    symbol: string,
    resolution: CandleResolution = 'D',
    count: number = 30
  ): Promise<HistoricalCandle[]> {
    const cacheKey = `${symbol}:${resolution}:${count}`
    const cached = this.historicalCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.HISTORICAL_CACHE_DURATION) {
      return cached.data
    }

    let candles: HistoricalCandle[] = []

    // Try Finnhub candles for stocks / crypto / ETFs
    if (isFinnhubSupported(symbol)) {
      candles = await this.fetchCandlesFromFinnhub(symbol, resolution, count)
    }

    // Fallback: Yahoo Finance historical data
    if (candles.length === 0) {
      candles = await this.fetchCandlesFromYahoo(symbol, count)
    }

    if (candles.length > 0) {
      this.historicalCache.set(cacheKey, {
        data: candles,
        timestamp: Date.now(),
      })
    }

    return candles
  }

  // ─── Finnhub Fetchers ──────────────────────────────────────────────────────────

  private async fetchFromFinnhub(symbol: string): Promise<LivePrice | null> {
    try {
      if (!FINNHUB_API_KEY) {
        console.warn(
          '[live-market-data] FINNHUB_API_KEY not set — skipping Finnhub, falling back to Yahoo.'
        )
        return null
      }
      const mapped = resolveFinnhubSymbol(symbol)
      const url = `${BASE_URL}/quote?symbol=${encodeURIComponent(mapped)}`

      const response = await fetch(url, {
        // Cache at the fetch layer too for the same 15s window
        headers: { 'X-Finnhub-Token': FINNHUB_API_KEY },
        next: { revalidate: 15 },
      } as RequestInit)

      if (!response.ok) {
        console.warn(
          `[live-market-data] Finnhub quote HTTP ${response.status} for ${symbol}`
        )
        return null
      }

      const data = await response.json()

      // Finnhub returns { c: 0, d: null, ... } for unsupported / market-closed symbols
      if (!data || data.c === undefined || data.c === 0) {
        return null
      }

      const price: LivePrice = {
        symbol,
        price: data.c,
        change: data.d ?? 0,
        changePercent: data.dp ?? 0,
        high: data.h && data.h !== 0 ? data.h : undefined,
        low: data.l && data.l !== 0 ? data.l : undefined,
        open: data.o && data.o !== 0 ? data.o : undefined,
        previousClose: data.pc ?? undefined,
        volume: undefined, // Finnhub /quote doesn't return volume reliably on free tier
        timestamp: new Date(data.t ? data.t * 1000 : Date.now()),
        source: 'finnhub',
      }

      return price
    } catch (error) {
      console.error(
        `[live-market-data] Finnhub quote failed for ${symbol}:`,
        error
      )
      return null
    }
  }

  private async fetchCandlesFromFinnhub(
    symbol: string,
    resolution: CandleResolution,
    count: number
  ): Promise<HistoricalCandle[]> {
    try {
      if (!FINNHUB_API_KEY) return []
      const mapped = resolveFinnhubSymbol(symbol)
      const to = Math.floor(Date.now() / 1000)
      const from = to - count * 24 * 60 * 60 // approximate day count

      const isCrypto = mapped.startsWith('BINANCE:')
      const endpoint = isCrypto ? 'crypto/candle' : 'stock/candle'

      const url = `${BASE_URL}/${endpoint}?symbol=${encodeURIComponent(
        mapped
      )}&resolution=${resolution}&from=${from}&to=${to}`

      const response = await fetch(url, {
        headers: { 'X-Finnhub-Token': FINNHUB_API_KEY },
        next: { revalidate: 600 },
      } as RequestInit)
      if (!response.ok) return []

      const data = await response.json()
      if (!data || data.s !== 'ok' || !Array.isArray(data.t)) return []

      return data.t.map((t: number, i: number) => ({
        date: new Date(t * 1000).toISOString().split('T')[0],
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v?.[i] ?? 0,
      }))
    } catch (error) {
      console.error(
        `[live-market-data] Finnhub candles failed for ${symbol}:`,
        error
      )
      return []
    }
  }

  // ─── Yahoo Fallback Fetchers ───────────────────────────────────────────────────

  private async fetchFromYahoo(symbol: string): Promise<LivePrice | null> {
    try {
      const yPrice = await marketDataService.getPrice(symbol)
      if (!yPrice || !yPrice.price) return null

      return {
        symbol,
        price: yPrice.price,
        change: yPrice.change,
        changePercent: yPrice.changePercent,
        high: yPrice.high,
        low: yPrice.low,
        open: yPrice.open,
        previousClose: yPrice.previousClose,
        volume: yPrice.volume,
        timestamp: yPrice.timestamp,
        source: 'yahoo',
      }
    } catch (error) {
      console.error(
        `[live-market-data] Yahoo fallback failed for ${symbol}:`,
        error
      )
      return null
    }
  }

  private async fetchCandlesFromYahoo(
    symbol: string,
    count: number
  ): Promise<HistoricalCandle[]> {
    try {
      // Pick a Yahoo period that covers `count` trading days
      const period =
        count <= 5 ? '5d' : count <= 30 ? '1mo' : count <= 90 ? '3mo' : '6mo'

      const yData = await marketDataService.getHistoricalData(symbol, period as any)
      return yData
        .slice(-count)
        .map(d => ({
          date: new Date(d.date).toISOString().split('T')[0],
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume ?? 0,
        }))
    } catch (error) {
      console.error(
        `[live-market-data] Yahoo candles fallback failed for ${symbol}:`,
        error
      )
      return []
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Convenience: get all major market overview symbols in one call.
   */
  async getMarketOverview(): Promise<LivePrice[]> {
    const symbols = [
      'EUR/USD',
      'GBP/USD',
      'BTC/USD',
      'ETH/USD',
      'SPX500',
      'GOLD',
    ]
    const map = await this.getMultiplePrices(symbols)
    return symbols
      .map(s => map.get(s))
      .filter((p): p is LivePrice => p !== null && p !== undefined)
  }

  clearCache(): void {
    this.cache.clear()
    this.historicalCache.clear()
  }
}

export const liveMarketData = new LiveMarketData()
