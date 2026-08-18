import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { CompetitionService } from '@/lib/services/social'

// POST /api/competitions/join — join a competition
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { competitionId } = body
    if (!competitionId) return errorResponse('competitionId is required', 400)

    const entry = await CompetitionService.joinCompetition(competitionId, userId)
    return successResponse({ entry }, 201)
  } catch (error) {
    console.error('Join competition error:', error)
    return errorResponse('Failed to join competition', 500)
  }
}
