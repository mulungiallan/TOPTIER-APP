/**
 * TOPTIER Auto News Ingester
 *
 * Pulls financial/market news from Finnhub's news endpoints (company-news and
 * general news) using the existing FINNHUB_API_KEY, classifies each article by
 * category and sentiment, and persists it into the NewsArticle table.
 *
 * This keeps the News page populated automatically from a real news source —
 * no manual/admin entry or cron required. A short in-memory TTL throttles how
 * often we hit the upstream API, and lazy population runs on read when the
 * table is empty or stale.
 */

import { db } from '@/lib/db'
import { env } from '@/lib/env'

const FINNHUB_API_KEY = env.finnhubApiKey
const BASE_URL = 'https://finnhub.io/api/v1'

// Symbols the app tracks — used to pull "company news" per symbol in addition
// to the general market-news feed.
const TRACKED_SYMBOLS = ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'BTC-USD', 'ETH-USD']

const BANNED_PREFIXES = ['http', 'https'] // safety: never accept non-headline junk

function slugToCategory(lower: string): string {
  if (lower.includes('bitcoin') || lower.includes('ethereum') || lower.includes('crypto') || lower.includes('btc') || lower.includes('eth')) {
    return 'crypto'
  }
  if (lower.includes('forex') || lower.includes('currency') || lower.includes('dollar') || lower.includes('yen') || lower.includes('euro') || lower.includes('eur') || lower.includes('usd')) {
    return 'forex'
  }
  if (lower.includes('stock') || lower.includes('equit') || lower.includes('share') || lower.includes('earnings') || lower.includes('ipo') || lower.includes('nasdaq') || lower.includes('nyse')) {
    return 'stocks'
  }
  if (lower.includes('gold') || lower.includes('oil') || lower.includes('silver') || lower.includes('commodit') || lower.includes('crude') || lower.includes('gas')) {
    return 'commodities'
  }
  return 'economy'
}

function detectSentiment(title: string, summary: string): 'bullish' | 'bearish' | 'neutral' {
  const text = `${title} ${summary}`.toLowerCase()
  const bullish = ['surge', 'soar', 'rally', 'gain', 'jump', 'climb', 'up', 'beat', 'record', 'boost', 'rise', 'upgrade', 'bullish', 'outperform', 'outlook positive']
  const bearish = ['plunge', 'drop', 'fall', 'decline', 'slump', 'tumble', 'down', 'miss', 'cut', 'crash', 'selloff', 'bearish', 'downgrade', 'underperform', 'warning', 'collapse']
  let score = 0
  for (const w of bullish) if (text.includes(w)) score++
  for (const w of bearish) if (text.includes(w)) score--
  if (score > 0) return 'bullish'
  if (score < 0) return 'bearish'
  return 'neutral'
}

function extractAssets(title: string, summary: string, category: string): string[] {
  const text = `${title} ${summary}`.toUpperCase()
  const assets: string[] = []
  const known = ['BTC', 'ETH', 'XRP', 'SOL', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'GOLD', 'SILVER', 'OIL', 'AAPL', 'TSLA', 'MSFT', 'NVDA', 'SPX']
  known.forEach((a) => {
    if (text.includes(a)) assets.push(a)
  })
  // Include the category's primary asset if none detected.
  if (assets.length === 0 && category === 'crypto') assets.push('BTC')
  if (assets.length === 0 && category === 'forex') assets.push('EUR/USD')
  if (assets.length === 0 && category === 'commodities') assets.push('GOLD')
  const deduped = [...new Set(assets)]
  return deduped.slice(0, 5)
}

