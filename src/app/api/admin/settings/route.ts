import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'

// Admin feature flags (id → metadata + default state).
const DEFAULT_FEATURE_FLAGS = [
  { id: 'ff1', name: 'AI Signal Generation', description: 'Use AI to auto-generate signals', enabled: true },
  { id: 'ff2', name: 'Community Forum', description: 'Enable community discussion forums', enabled: true },
  { id: 'ff3', name: 'Screenshot Analysis v2', description: 'Enhanced screenshot analysis engine', enabled: false },
  { id: 'ff4', name: 'Social Sharing', description: 'Allow signal sharing to social media', enabled: true },
  { id: 'ff5', name: 'Dark Mode', description: 'Dark mode theme option', enabled: true },
  { id: 'ff6', name: 'Referral Program', description: 'User referral reward system', enabled: true },
  { id: 'ff7', name: 'Push Notifications', description: 'Browser push notifications', enabled: true },
  { id: 'ff8', name: 'Maintenance Mode', description: 'Show maintenance page to users', enabled: false },
]

const DEFAULT_APP_SETTINGS = {
  trialLength: '7',
  premiumPrice: '29.99',
  proPrice: '59.99',
  maintenanceMode: false,
}

const flagKey = (id: string) => `feature_flag.${id}`
const settingKey = (name: string) => `app.${name}`

async function getAppSettingsMap(): Promise<Record<string, string>> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: [...DEFAULT_FEATURE_FLAGS.map((f) => flagKey(f.id)), ...Object.keys(DEFAULT_APP_SETTINGS).map(settingKey)] } },
  })
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export async function GET(request: NextRequest) {
  try {
    const { error, user } = await requireAdmin(request)
    if (error) return error
    if (!user) return errorResponse('Admin access required', 403)

    const map = await getAppSettingsMap()

    const featureFlags = DEFAULT_FEATURE_FLAGS.map((f) => ({
      ...f,
      enabled: map[flagKey(f.id)] !== undefined ? map[flagKey(f.id)] === 'true' : f.enabled,
    }))

    const appSettings: Record<string, string | boolean> = {}
    for (const [key, def] of Object.entries(DEFAULT_APP_SETTINGS)) {
      const stored = map[settingKey(key)]
      appSettings[key] = stored !== undefined ? (key === 'maintenanceMode' ? stored === 'true' : stored) : def
    }

    return successResponse({ featureFlags, appSettings })
  } catch (error) {
    console.error('Admin settings GET error:', error)
    return errorResponse('Failed to fetch admin settings', 500)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { error, user } = await requireAdmin(request)
    if (error) return error
    if (!user) return errorResponse('Admin access required', 403)

    const body = await request.json().catch(() => null)
    if (!body) return errorResponse('Invalid request body', 400)

    const upserts: { key: string; value: string }[] = []

    if (Array.isArray(body.featureFlags)) {
      for (const flag of body.featureFlags) {
        if (!flag?.id || typeof flag.enabled !== 'boolean') continue
        upserts.push({ key: flagKey(flag.id), value: String(flag.enabled) })
      }
    }

    if (body.appSettings && typeof body.appSettings === 'object') {
      const allow = new Set(Object.keys(DEFAULT_APP_SETTINGS))
      for (const [key, value] of Object.entries(body.appSettings as Record<string, unknown>)) {
        if (!allow.has(key) || value === undefined || value === null) continue
        upserts.push({ key: settingKey(key), value: String(value) })
      }
    }

    if (upserts.length === 0) {
      return successResponse({ updated: 0, message: 'Nothing to update' })
    }

    await db.$transaction(
      upserts.map((u) =>
        db.appSetting.upsert({
          where: { key: u.key },
          update: { value: u.value },
          create: { key: u.key, value: u.value },
        })
      )
    )

    await db.adminAuditLog.create({
      data: {
        adminId: user.id,
        action: 'UPDATE_SETTINGS',
        details: JSON.stringify(upserts),
      },
    })

    return successResponse({ updated: upserts.length })
  } catch (error) {
    console.error('Admin settings PUT error:', error)
    return errorResponse('Failed to save admin settings', 500)
  }
}
