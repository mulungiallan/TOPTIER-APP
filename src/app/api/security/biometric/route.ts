import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import {
  consumeChallenge,
  verifyRegistration,
  getRpId,
} from '@/lib/security/webauthn'
import { env } from '@/lib/env'

// GET /api/security/biometric — list user's biometric credentials
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const creds = await db.biometricCredential.findMany({
      where: { userId },
      select: {
        id: true,
        credentialId: true,
        nickname: true,
        deviceType: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    return successResponse({ credentials: creds })
  } catch (error) {
    console.error('Biometric GET error:', error)
    return errorResponse('Failed to fetch credentials', 500)
  }
}

// POST /api/security/biometric — register a new biometric credential
// (completes a flow started by POST /api/security/biometric/register/begin)
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { credentialId, publicKey, clientDataJSON, authenticatorData, deviceType, transports, nickname } = body

    if (!credentialId || !publicKey) {
      return errorResponse('credentialId and publicKey are required', 400)
    }

    // When the browser sends back clientDataJSON + authenticatorData, verify the
    // registration against the server-issued challenge. Legacy registrations
    // (without these fields) are still accepted but flagged with counter 0.
    let counter = 0
    if (clientDataJSON && authenticatorData) {
      const expectedChallenge = consumeChallenge(`reg:${userId}`)
      if (!expectedChallenge) {
        return errorResponse('Registration session expired. Please try again.', 400)
      }

      const origin = request.headers.get('origin') || request.nextUrl.origin || env.appUrl
      const { counter: authCounter } = await verifyRegistration({
        clientDataJSONB64: String(clientDataJSON),
        authenticatorDataB64: String(authenticatorData),
        expectedChallenge,
        expectedOrigin: origin,
        rpId: getRpId(origin),
      })
      counter = authCounter
    }

    const cred = await db.biometricCredential.upsert({
      where: { credentialId },
      create: {
        userId,
        credentialId,
        publicKey,
        deviceType: deviceType || 'platform',
        transports: transports || null,
        nickname: nickname || `Authenticator ${new Date().toLocaleDateString()}`,
        counter,
        lastUsedAt: new Date(),
      },
      update: {
        userId,
        publicKey,
        deviceType: deviceType || 'platform',
        transports: transports || null,
        nickname: nickname || undefined,
        counter,
        lastUsedAt: new Date(),
      },
    })
    return successResponse({ credential: cred }, 201)
  } catch (error) {
    console.error('Biometric POST error:', error)
    const message = error instanceof Error ? error.message : 'Failed to register biometric credential'
    return errorResponse(message, 400)
  }
}

// DELETE /api/security/biometric?id=... — remove a credential
export async function DELETE(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return errorResponse('id is required', 400)

    await db.biometricCredential.deleteMany({ where: { id, userId } })
    return successResponse({ deleted: true })
  } catch (error) {
    console.error('Biometric DELETE error:', error)
    return errorResponse('Failed to delete credential', 500)
  }
}
