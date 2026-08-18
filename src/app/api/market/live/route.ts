// src/app/api/market/live/route.ts
// Live market data API powered by Finnhub + Yahoo Finance fallback.
// All endpoints are unauthenticated (market data is public).

import { NextRequest } from 'next/server'
import { liveMarketData, type CandleResolution } from '@/lib/services/live-market-data'
import { successResponse, errorResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 10

const VALID_RESOLUTIONS: CandleResolution[] = ['1', '5', '15', '30', '60', 'D', 'W', 'M']

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'quote'
    const symbol = (searchParams.get('symbol') || '').trim().toUpperCase()
    const symbolsParam = searchParams.get('symbols') || ''
    const rawResolution = searchParams.get('resolution') || 'D'
    const resolution = (VALID_RESOLUTIONS.includes(rawResolution as CandleResolution) ? rawResolution : 'D') as CandleResolution
    const count = Math.min(
      Math.max(parseInt(searchParams.get('count') || '30', 10) || 30, 1),
      365
    )

    switch (action) {
      case 'quote': {
        if (!symbol) {
          return errorResponse('symbol parameter required for action=quote', 400)
        }
        const price = await liveMarketData.getPrice(symbol)
        if (!price) {
          return errorResponse(`No data for ${symbol}`, 404)
        }
        return successResponse({ price })
      }

      case 'quotes': {
        if (!symbolsParam) {
          return errorResponse(
            'symbols parameter (comma-separated) required for action=quotes',
            400
          )
        }
        const symbols = symbolsParam
          .split(',')
          .map(s => s.trim().toUpperCase())
          .filter(Boolean)
        const pricesMap = await liveMarketData.getMultiplePrices(symbols)
        const prices = symbols
          .map(s => pricesMap.get(s))
          .filter((p): p is NonNullable<typeof p> => p !== null && p !== undefined)
        return successResponse({ prices, count: prices.length })
      }

      case 'market': {
        const prices = await liveMarketData.getMarketOverview()
        return successResponse({ prices, count: prices.length })
      }

      case 'historical': {
        if (!symbol) {
          return errorResponse(
            'symbol parameter required for action=historical',
            400
          )
        }
        const candles = await liveMarketData.getHistoricalData(
          symbol,
          resolution,
          count
        )
        return successResponse({
          symbol,
          resolution,
          count: candles.length,
          candles,
        })
      }

      default:
        return errorResponse(
          `Invalid action. Valid actions: quote, quotes, market, historical`,
          400
        )
    }
  } catch (error) {
    console.error('Live market API error:', error)
    return errorResponse('Failed to fetch live market data', 500)
  }
}
