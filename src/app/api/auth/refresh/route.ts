import { NextRequest } from 'next/server'
import { verifyToken, generateToken, successResponse, errorResponse } from '@/lib/auth'

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
