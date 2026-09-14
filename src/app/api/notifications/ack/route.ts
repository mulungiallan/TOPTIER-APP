import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { ackNotification, getPendingNotifications } from '@/lib/trading-signals'

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json().catch(() => ({}))
    const id = Number(body.id)
    if (!Number.isInteger(id)) {
      return errorResponse('A numeric notification id is required', 400)
    }

    await ackNotification(id)
    const remaining = await getPendingNotifications(userId)
    return successResponse({ remaining })
  } catch (error: any) {
    console.error('Notification ack error:', error)
    return errorResponse('Failed to acknowledge notification', error?.status || 500)
  }
}