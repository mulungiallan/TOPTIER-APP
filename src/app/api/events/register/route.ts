import { NextRequest } from 'next/server'
import { errorResponse, successResponse } from '@/lib/auth'
import { EventService } from '@/lib/services/event-hub'

// POST /api/events/register — register for an upcoming/live event
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { eventId } = body
    if (!eventId) return errorResponse('eventId is required', 400)

    const registered = await EventService.registerForEvent(eventId)
    return successResponse({ registered })
  } catch (error: any) {
    const msg = error?.message || 'Failed to register for event'
    if (msg === 'Event not found') return errorResponse(msg, 404)
    if (msg === 'Event has already ended') return errorResponse(msg, 400)
    console.error('Register event error:', error)
    return errorResponse('Failed to register for event', 500)
  }
}