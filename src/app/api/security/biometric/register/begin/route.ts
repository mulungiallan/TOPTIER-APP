import { NextRequest } from 'next/server'
import { getUserIdFromRequest, errorResponse, successResponse } from '@/lib/auth'
import { storeChallenge } from '@/lib/security/webauthn'

// POST /api/security/biometric/register/begin
// Issues a single-use, server-generated WebAuthn challenge for registration.
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const challenge = storeChallenge(`reg:${userId}`)
    return successResponse({ challenge })
  } catch (error) {
    console.error('Biometric register/begin error:', error)
    return errorResponse('Failed to start biometric registration', 500)
  }
}
