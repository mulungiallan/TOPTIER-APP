import { NextRequest } from 'next/server'
import { successResponse, errorResponse } from '@/lib/auth'
import { LeaderboardService } from '@/lib/services/social'

// GET /api/leaderboards?period=month&limit=10
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const period = (searchParams.get('period') as 'week' | 'month' | 'all') || 'month'
    const limit = parseInt(searchParams.get('limit') || '10')

    const traders = await LeaderboardService.getTopTraders(period, limit)
    return successResponse({ traders, period })
  } catch (error) {
    console.error('Leaderboards GET error:', error)
    return errorResponse('Failed to fetch leaderboards', 500)
  }
}
