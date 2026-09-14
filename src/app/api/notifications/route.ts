import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { getPendingNotifications, getNotificationHistory } from '@/lib/trading-signals'

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope') || 'pending'

    if (scope === 'history') {
      const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)
      const notifications = await getNotificationHistory(userId, Number.isFinite(limit) ? limit : 50)
      return successResponse({ notifications })
    }

    const notifications = await getPendingNotifications(userId)
    return successResponse({ notifications })
  } catch (error: any) {
    console.error('Notifications GET error:', error)
    return errorResponse('Failed to fetch notifications', error?.status || 500)
  }
}