function normalizeHeadline(headline: string): string {
  return (headline || '').trim().replace(/^["']+|["']+$/g, '').slice(0, 300)
}

export class NewsIngester {
  private lastRun = 0
  private static REFRESH_MS = 15 * 60 * 1000 // refresh at most every 15 min

  /**
   * Ensure the NewsArticle table is populated with recent real news.
   * Calls the upstream Finnhub news API only when the table is stale/empty.
   */
  async ensureNews(force = false): Promise<boolean> {
    if (!FINNHUB_API_KEY) {
      console.warn('[news-ingester] FINNHUB_API_KEY not set — skipping news ingestion.')
      return false
    }

    const now = Date.now()
    // If we already have fresh articles, nothing to do.
    const recent = await db.newsArticle.findFirst({
      orderBy: { publishedAt: 'desc' },
      select: { publishedAt: true },
    })
    const fresh =
      recent && recent.publishedAt &&
      now - recent.publishedAt.getTime() < NewsIngester.REFRESH_MS

    if (!force && fresh) {
      return true
    }
    if (!force && now - this.lastRun < NewsIngester.REFRESH_MS) {
      return (await db.newsArticle.count()) > 0
    }

    this.lastRun = now
    return this.ingestBatch()
  }

  private async ingestBatch(): Promise<boolean> {
    let stored = 0

    // 1. General market news.
    try {
      stored += await this.ingestGeneralNews()
    } catch (err) {
      console.warn('[news-ingester] general news failed:', err instanceof Error ? err.message : err)
    }

    // 2. Company news for tracked symbols.
    for (const sym of TRACKED_SYMBOLS) {
      try {
        stored += await this.ingestCompanyNews(sym)
        await new Promise((r) => setTimeout(r, 300))
      } catch (err) {
        console.warn(`[news-ingester] company news ${sym} failed:`, err instanceof Error ? err.message : err)
      }
    }

    return stored > 0
  }

  private async ingestGeneralNews(): Promise<number> {
    const to = Math.floor(Date.now() / 1000)
    const from = to - 24 * 60 * 60
    const url = `${BASE_URL}/news?category=general&minId=0&from=${from}&to=${to}`

    const res = await fetch(url, { headers: { 'X-Finnhub-Token': FINNHUB_API_KEY as string } })
    if (!res.ok) return 0
    const items = (await res.json()) as Array<Record<string, unknown>>

    let count = 0
    for (const item of items) {
      const saved = await this.storeArticle(item)
      if (saved) count++
    }
    return count
  }

  private async ingestCompanyNews(symbol: string): Promise<number> {
    const to = Math.floor(Date.now() / 1000)
    const from = to - 24 * 60 * 60
    const url = `${BASE_URL}/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`

    const res = await fetch(url, { headers: { 'X-Finnhub-Token': FINNHUB_API_KEY as string } })
    if (!res.ok) return 0
    const items = (await res.json()) as Array<Record<string, unknown>>

    let count = 0
    for (const item of items) {
      const saved = await this.storeArticle(item, symbol)
      if (saved) count++
    }
    return count
  }

  private async storeArticle(item: Record<string, unknown>, fallbackSymbol?: string): Promise<boolean> {
    const headline = normalizeHeadline(item.headline as string)
    const url = (item.url as string) || ''
    if (!headline || !url || BANNED_PREFIXES.some((p) => !url.toLowerCase().startsWith(p))) return false

    const summary = String(item.summary || '').trim().slice(0, 500)
    const rawSource = String(item.source || 'Finnhub')
    const sourceName = rawSource.split('.')[0].toUpperCase() || 'FINNHUB'
    const category = slugToCategory(`${headline} ${summary} ${fallbackSymbol || ''}`)
    const sentiment = detectSentiment(headline, summary)
    const assets = extractAssets(headline, summary, category)
    const ts = Number(item.datetime)
    const publishedAt = ts ? new Date(ts * 1000) : new Date()

    // Avoid duplicates by URL.
    const existing = await db.newsArticle.findFirst({ where: { url } })
    if (existing) return false

    try {
      await db.newsArticle.create({
        data: {
          title: headline,
          summary,
          content: summary,
          source: sourceName,
          url,
          sentiment,
          taggedAssets: assets.join(','),
          category,
          publishedAt,
        },
      })
      return true
    } catch (err) {
      console.warn('[news-ingester] failed to store article:', err instanceof Error ? err.message : err)
      return false
    }
  }
}

// Singleton
export const newsIngester = new NewsIngester()
