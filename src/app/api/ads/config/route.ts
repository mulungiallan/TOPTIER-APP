import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'

async function getConfig() {
  const existing = await db.adConfig.findUnique({ where: { id: 'default' } })
  if (existing) return existing
  // Seed a default row with the rewarded AdFlow gate enabled so free users are
  // gated behind the 10 ad steps immediately. The owner can edit or disable
  // it in Monetization → Ads.
  return db.adConfig.create({
    data: {
      id: 'default',
      enabled: true,
      provider: 'google',
      bannerEnabled: true,
      interstitialEnabled: true,
      stepFrequency: 5,
      freeUsersOnly: true,
      rewardedEnabled: true,
      rewardedTitle: 'Sponsored',
      rewardedDescription: 'Thanks for watching — your analysis is unlocking!',
      rewardedCta: 'Continue',
      rewardedLink: '/',
      rewardedEmoji: '📈',
      rewardedGradient: 'from-indigo-500 via-purple-500 to-pink-500',
      rewardedDuration: 4,
    },
  })
}

export async function GET(request: NextRequest) {
  try {
    const config = await getConfig()
    return successResponse(config)
  } catch (err) {
    console.error('Ads config GET error:', err)
    return errorResponse('Failed to load ad configuration', 500)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { error } = await requireAdmin(request)
    if (error) return error

    const body = await request.json()
    const allowed = [
      'enabled',
      'provider',
      'adSenseClientId',
      'adSenseSlotId',
      'customBannerImage',
      'customBannerLink',
      'customBannerAlt',
      'bannerEnabled',
      'interstitialEnabled',
      'stepFrequency',
      'freeUsersOnly',
      'rewardedEnabled',
      'rewardedTitle',
      'rewardedDescription',
      'rewardedCta',
      'rewardedLink',
      'rewardedEmoji',
      'rewardedGradient',
      'rewardedDuration',
    ]

    const data: Record<string, unknown> = {}
    for (const key of allowed) {
      if (body[key] !== undefined) data[key] = body[key]
    }

    if (data.stepFrequency !== undefined) {
      const n = Number(data.stepFrequency)
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        return errorResponse('stepFrequency must be between 1 and 100', 400)
      }
      data.stepFrequency = Math.round(n)
    }

    if (data.rewardedDuration !== undefined) {
      const n = Number(data.rewardedDuration)
      if (!Number.isFinite(n) || n < 1 || n > 60) {
        return errorResponse('rewardedDuration must be between 1 and 60 seconds', 400)
      }
      data.rewardedDuration = Math.round(n)
    }

    const config = await db.adConfig.upsert({
      where: { id: 'default' },
      update: data,
      create: { id: 'default', ...data },
    })

    return successResponse(config)
  } catch (err) {
    console.error('Ads config PUT error:', err)
    return errorResponse('Failed to update ad configuration', 500)
  }
}
