import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { cancelAlert } from '@/lib/trading-signals'

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json().catch(() => ({}))
    const id = Number(body.id)
    if (!Number.isInteger(id)) {
      return errorResponse('A numeric alert id is required', 400)
    }

    const alert = await cancelAlert(id)
    return successResponse(alert, 200)
  } catch (error: any) {
    console.error('Alert cancel error:', error)
    return errorResponse('Failed to cancel alert', error?.status || 500)
  }
}