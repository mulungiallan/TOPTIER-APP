import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { EventService, ensureHubContent } from '@/lib/services/event-hub'

// GET /api/events?status=live|upcoming|ended
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    // Fire-and-forget: make sure the rolling schedule exists on first visit.
    ensureHubContent().catch((err) => console.error('Event hub seed error:', err))

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as 'upcoming' | 'live' | 'ended' | null

    const events = await EventService.listEvents(status ?? undefined)
    return successResponse({ events })
  } catch (error) {
    console.error('Events GET error:', error)
    return errorResponse('Failed to fetch events', 500)
  }
}