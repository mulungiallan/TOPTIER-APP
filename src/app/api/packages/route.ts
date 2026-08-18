import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

/**
 * GET /api/packages
 * Returns all active packages + the caller's current plan and usage.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)

    // Fetch all active packages, cheapest first
    const packages = await db.package.findMany({
      where: { isActive: true },
      orderBy: [{ duration: 'asc' }, { price: 'asc' }],
    })

    // Serialize features (stored as JSON string in SQLite)
    const serialized = packages.map((p) => ({
      ...p,
      features: safeParseFeatures(p.features),
    }))

    // Get caller's plan + usage if logged in
    let userPlan: {
      plan: string
      analysesLimit: number
      analysesUsed: number
      planExpiresAt: Date | null
      analysesResetAt: Date | null
    } | null = null

    if (userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: {
          plan: true,
          analysesLimit: true,
          analysesUsed: true,
          planExpiresAt: true,
          analysesResetAt: true,
        },
      })
      if (user) {
        // Reset monthly counter if a month has elapsed
        let { analysesUsed, analysesResetAt } = user
        const now = new Date()
        if (!analysesResetAt || analysesResetAt.getMonth() !== now.getMonth() || analysesResetAt.getFullYear() !== now.getFullYear()) {
          analysesUsed = 0
          analysesResetAt = now
          await db.user.update({
            where: { id: userId },
            data: { analysesUsed: 0, analysesResetAt: now },
          })
        }
        userPlan = {
          plan: user.plan,
          analysesLimit: user.analysesLimit,
          analysesUsed,
          planExpiresAt: user.planExpiresAt,
          analysesResetAt,
        }
      }
    }

    return successResponse({ packages: serialized, userPlan })
  } catch (error) {
    console.error('Packages GET error:', error)
    return errorResponse('Failed to fetch packages', 500)
  }
}

function safeParseFeatures(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
