import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { generateToken, successResponse, errorResponse } from '@/lib/auth'
import {
  consumeChallenge,
  verifyAssertion,
  getRpId,
} from '@/lib/security/webauthn'
import { env } from '@/lib/env'

// POST /api/security/biometric/authenticate
// No auth required — verifies a WebAuthn assertion and returns a normal app
// session (same shape as POST /api/auth with action: 'login').
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { credentialId, clientDataJSON, authenticatorData, signature } = body || {}

    if (!credentialId || !clientDataJSON || !authenticatorData || !signature) {
      return errorResponse(
        'credentialId, clientDataJSON, authenticatorData and signature are required',
        400
      )
    }

    const cred = await db.biometricCredential.findUnique({
      where: { credentialId },
      include: { user: true },
    })

    if (!cred || !cred.user) {
      return errorResponse('Credential not found', 404)
    }
    if (cred.user.isBanned) {
      return errorResponse('Account has been suspended', 403)
    }

    const expectedChallenge = consumeChallenge(`auth:${credentialId}`)
    if (!expectedChallenge) {
      return errorResponse('Authentication session expired. Please try again.', 400)
    }

    const origin = request.headers.get('origin') || request.nextUrl.origin || env.appUrl
    const { counter } = await verifyAssertion({
      clientDataJSONB64: String(clientDataJSON),
      authenticatorDataB64: String(authenticatorData),
      signatureB64: String(signature),
      storedPublicKeyB64: cred.publicKey,
      expectedChallenge,
      expectedOrigin: origin,
      rpId: getRpId(origin),
      expectedCounter: cred.counter,
    })

    await db.biometricCredential.update({
      where: { id: cred.id },
      data: { lastUsedAt: new Date(), counter },
    })

    await db.activityLog.create({
      data: {
        userId: cred.user.id,
        action: 'login',
        details: 'Signed in with biometric (WebAuthn)',
      },
    })

    const user = cred.user
    const token = generateToken(user.id)

    return successResponse({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        subscriptionTier: user.subscriptionTier,
        referralCode: user.referralCode,
        referralCount: user.referralCount,
        earnedPremiumDays: user.earnedPremiumDays,
        onboardingCompleted: user.onboardingCompleted,
        onboardingStep: user.onboardingStep,
        darkMode: user.darkMode,
        tradingStyle: user.tradingStyle,
        riskLevel: user.riskLevel,
        preferredMarkets: user.preferredMarkets,
        preferredSessions: user.preferredSessions,
        phone: user.phone,
        profilePicture: user.profilePicture,
        dateOfBirth: user.dateOfBirth,
        country: user.country,
        language: user.language,
        isEmailVerified: user.isEmailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
      },
      token,
    })
  } catch (error) {
    console.error('Biometric authenticate error:', error)
    const message = error instanceof Error ? error.message : 'Biometric sign-in failed'
    return errorResponse(message, 400)
  }
}
