import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // The registered-user count is admin-only, but the endpoint itself stays
    // public so the marketing figures (signals, posts, countries) still render
    // for signed-out visitors.
    //
    // `traders` is OMITTED rather than zeroed for everyone else: a 0 would be a
    // lie about a live platform, and null would confirm the field exists while
    // hiding nothing. Absent is the only honest shape.
    //
    // requireAdmin() is reused instead of a second role check. A non-admin is not
    // an error here - it just means they do not get the number.
    const { user: admin } = await requireAdmin(request)

    const [countriesAgg, totalSignals, totalPosts] = await Promise.all([
      db.user.groupBy({ by: ['country'], _count: true }),
      db.signal.count(),
      db.post.count({ where: { visibility: 'public' } }),
    ])

    const countries = countriesAgg.filter(c => c.country && c.country.trim()).length

    const payload: {
      countries: number
      totalSignals: number
      totalPosts: number
      traders?: number
    } = { countries, totalSignals, totalPosts }

    if (admin) {
      payload.traders = await db.user.count({ where: { role: 'user' } })
    }

    return successResponse(payload)
  } catch (error) {
    console.error('Platform stats error:', error)
    return errorResponse('Failed to fetch platform stats', 500)
  }
}
