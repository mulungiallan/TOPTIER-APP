import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { errorResponse, successResponse } from '@/lib/auth'
import { storeChallenge } from '@/lib/security/webauthn'

// POST /api/security/biometric/authenticate/begin
// No auth required — starts a passwordless biometric sign-in for a credential
// this device previously registered. Issues a server challenge.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const credentialId = typeof body?.credentialId === 'string' ? body.credentialId : ''

    if (!credentialId) {
      return errorResponse('credentialId is required', 400)
    }

    const cred = await db.biometricCredential.findUnique({
      where: { credentialId },
      select: {
        credentialId: true,
        user: {
          select: { id: true, name: true, email: true, isBanned: true },
        },
      },
    })

    if (!cred || !cred.user) {
      return errorResponse('Credential not found', 404)
    }
    if (cred.user.isBanned) {
      return errorResponse('Account has been suspended', 403)
    }

    const challenge = storeChallenge(`auth:${credentialId}`)

    return successResponse({
      challenge,
      credentialId: cred.credentialId,
      user: {
        id: cred.user.id,
        name: cred.user.name,
        email: cred.user.email,
      },
    })
  } catch (error) {
    console.error('Biometric authenticate/begin error:', error)
    return errorResponse('Failed to start biometric sign-in', 500)
  }
}
