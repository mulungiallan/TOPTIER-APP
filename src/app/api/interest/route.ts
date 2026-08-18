import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

// POST /api/interest — records a signed-in user's interest in a paid plan.
// Used during soft launch when payments are disabled.
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Not authenticated', 401)
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const { packageId } = body as { packageId?: string }

    await db.activityLog.create({
      data: {
        userId,
        action: 'premium_interest',
        details: packageId ?? 'unspecified',
      },
    })

    return successResponse({ success: true })
  } catch (error) {
    console.error('Interest POST error:', error)
    return errorResponse('Failed to record interest', 500)
  }
}
