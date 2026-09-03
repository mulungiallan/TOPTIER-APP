// src/lib/services/market-data.ts
// Real market data integration using Yahoo Finance API (yahoo-finance2)
// Free tier - no API key required for basic quotes

import YahooFinance from 'yahoo-finance2'
import { env } from '@/lib/env'

const FINNHUB_API_KEY = env.finnhubApiKey

// yahoo-finance2 v3 requires instantiation via `new YahooFinance()` before use.
// Reuse a single instance across the whole process for connection pooling.
//
// Yahoo Finance bot-checks datacenter traffic and can answer requests with an
// HTTP redirect to a consent/bot page, which the library surfaces as a
// "Unexpected redirect to https://finance.yahoo.com/quote/<SYM>" error. Sending
// a realistic browser User-Agent on every request is the standard mitigation and
// greatly reduces the rate at which Yahoo redirects/rate-limits us.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const yahooFinance = new YahooFinance({
  fetchOptions: {
    headers: { 'User-Agent': USER_AGENT },
  },
  validation: { logErrors: false, logOptionsErrors: false },
})

// Suppress yahoo-finance2 deprecation notices in production
;(yahooFinance as any).suppressNotices?.(['yahooSurvey'])

// Max attempts per quote as a safety net against Yahoo's transient redirects.
const QUOTE_ATTEMPTS = 2

export interface MarketPrice {
  symbol: string
  price: number
  change: number
  changePercent: number
  volume: number
  timestamp: Date
  high?: number
  low?: number
  open?: number
  previousClose?: number
  marketCap?: number
  currency?: string
  exchangeName?: string
}

export interface HistoricalData {
  date: Date
  open: number
  high: number
  low: number
  close: number
  adjClose?: number
  volume: number
}

export type HistoricalPeriod = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '5y'

// Map common trading symbols to Yahoo Finance symbols
const SYMBOL_MAP: Record<string, string> = {
  'EUR/USD': 'EURUSD=X',
  'GBP/USD': 'GBPUSD=X',
  'USD/JPY': 'USDJPY=X',
  'USD/CHF': 'USDCHF=X',
  'AUD/USD': 'AUDUSD=X',
  'USD/CAD': 'USDCAD=X',
  'NZD/USD': 'NZDUSD=X',
  'BTC/USD': 'BTC-USD',
  'ETH/USD': 'ETH-USD',
  'XRP/USD': 'XRP-USD',
  'LTC/USD': 'LTC-USD',
  'GOLD': 'GC=F',
  'XAU/USD': 'GC=F',
  'SILVER': 'SI=F',
  'XAG/USD': 'SI=F',
  'OIL': 'CL=F',
  'BRENT': 'BZ=F',
  'SPX 500': '^GSPC',
  'SPX500': '^GSPC',
  'NASDAQ': '^IXIC',
  'DOW': '^DJI',
  'DAX': '^GDAXI',
  'FTSE': '^FTSE',
  'NIKKEI': '^N225',
}

function resolveYahooSymbol(symbol: string): string {
  if (SYMBOL_MAP[symbol.toUpperCase()]) {
    return SYMBOL_MAP[symbol.toUpperCase()]
  }
  return symbol
}

// Finnhub fallback used when Yahoo is IP-blocked. Covers the symbols Finnhub's
// free /quote endpoint can actually serve (stocks, crypto via BINANCE, and EUR/
// USD-style forex via OANDA). If a symbol has no Finnhub mapping it is passed
// through as-is (works for plain stock tickers like AAPL).
const FINNHUB_FALLBACK_MAP: Record<string, string> = {
  'EUR/USD': 'OANDA:EURUSD',
  'GBP/USD': 'OANDA:GBPUSD',
  'USD/JPY': 'OANDA:USDJPY',
  'USD/CHF': 'OANDA:USDCHF',
  'AUD/USD': 'OANDA:AUDUSD',
  'USD/CAD': 'OANDA:USDCAD',
  'NZD/USD': 'OANDA:NZDUSD',
  'EUR/GBP': 'OANDA:EURGBP',
  'GBP/JPY': 'OANDA:GBPJPY',
  'BTC/USD': 'BINANCE:BTCUSDT',
  'BTC-USD': 'BINANCE:BTCUSDT',
  'ETH/USD': 'BINANCE:ETHUSDT',
  'ETH-USD': 'BINANCE:ETHUSDT',
  'SOL/USD': 'BINANCE:SOLUSDT',
  'XRP/USD': 'BINANCE:XRPUSDT',
  'LTC/USD': 'BINANCE:LTCUSDT',
}

function resolveFinnhubSymbol(symbol: string): string {
  const upper = symbol.toUpperCase()
  return FINNHUB_FALLBACK_MAP[upper] || upper
}

export class MarketDataService {
  private cache: Map<string, { data: MarketPrice; timestamp: number }> = new Map()
  private historicalCache: Map<string, { data: HistoricalData[]; timestamp: number }> = new Map()
  private CACHE_DURATION = 60_000 // 1 minute for quotes
  private HISTORICAL_CACHE_DURATION = 300_000 // 5 minutes for historical data
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

