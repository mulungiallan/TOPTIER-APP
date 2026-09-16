import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { generateToken, generateReferralCode, successResponse, errorResponse, getRequestIp, getRequestDevice } from '@/lib/auth'
import { socialAuthSchema, validateBody } from '@/lib/validation'
import { verifySocialToken } from '@/lib/auth/social'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = validateBody(socialAuthSchema, body)
    if (!parsed.success) {
      return errorResponse(parsed.error, 400)
    }

    const { provider, token, name } = parsed.data

    const socialUser = await verifySocialToken(provider, token)

    if (!socialUser.emailVerified && provider === 'google') {
      return errorResponse('Google account email is not verified', 403)
    }

    let user = null
    let isNewUser = false

    if (provider === 'google') {
      user = await db.user.findUnique({ where: { googleId: socialUser.providerId } })
    } else {
      user = await db.user.findUnique({ where: { appleId: socialUser.providerId } })
    }

    if (!user) {
      user = await db.user.findUnique({ where: { email: socialUser.email } })
      if (user) {
        const updateData: Record<string, string | null> = {}
        if (provider === 'google' && !user.googleId) {
          updateData.googleId = socialUser.providerId
        } else if (provider === 'apple' && !user.appleId) {
          updateData.appleId = socialUser.providerId
        }
        if (socialUser.name && !user.name) {
          updateData.name = socialUser.name
        }
        if (socialUser.picture && !user.profilePicture) {
          updateData.profilePicture = socialUser.picture
        }
        if (Object.keys(updateData).length > 0) {
          user = await db.user.update({ where: { id: user.id }, data: updateData })
        }
      }
    }

    if (!user) {
      isNewUser = true
      let referralCode = generateReferralCode()
      let codeExists = await db.user.findUnique({ where: { referralCode } })
      while (codeExists) {
        referralCode = generateReferralCode()
        codeExists = await db.user.findUnique({ where: { referralCode } })
      }

      const createData = {
        email: socialUser.email,
        password: '',
        name: name || socialUser.name || null,
        referralCode,
        profilePicture: socialUser.picture || null,
        isEmailVerified: socialUser.emailVerified,
        ...(provider === 'google' ? { googleId: socialUser.providerId } : { appleId: socialUser.providerId }),
      } as const

      user = await db.user.create({ data: createData })

      await db.watchlist.create({
        data: { userId: user.id, name: 'My Watchlist', isDefault: true },
      })
      await db.signalFilter.create({
        data: { userId: user.id, minConfidence: 50 },
      })
    }

    if (user.isBanned) {
      if (user.banReason?.startsWith('SUSPENDED until ')) {
        const untilStr = user.banReason.split('SUSPENDED until ')[1]?.split(' | ')[0]
        if (untilStr) {
          const suspendedUntil = new Date(untilStr)
          if (!isNaN(suspendedUntil.getTime()) && suspendedUntil < new Date()) {
            user = await db.user.update({
              where: { id: user.id },
              data: { isBanned: false, banReason: null },
            })
          } else {
            return errorResponse('Account has been suspended', 403)
          }
        } else {
          return errorResponse('Account has been suspended', 403)
        }
      } else {
        return errorResponse('Account has been banned', 403)
      }
    }

    const tokenResult = generateToken(user.id, { tokenVersion: user.tokenVersion })

    await db.activityLog.create({
      data: {
        userId: user.id,
        action: isNewUser ? 'register' : 'login',
        details: isNewUser
          ? `New account created via ${provider} social login`
          : `User logged in via ${provider} social login`,
        ipAddress: getRequestIp(request),
        deviceInfo: getRequestDevice(request),
      },
    })

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
      token: tokenResult,
    })
  } catch (error) {
    console.error('Social auth error:', error)
    const message = error instanceof Error ? error.message : 'Social authentication failed'
    if (message.includes('not configured')) {
      return errorResponse(message, 501)
    }
    if (message.includes('missing required field') || message.includes('did not return an email') || message.includes('Invalid token')) {
      return errorResponse(message, 400)
    }
    return errorResponse('Social authentication failed', 500)
  }
}
