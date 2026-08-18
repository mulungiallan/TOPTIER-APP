import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { getLocalizedPrice, refreshCurrencyRates, getRateSource } from '@/lib/currency'

// GET /api/pricing/localize?price=29.99&country=KE
// Returns localized price with PPP discount + currency conversion
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const priceStr = searchParams.get('price')
    const country = searchParams.get('country') || undefined

    if (!priceStr) return errorResponse('price is required', 400)
    const price = parseFloat(priceStr)
    if (isNaN(price)) return errorResponse('price must be a number', 400)

    // Use live FX rates when available (falls back to cached/static silently)
    await refreshCurrencyRates()

    const localized = getLocalizedPrice(price, country)
    return successResponse({ localized, rates: getRateSource() })
  } catch (error) {
    console.error('Localize price error:', error)
    return errorResponse('Failed to localize price', 500)
  }
}
