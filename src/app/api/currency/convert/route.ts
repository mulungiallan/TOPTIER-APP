import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { currencies, currencyList, convertCurrency, formatCurrency, refreshCurrencyRates, getRateSource } from '@/lib/currency'

// GET /api/currency/convert?amount=29.99&from=USD&to=KES
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const amountStr = searchParams.get('amount')
    const from = searchParams.get('from') || 'USD'
    const to = searchParams.get('to') || 'USD'

    if (!amountStr) {
      // List currencies
      return successResponse({ currencies: currencyList, rates: getRateSource() })
    }

    const amount = parseFloat(amountStr)
    if (isNaN(amount)) return errorResponse('amount must be a number', 400)
    if (!currencies[from]) return errorResponse(`Unknown source currency: ${from}`, 400)
    if (!currencies[to]) return errorResponse(`Unknown target currency: ${to}`, 400)

    // Use live FX rates when available (falls back to cached/static silently)
    await refreshCurrencyRates()

    const converted = convertCurrency(amount, from, to)
    const formatted = formatCurrency(amount, to)

    return successResponse({
      amount,
      from,
      to,
      converted: Math.round(converted * 100) / 100,
      formatted,
      rate: convertCurrency(1, from, to),
      rates: getRateSource(),
    })
  } catch (error) {
    console.error('Currency convert error:', error)
    return errorResponse('Failed to convert currency', 500)
  }
}
