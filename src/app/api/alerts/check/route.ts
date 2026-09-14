import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { checkAlerts } from '@/lib/trading-signals'

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const fired = await checkAlerts(userId)
    return successResponse({ fired })
  } catch (error: any) {
    console.error('Alerts check error:', error)
    return errorResponse('Failed to run alert check', error?.status || 500)
  }
}