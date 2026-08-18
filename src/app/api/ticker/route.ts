import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { liveMarketData } from '@/lib/services/live-market-data'

// GET /api/ticker — fetch live prices for the ticker tape
// Pulls ticker symbols from DB, fetches live prices in parallel
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(50, parseInt(searchParams.get('limit') || '24'))

    const tickers = await db.tickerSymbol.findMany({
      where: { isActive: true },
      orderBy: { priority: 'desc' },
      take: limit,
    })

    if (tickers.length === 0) {
      return successResponse({ tickers: [], prices: {} })
    }

    // Fetch live prices in parallel (with 10ms spacing for rate-limit friendliness)
    const prices: Record<string, { price: number; change: number; changePct: number; direction: 'up' | 'down' | 'neutral'; source: string }> = {}

    const symbols = tickers.map((t) => t.symbol)
    const chunks: string[][] = []
    for (let i = 0; i < symbols.length; i += 6) {
      chunks.push(symbols.slice(i, i + 6))
    }

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map((s) => liveMarketData.getPrice(s))
      )
      results.forEach((res, idx) => {
        const sym = chunk[idx]
        if (res.status === 'fulfilled' && res.value) {
          prices[sym] = {
            price: res.value.price,
            change: res.value.change || 0,
            changePct: res.value.changePercent || 0,
            direction: (res.value.change || 0) > 0 ? 'up' : (res.value.change || 0) < 0 ? 'down' : 'neutral',
            source: res.value.source || 'unknown',
          }
        }
      })
    }

    return successResponse({ tickers, prices })
  } catch (error) {
    console.error('Ticker GET error:', error)
    return errorResponse('Failed to fetch ticker data', 500)
  }
}
