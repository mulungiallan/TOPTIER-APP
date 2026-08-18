import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        profilePicture: true,
        dateOfBirth: true,
        country: true,
        role: true,
        subscriptionTier: true,
        trialStartDate: true,
        trialEndDate: true,
        subscriptionStartDate: true,
        subscriptionEndDate: true,
        isEmailVerified: true,
        twoFactorEnabled: true,
        onboardingCompleted: true,
        onboardingStep: true,
        referralCode: true,
        referredBy: true,
        referralCount: true,
        earnedPremiumDays: true,
        tradingStyle: true,
        riskLevel: true,
        preferredMarkets: true,
        preferredSessions: true,
        notificationPrefs: true,
        language: true,
        darkMode: true,
        analyticsOptOut: true,
        createdAt: true,
      },
    })

    if (!user) {
      return errorResponse('User not found', 404)
    }

    // Get user's signal filter
    const signalFilter = await db.signalFilter.findFirst({
      where: { userId },
    })

    // Get user badges
    const badges = await db.userBadge.findMany({
      where: { userId },
    })

    // Get referral rewards
    const referralRewards = await db.referralReward.findMany({
      where: { userId },
    })

    // Get recent account activity
    const activityLogs = await db.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        action: true,
        details: true,
        ipAddress: true,
        deviceInfo: true,
        createdAt: true,
      },
    })

    return successResponse({
      ...user,
      signalFilter,
      badges,
      referralRewards,
      activityLogs,
    })
  } catch (error) {
    console.error('Settings GET error:', error)
    return errorResponse('Failed to fetch user settings', 500)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { section } = body // profile, preferences, notifications, security, onboarding

    if (section === 'profile') {
      const { name, phone, dateOfBirth, country, profilePicture } = body

      const updatedUser = await db.user.update({
        where: { id: userId },
        data: {
          ...(name !== undefined && { name }),
          ...(phone !== undefined && { phone }),
          ...(dateOfBirth !== undefined && { dateOfBirth }),
          ...(country !== undefined && { country }),
          ...(profilePicture !== undefined && { profilePicture }),
        },
      })

      // Log activity
      await db.activityLog.create({
        data: {
          userId,
          action: 'update_profile',
          details: 'Updated profile information',
        },
      })

      return successResponse({
        id: updatedUser.id,
        name: updatedUser.name,
        phone: updatedUser.phone,
        dateOfBirth: updatedUser.dateOfBirth,
        country: updatedUser.country,
        profilePicture: updatedUser.profilePicture,
      })
    }

    if (section === 'preferences') {
      const { tradingStyle, riskLevel, preferredMarkets, preferredSessions, language, darkMode, analyticsOptOut } = body

      const updatedUser = await db.user.update({
        where: { id: userId },
        data: {
          ...(tradingStyle !== undefined && { tradingStyle }),
          ...(riskLevel !== undefined && { riskLevel }),
          ...(preferredMarkets !== undefined && { preferredMarkets }),
          ...(preferredSessions !== undefined && { preferredSessions }),
          ...(language !== undefined && { language }),
          ...(darkMode !== undefined && { darkMode }),
          ...(analyticsOptOut !== undefined && { analyticsOptOut }),
        },
      })

      return successResponse({
        tradingStyle: updatedUser.tradingStyle,
        riskLevel: updatedUser.riskLevel,
        preferredMarkets: updatedUser.preferredMarkets,
        preferredSessions: updatedUser.preferredSessions,
        language: updatedUser.language,
        darkMode: updatedUser.darkMode,
        analyticsOptOut: updatedUser.analyticsOptOut,
      })
    }

    if (section === 'notifications') {
      const { notificationPrefs } = body

      if (!notificationPrefs) {
        return errorResponse('notificationPrefs is required', 400)
      }

      const updatedUser = await db.user.update({
        where: { id: userId },
        data: {
          notificationPrefs: typeof notificationPrefs === 'string' ? notificationPrefs : JSON.stringify(notificationPrefs),
        },
      })

      return successResponse({ notificationPrefs: updatedUser.notificationPrefs })
    }

    if (section === 'security') {
      const { twoFactorEnabled } = body

      const updatedUser = await db.user.update({
        where: { id: userId },
        data: {
          ...(twoFactorEnabled !== undefined && { twoFactorEnabled }),
        },
      })

      // Log activity
      await db.activityLog.create({
        data: {
          userId,
          action: 'update_security',
          details: `Two-factor authentication ${twoFactorEnabled ? 'enabled' : 'disabled'}`,
        },
      })

      return successResponse({ twoFactorEnabled: updatedUser.twoFactorEnabled })
    }

    if (section === 'onboarding') {
      const { onboardingStep, onboardingCompleted } = body

      const updatedUser = await db.user.update({
        where: { id: userId },
        data: {
          ...(onboardingStep !== undefined && { onboardingStep }),
          ...(onboardingCompleted !== undefined && { onboardingCompleted }),
        },
      })

      return successResponse({
        onboardingStep: updatedUser.onboardingStep,
        onboardingCompleted: updatedUser.onboardingCompleted,
      })
    }

    if (section === 'signal_filter') {
      const { marketTypes, assets, strategies, sessions, minConfidence, maxSignalsHour, maxSignalsDay, mutedAssets } = body

      const existingFilter = await db.signalFilter.findFirst({ where: { userId } })

      let filter
      if (existingFilter) {
        filter = await db.signalFilter.update({
          where: { id: existingFilter.id },
          data: {
            ...(marketTypes !== undefined && { marketTypes }),
            ...(assets !== undefined && { assets }),
            ...(strategies !== undefined && { strategies }),
            ...(sessions !== undefined && { sessions }),
            ...(minConfidence !== undefined && { minConfidence }),
            ...(maxSignalsHour !== undefined && { maxSignalsHour }),
            ...(maxSignalsDay !== undefined && { maxSignalsDay }),
            ...(mutedAssets !== undefined && { mutedAssets }),
          },
        })
      } else {
        filter = await db.signalFilter.create({
          data: {
            userId,
            marketTypes: marketTypes || null,
            assets: assets || null,
            strategies: strategies || null,
            sessions: sessions || null,
            minConfidence: minConfidence || 50,
            maxSignalsHour: maxSignalsHour || null,
            maxSignalsDay: maxSignalsDay || null,
            mutedAssets: mutedAssets || null,
          },
        })
      }

      return successResponse(filter)
    }

    return errorResponse('Invalid section. Use: profile, preferences, notifications, security, onboarding, signal_filter', 400)
  } catch (error) {
    console.error('Settings PUT error:', error)
    return errorResponse('Failed to update settings', 500)
  }
}
