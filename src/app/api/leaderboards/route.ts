import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { LeaderboardService } from '@/lib/services/social'
import { z } from 'zod'
import { validateQuery } from '@/lib/validation'

const leaderboardQuerySchema = z.object({
  period: z.enum(['week', 'month', 'all']).default('month'),
  limit: z.coerce.number().int().min(1).max(100).default(10),
})

// GET /api/leaderboards?period=month&limit=10
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const parsed = validateQuery(leaderboardQuerySchema, searchParams)
    if (!parsed.success) {
      return errorResponse(parsed.error, 400)
    }
    const { period, limit } = parsed.data

    const traders = await LeaderboardService.getTopTraders(period, limit)
    return successResponse({ traders, period })
  } catch (error) {
    console.error('Leaderboards GET error:', error)
    return errorResponse('Failed to fetch leaderboards', 500)
  }
}
