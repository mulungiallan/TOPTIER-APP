import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, generateToken, generateReferralCode, successResponse, errorResponse, needsRehash, rehashPassword, getRequestIp, getRequestDevice } from '@/lib/auth'
import { authRouteSchema, validateBody } from '@/lib/validation'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = validateBody(authRouteSchema, body)
    if (!parsed.success) {
      return errorResponse(parsed.error, 400)
    }

    if (parsed.data.action === 'register') {
      const { email, password, name, dateOfBirth, country, referralCode: referralInput } = parsed.data
      const inputReferralCode = typeof referralInput === 'string' ? referralInput.trim() : ''
      const trimmedEmail = email

      // Check if user already exists
      const existingUser = await db.user.findUnique({ where: { email: trimmedEmail } })
      if (existingUser) {
        return errorResponse('Email already registered', 409)
      }

      // Generate unique referral code
      let referralCode = generateReferralCode()
      let codeExists = await db.user.findUnique({ where: { referralCode } })
      while (codeExists) {
        referralCode = generateReferralCode()
        codeExists = await db.user.findUnique({ where: { referralCode } })
      }

      const hashedPassword = rehashPassword(password)
      const user = await db.user.create({
        data: {
          email: trimmedEmail,
          password: hashedPassword,
          name: name || null,
          dateOfBirth: dateOfBirth || null,
          country: country || null,
          referralCode,
        },
      })

      // Create default watchlist
      await db.watchlist.create({
        data: {
          userId: user.id,
          name: 'My Watchlist',
          isDefault: true,
        },
      })

      // Create default signal filter
      await db.signalFilter.create({
        data: {
          userId: user.id,
          minConfidence: 50,
        },
      })

      // Link the referrer if a valid referral code was supplied.
      // Rewards are recorded as "pending" and granted when the referred
      // user completes a premium purchase (see payment fulfillment).
      if (inputReferralCode && inputReferralCode !== user.referralCode) {
        const referrer = await db.user.findUnique({ where: { referralCode: inputReferralCode } })
        if (referrer && referrer.id !== user.id) {
          await db.$transaction([
            db.user.update({
              where: { id: referrer.id },
              data: { referralCount: { increment: 1 } },
            }),
            db.user.update({
              where: { id: user.id },
              data: { referredBy: referrer.id },
            }),
            db.referralReward.create({
              data: {
                userId: referrer.id,
                referredUserId: user.id,
                rewardType: 'premium_days',
                rewardAmount: 7,
                status: 'pending',
                reason: 'Referred a new user who registered with your code',
              },
            }),
          ])
        }
      }

      const token = generateToken(user.id, { tokenVersion: user.tokenVersion })

      // Log registration activity
      await db.activityLog.create({
        data: {
          userId: user.id,
          action: 'register',
          details: 'New account created',
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
        },
        token,
      }, 201)
    }

    if (parsed.data.action === 'login') {
      const { email, password } = parsed.data
      const trimmedEmail = email

      if (!trimmedEmail || !password) {
        return errorResponse('Email and password are required', 400)
      }

      const user = await db.user.findUnique({ where: { email: trimmedEmail } })
      if (!user) {
        return errorResponse('Invalid email or password', 401)
      }

      if (user.isBanned) {
        // Auto-expire time-limited suspensions: the banReason field stores
        // "SUSPENDED until <ISO date> | Reason: ..." for suspensions.
        if (user.banReason?.startsWith('SUSPENDED until ')) {
          const untilStr = user.banReason.split('SUSPENDED until ')[1]?.split(' | ')[0]
          if (untilStr) {
            const suspendedUntil = new Date(untilStr)
            if (!isNaN(suspendedUntil.getTime()) && suspendedUntil < new Date()) {
              // Suspension has expired — auto-unban
              await db.user.update({
                where: { id: user.id },
                data: { isBanned: false, banReason: null },
              })
              // Continue to login — user is no longer banned
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

      if (!(await verifyPassword(password, user.password))) {
        return errorResponse('Invalid email or password', 401)
      }

      // Upgrade legacy SHA-256 hashes to scrypt on successful login
      if (needsRehash(user.password)) {
        await db.user.update({
          where: { id: user.id },
          data: { password: rehashPassword(password) },
        })
      }

      const token = generateToken(user.id, { tokenVersion: user.tokenVersion })

      // Log activity
      await db.activityLog.create({
        data: {
          userId: user.id,
          action: 'login',
          details: 'User logged in',
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
        token,
      })
    }

    return errorResponse('Invalid action. Use "register" or "login"', 400)
  } catch (error) {
    console.error('Auth error:', error)
    return errorResponse('Authentication failed', 500)
  }
}
