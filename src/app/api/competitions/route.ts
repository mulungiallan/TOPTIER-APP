import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { CompetitionService } from '@/lib/services/social'

// GET /api/competitions?status=active
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || undefined

    const competitions = await CompetitionService.listCompetitions(status)
    return successResponse({ competitions })
  } catch (error) {
    console.error('Competitions GET error:', error)
    return errorResponse('Failed to fetch competitions', 500)
  }
}

// POST /api/competitions — create a new competition
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { name, description, type, startDate, endDate, entryFee, maxParticipants } = body

    if (!name || !startDate || !endDate) {
      return errorResponse('name, startDate, endDate are required', 400)
    }
    if (name.length > 100) return errorResponse('Name too long (max 100 characters)', 400)
    if (description && description.length > 1000) return errorResponse('Description too long (max 1000 characters)', 400)

    const competition = await CompetitionService.createCompetition(userId, {
      name, description, type, startDate, endDate, entryFee, maxParticipants,
    })
    return successResponse({ competition }, 201)
  } catch (error) {
    console.error('Competitions POST error:', error)
    return errorResponse('Failed to create competition', 500)
  }
}
