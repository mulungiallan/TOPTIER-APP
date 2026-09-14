import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import {
  listAlerts,
  createPriceAlert,
  createTpSlAlert,
  createIndicatorAlert,
  createSignalAlert,
  INDICATOR_FIELDS,
  SIGNAL_STRATEGIES,
} from '@/lib/trading-signals'

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || undefined
    const category = searchParams.get('category') || undefined

    const alerts = await listAlerts(userId, status, category)
    return successResponse({ alerts })
  } catch (error: any) {
    console.error('Alerts GET error:', error)
    return errorResponse('Failed to fetch alerts', error?.status || 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { category, market, symbol, sound, vibration } = body

    if (!category || !market || !symbol) {
      return errorResponse('category, market, and symbol are required', 400)
    }

    const base = {
      market: String(market).toLowerCase(),
      symbol: String(symbol),
      sound: String(sound || 'default'),
      vibration: String(vibration || 'default'),
      user_id: userId,
    }

    if (category === 'price') {
      const condition = body.condition // 'above' | 'below'
      const threshold = parseFloat(body.threshold)
      if (!['above', 'below'].includes(condition) || !Number.isFinite(threshold)) {
        return errorResponse('price alerts need condition (above|below) and a numeric threshold', 400)
      }
      const alert = await createPriceAlert({ ...base, condition, threshold, note: body.note })
      return successResponse(alert, 201)
    }

    if (category === 'tp_sl') {
      const side = body.side // 'buy' | 'sell'
      const entryPrice = parseFloat(body.entryPrice)
      const takeProfit = body.takeProfit != null && body.takeProfit !== '' ? parseFloat(body.takeProfit) : undefined
      const stopLoss = body.stopLoss != null && body.stopLoss !== '' ? parseFloat(body.stopLoss) : undefined
      if (!['buy', 'sell'].includes(side) || !Number.isFinite(entryPrice)) {
        return errorResponse('tp_sl alerts need side (buy|sell) and a numeric entryPrice', 400)
      }
      if (takeProfit == null && stopLoss == null) {
        return errorResponse('Provide at least a take profit or stop loss price', 400)
      }
      const created = await createTpSlAlert({
        ...base,
        side,
        entry_price: entryPrice,
        take_profit_price: takeProfit,
        stop_loss_price: stopLoss,
        linked_order_id: body.linkedOrderId ?? null,
      })
      return successResponse(created, 201)
    }

    if (category === 'indicator') {
      const field = String(body.field || '')
      const comparator = String(body.comparator || '>')
      const threshold = parseFloat(body.threshold)
      if (!INDICATOR_FIELDS.includes(field)) {
        return errorResponse(`Unknown indicator field "${field}". Options: ${INDICATOR_FIELDS.join(', ')}`, 400)
      }
      if (!['>', '<'].includes(comparator) || !Number.isFinite(threshold)) {
        return errorResponse('indicator alerts need comparator (>|<) and a numeric threshold', 400)
      }
      const alert = await createIndicatorAlert({ ...base, field, comparator: comparator as '>' | '<', threshold, note: body.note })
      return successResponse(alert, 201)
    }

    if (category === 'signal') {
      const strategyName = String(body.strategyName || '')
      const targetValue = parseInt(body.targetValue, 10)
      if (!SIGNAL_STRATEGIES.includes(strategyName)) {
        return errorResponse(`Unknown strategy "${strategyName}". Options: ${SIGNAL_STRATEGIES.join(', ')}`, 400)
      }
      if (![1, 0, -1].includes(targetValue)) {
        return errorResponse('signal targetValue must be 1 (bullish), 0 (flat), or -1 (bearish)', 400)
      }
      const alert = await createSignalAlert({ ...base, strategy_name: strategyName, target_value: targetValue, note: body.note })
      return successResponse(alert, 201)
    }

    return errorResponse('Invalid category. Use "price", "tp_sl", "indicator", or "signal"', 400)
  } catch (error: any) {
    console.error('Alerts POST error:', error)
    return errorResponse('Failed to create alert', error?.status || 500)
  }
}