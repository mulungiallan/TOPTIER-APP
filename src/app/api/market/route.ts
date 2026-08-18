// src/app/api/market/route.ts
// Market data API endpoints powered by Yahoo Finance (real-time)

import { NextRequest } from 'next/server'
import { marketDataService, type HistoricalPeriod } from '@/lib/services/market-data'
import { successResponse, errorResponse } from '@/lib/auth'

const VALID_PERIODS: HistoricalPeriod[] = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y']

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'quote'
    const symbol = searchParams.get('symbol')
    const symbols = searchParams.get('symbols')
    const rawPeriod = searchParams.get('period') || '1mo'
    const period = (VALID_PERIODS.includes(rawPeriod as HistoricalPeriod) ? rawPeriod : '1mo') as HistoricalPeriod
    const query = searchParams.get('q')

    switch (action) {
      case 'quote': {
        if (!symbol) {
          return errorResponse('symbol parameter required for action=quote', 400)
        }
        const price = await marketDataService.getPrice(symbol)
        if (!price) {
          return errorResponse(`Failed to fetch price for ${symbol}`, 404)
        }
        return successResponse({ price })
      }

      case 'quotes': {
        if (!symbols) {
          return errorResponse('symbols parameter (comma-separated) required for action=quotes', 400)
        }
        const symbolList = symbols.split(',').map(s => s.trim()).filter(Boolean)
        const pricesMap = await marketDataService.getMultiplePrices(symbolList)
        const prices = Array.from(pricesMap.values())
        return successResponse({ prices, count: prices.length })
      }

      case 'history':
      case 'historical': {
        if (!symbol) {
          return errorResponse('symbol parameter required for action=historical', 400)
        }
        const data = await marketDataService.getHistoricalData(symbol, period)
        return successResponse({
          symbol,
          period,
          data,
          count: data.length,
        })
      }

      case 'search': {
        if (!query) {
          return errorResponse('q parameter required for action=search', 400)
        }
        const results = await marketDataService.searchSymbols(query)
        return successResponse({ query, results, count: results.length })
      }

      case 'summary': {
        const prices = await marketDataService.getMarketSummary()
        return successResponse({ prices, count: prices.length })
      }

      default:
        return errorResponse(
          `Invalid action. Valid actions: quote, quotes, historical, search, summary`,
          400
        )
    }
  } catch (error) {
    console.error('Market data API error:', error)
    return errorResponse('Failed to fetch market data', 500)
  }
}
