import { NextRequest } from 'next/server'
import { verifyToken, generateToken, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'

// POST /api/auth/refresh — issues a fresh access token if the current one is
// still valid (or within 1 day of expiry). The client calls this periodically
// to keep the session alive without requiring re-authentication.
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Authentication required', 401)
    }

    const token = authHeader.substring(7).trim()
    const decoded = verifyToken(token)

    if (!decoded?.userId) {
      return errorResponse('Invalid or expired token', 401)
    }

    // The DB is the source of truth for session validity. A token that
    // references an outdated tokenVersion (force logout, ban, password change)
    // is dead on arrival — turn it into a 401 so the client re-authenticates.
    const user = await db.user.findUnique({
      where: { id: decoded.userId },
      select: { tokenVersion: true, isBanned: true, deletedAt: true },
    })
    if (!user || user.deletedAt) {
      return errorResponse('Session has been revoked — please log in again', 401)
    }
    if (user.isBanned) {
      return errorResponse('Account is banned', 403)
    }
    if (user.tokenVersion !== decoded.tokenVersion) {
      return errorResponse('Session has been revoked — please log in again', 401)
    }

    // If token expires within 1 day, issue a fresh one. If it's already
    // expired, reject — the user must re-authenticate.
    const oneDayMs = 24 * 60 * 60 * 1000
    const now = Math.floor(Date.now() / 1000)
    const expiresInMs = (decoded.exp - now) * 1000

    if (expiresInMs < 0) {
      return errorResponse('Token expired — please log in again', 401)
    }

    // Only refresh if token is within 1 day of expiry, or always refresh
    // (the endpoint is also used to extend sessions on active use).
    const newToken = generateToken(decoded.userId, { tokenVersion: decoded.tokenVersion })

    return successResponse({ token: newToken })
  } catch (error) {
    console.error('Token refresh error:', error)
    return errorResponse('Failed to refresh token', 500)
  }
}
