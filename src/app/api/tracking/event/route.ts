import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { action, feature, meta, durationSec } = body

    if (!action || typeof action !== 'string') {
      return errorResponse('action is required', 400)
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { analyticsOptOut: true },
    })

    if (!user) {
      return errorResponse('User not found', 404)
    }

    if (user.analyticsOptOut) {
      return successResponse({ tracked: false, reason: 'opt_out' })
    }

    const deviceInfo =
      typeof meta === 'string'
        ? meta.slice(0, 500)
        : request.headers.get('user-agent')?.slice(0, 500) || null

    if (action === 'session_start') {
      const session = await db.usageSession.create({
        data: {
          userId,
          deviceInfo,
        },
      })
      return successResponse({ tracked: true, sessionId: session.id })
    }

    if (action === 'session_update' || action === 'session_end') {
      const open = await db.usageSession.findFirst({
        where: { userId, endedAt: null },
        orderBy: { startedAt: 'desc' },
        select: { id: true, startedAt: true },
      })

      if (open) {
        const elapsed = durationSec != null ? durationSec : Math.round((Date.now() - open.startedAt.getTime()) / 1000)
        await db.usageSession.update({
          where: { id: open.id },
          data: {
            durationSec: Math.max(0, elapsed),
            ...(action === 'session_end' ? { endedAt: new Date() } : {}),
          },
        })
      }
      return successResponse({ tracked: true })
    }

    await db.usageEvent.create({
      data: {
        userId,
        feature: (feature || 'app').toString().slice(0, 64),
        action: action.toString().slice(0, 64),
        meta: meta && typeof meta === 'object' ? JSON.stringify(meta).slice(0, 1000) : meta ? String(meta).slice(0, 1000) : null,
        durationSec: durationSec != null ? Math.round(Number(durationSec)) : null,
      },
    })

    return successResponse({ tracked: true })
  } catch (error) {
    console.error('Tracking event error:', error)
    return errorResponse('Failed to track event', 500)
  }
}
