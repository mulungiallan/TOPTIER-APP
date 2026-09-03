import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // 'price' or 'custom' or null for both

    const result: Record<string, unknown> = {}

    if (!type || type === 'price') {
      result.priceAlerts = await db.priceAlert.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      })
    }

    if (!type || type === 'custom') {
      result.customAlerts = await db.customAlert.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      })
    }

    return successResponse(result)
  } catch (error) {
    console.error('Alerts GET error:', error)
    return errorResponse('Failed to fetch alerts', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { alertCategory } = body // 'price' or 'custom'

    if (alertCategory === 'price') {
      const { asset, alertType, targetPrice, isRecurring, soundEnabled, soundUri, vibrateEnabled, notifyType } = body
      if (!asset || !alertType || !targetPrice) {
        return errorResponse('asset, alertType, and targetPrice are required', 400)
      }

      const alert = await db.priceAlert.create({
        data: {
          userId,
          asset,
          alertType, // above, below, crosses
          targetPrice: parseFloat(targetPrice),
          isRecurring: isRecurring || false,
          soundEnabled: soundEnabled !== undefined ? !!soundEnabled : true,
          soundUri: soundUri ?? null,
          vibrateEnabled: vibrateEnabled !== undefined ? !!vibrateEnabled : true,
          notifyType: notifyType || 'system',
        },
      })

      return successResponse(alert, 201)
    }

    if (alertCategory === 'custom') {
      const { asset, alertType, condition, soundEnabled, soundUri, vibrateEnabled, notifyType } = body
      if (!asset || !alertType || !condition) {
        return errorResponse('asset, alertType, and condition are required', 400)
      }

      const alert = await db.customAlert.create({
        data: {
          userId,
          asset,
          alertType, // rsi, macd, ma_cross, volume_spike, support_resistance
          condition: typeof condition === 'string' ? condition : JSON.stringify(condition),
          soundEnabled: soundEnabled !== undefined ? !!soundEnabled : true,
          soundUri: soundUri ?? null,
          vibrateEnabled: vibrateEnabled !== undefined ? !!vibrateEnabled : true,
          notifyType: notifyType || 'system',
        },
      })

      return successResponse(alert, 201)
    }

    return errorResponse('Invalid alertCategory. Use "price" or "custom"', 400)
  } catch (error) {
    console.error('Alerts POST error:', error)
    return errorResponse('Failed to create alert', 500)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { alertCategory, alertId } = body

    if (!alertCategory || !alertId) {
      return errorResponse('alertCategory and alertId are required', 400)
    }

    if (alertCategory === 'price') {
      const alert = await db.priceAlert.findFirst({ where: { id: alertId, userId } })
      if (!alert) return errorResponse('Alert not found', 404)

      const data: Record<string, unknown> = {}
      if (body.isActive !== undefined) data.isActive = body.isActive
      if (body.asset !== undefined) data.asset = body.asset
      if (body.alertType !== undefined) data.alertType = body.alertType
      if (body.targetPrice !== undefined) data.targetPrice = parseFloat(body.targetPrice)
      if (body.isRecurring !== undefined) data.isRecurring = !!body.isRecurring
      if (body.soundEnabled !== undefined) data.soundEnabled = !!body.soundEnabled
      if (body.soundUri !== undefined) data.soundUri = body.soundUri
      if (body.vibrateEnabled !== undefined) data.vibrateEnabled = !!body.vibrateEnabled
      if (body.notifyType !== undefined) data.notifyType = body.notifyType

      const updated = await db.priceAlert.update({
        where: { id: alertId },
        data,
      })

      return successResponse(updated)
    }

    if (alertCategory === 'custom') {
      const alert = await db.customAlert.findFirst({ where: { id: alertId, userId } })
      if (!alert) return errorResponse('Alert not found', 404)

      const data: Record<string, unknown> = {}
      if (body.isActive !== undefined) data.isActive = body.isActive
      if (body.condition !== undefined) data.condition = typeof body.condition === 'string' ? body.condition : JSON.stringify(body.condition)
      if (body.soundEnabled !== undefined) data.soundEnabled = !!body.soundEnabled
      if (body.soundUri !== undefined) data.soundUri = body.soundUri
      if (body.vibrateEnabled !== undefined) data.vibrateEnabled = !!body.vibrateEnabled
      if (body.notifyType !== undefined) data.notifyType = body.notifyType

      const updated = await db.customAlert.update({
        where: { id: alertId },
        data,
      })

      return successResponse(updated)
    }

    return errorResponse('Invalid alertCategory', 400)
  } catch (error) {
    console.error('Alerts PATCH error:', error)
    return errorResponse('Failed to update alert', 500)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const { searchParams } = new URL(request.url)
    const alertId = searchParams.get('alertId')
    const alertCategory = searchParams.get('alertCategory')

    if (!alertId || !alertCategory) {
      return errorResponse('alertId and alertCategory query params are required', 400)
    }

    if (alertCategory === 'price') {
      const alert = await db.priceAlert.findFirst({ where: { id: alertId, userId } })
      if (!alert) return errorResponse('Alert not found', 404)

      await db.priceAlert.delete({ where: { id: alertId } })
      return successResponse({ deleted: true })
    }

    if (alertCategory === 'custom') {
      const alert = await db.customAlert.findFirst({ where: { id: alertId, userId } })
      if (!alert) return errorResponse('Alert not found', 404)

      await db.customAlert.delete({ where: { id: alertId } })
      return successResponse({ deleted: true })
    }

    return errorResponse('Invalid alertCategory', 400)
  } catch (error) {
    console.error('Alerts DELETE error:', error)
    return errorResponse('Failed to delete alert', 500)
  }
}