  async getPrice(symbol: string): Promise<MarketPrice | null> {
    try {
      const yahooSymbol = resolveYahooSymbol(symbol)

      const cached = this.cache.get(yahooSymbol)
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.data
      }

      let quote: any
      let lastErr: unknown

      for (let attempt = 1; attempt <= QUOTE_ATTEMPTS; attempt++) {
        try {
          quote = (await yahooFinance.quote(yahooSymbol)) as any
          break
        } catch (err) {
          lastErr = err
          // Retry once after a short pause; a retry often succeeds when the
          // failure was Yahoo's transient redirect/rate-limit.
          if (attempt < QUOTE_ATTEMPTS) {
            await new Promise(r => setTimeout(r, 500 * attempt))
          }
        }
      }

      if (!quote) {
        throw lastErr ?? new Error(`No quote received for ${yahooSymbol}`)
      }

      const price: MarketPrice = {
        symbol,
        price: quote.regularMarketPrice ?? 0,
        change: quote.regularMarketChange ?? 0,
        changePercent: quote.regularMarketChangePercent ?? 0,
        volume: quote.regularMarketVolume ?? 0,
        timestamp: new Date(),
        high: quote.regularMarketDayHigh ?? undefined,
        low: quote.regularMarketDayLow ?? undefined,
        open: quote.regularMarketOpen ?? undefined,
        previousClose: quote.regularMarketPreviousClose ?? undefined,
        marketCap: quote.marketCap ?? undefined,
        currency: quote.currency ?? undefined,
        exchangeName: quote.fullExchangeName ?? undefined,
      }

      this.cache.set(yahooSymbol, { data: price, timestamp: Date.now() })
      this.evictexpired()
      return price
    } catch (error) {
      // Yahoo is frequently IP-blocked from datacenter egress (it redirects to a
      // bot-check page). When Yahoo fails, fall back to Finnhub so live prices
      // still resolve for the symbols Finnhub can serve.
      const fb = await this.fetchFinnhubPrice(symbol)
      if (fb) {
        this.cache.set(symbol.toUpperCase(), { data: fb, timestamp: Date.now() })
        this.evictexpired()
        return fb
      }
      console.error(`Failed to fetch price for ${symbol}:`, error)
      return null
    }
  }

  private async fetchFinnhubPrice(symbol: string): Promise<MarketPrice | null> {
    if (!FINNHUB_API_KEY) return null
    try {
      const mapped = resolveFinnhubSymbol(symbol)
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(mapped)}`,
        { headers: { 'X-Finnhub-Token': FINNHUB_API_KEY } }
      )
      if (!res.ok) return null
      const data = await res.json()
      if (!data || data.c === undefined || data.c === 0) return null
      return {
        symbol,
        price: data.c,
        change: data.d ?? 0,
        changePercent: data.dp ?? 0,
        volume: 0,
        timestamp: new Date(data.t ? data.t * 1000 : Date.now()),
        high: data.h && data.h !== 0 ? data.h : undefined,
        low: data.l && data.l !== 0 ? data.l : undefined,
        open: data.o && data.o !== 0 ? data.o : undefined,
        previousClose: data.pc ?? undefined,
      }
    } catch {
      return null
    }
  }

  async getMultiplePrices(symbols: string[]): Promise<Map<string, MarketPrice>> {
    const results = new Map<string, MarketPrice>()
    const uniqueSymbols = [...new Set(symbols)]
    const promises = uniqueSymbols.map(s => this.getPrice(s))
    const prices = await Promise.all(promises)

    prices.forEach((price, index) => {
      if (price) {
        results.set(uniqueSymbols[index], price)
      }
    })

    return results
  }

  async getHistoricalData(
    symbol: string,
    period: HistoricalPeriod = '1mo'
  ): Promise<HistoricalData[]> {
    try {
      const yahooSymbol = resolveYahooSymbol(symbol)
      const cacheKey = `${yahooSymbol}:${period}`

      const cached = this.historicalCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < this.HISTORICAL_CACHE_DURATION) {
        return cached.data
      }

      const endDate = new Date()
      const startDate = new Date()

      switch (period) {
        case '1d':
          startDate.setDate(startDate.getDate() - 1)
          break
        case '5d':
          startDate.setDate(startDate.getDate() - 5)
          break
        case '1mo':
          startDate.setMonth(startDate.getMonth() - 1)
          break
        case '3mo':
          startDate.setMonth(startDate.getMonth() - 3)
          break
        case '6mo':
          startDate.setMonth(startDate.getMonth() - 6)
          break
        case '1y':
          startDate.setFullYear(startDate.getFullYear() - 1)
          break
        case '5y':
          startDate.setFullYear(startDate.getFullYear() - 5)
          break
      }

      const result = (await yahooFinance.historical(yahooSymbol, {
        period1: startDate,
        period2: endDate,
        interval: '1d',
      })) as any[]

      const historical: HistoricalData[] = result.map(item => ({
        date: item.date,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        adjClose: item.adjClose,
        volume: item.volume,
      }))

      this.historicalCache.set(cacheKey, {
        data: historical,
        timestamp: Date.now(),
      })

      return historical
    } catch (error) {
      console.error(`Failed to fetch historical data for ${symbol}:`, error)
      return []
    }
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; name: string; exchange?: string }>> {
    try {
      const result = (await yahooFinance.search(query)) as any
      return result.quotes
        .filter((q: any) => q.symbol)
        .slice(0, 10)
        .map((q: any) => ({
          symbol: q.symbol,
          name: q.shortname || q.longname || q.symbol,
          exchange: q.exchange,
        }))
    } catch (error) {
      console.error(`Failed to search symbols for "${query}":`, error)
      return []
    }
  }

  async getMarketSummary(): Promise<MarketPrice[]> {
    const majorSymbols = [
      'EUR/USD',
      'GBP/USD',
      'USD/JPY',
      'BTC/USD',
      'ETH/USD',
      'GOLD',
      'SPX 500',
      'NASDAQ',
    ]

    const pricesMap = await this.getMultiplePrices(majorSymbols)
    return majorSymbols
      .map(s => pricesMap.get(s))
      .filter((p): p is MarketPrice => p !== null && p !== undefined)
  }

  clearCache(): void {
    this.cache.clear()
    this.historicalCache.clear()
  }
}

export const marketDataService = new MarketDataService()
