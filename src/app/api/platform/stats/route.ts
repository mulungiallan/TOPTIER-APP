import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const [totalUsers, countriesAgg, totalSignals, totalPosts] = await Promise.all([
      db.user.count({ where: { role: 'user' } }),
      db.user.groupBy({ by: ['country'], _count: true }),
      db.signal.count(),
      db.post.count({ where: { visibility: 'public' } }),
    ])

    const countries = countriesAgg.filter(c => c.country && c.country.trim()).length

    return successResponse({
      traders: totalUsers,
      countries,
      totalSignals,
      totalPosts,
    })
  } catch (error) {
    console.error('Platform stats error:', error)
    return errorResponse('Failed to fetch platform stats', 500)
  }
}
