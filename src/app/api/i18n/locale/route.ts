import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse } from '@/lib/auth'
import { locales, localeList, defaultLocale, detectUserLocale } from '@/lib/i18n/config'

// GET /api/i18n/locale — list all supported locales + the caller's saved locale
export async function GET(request: NextRequest) {
  const userId = getUserIdFromRequest(request)
  let saved: string | null = null
  if (userId) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { language: true } })
    saved = user?.language || null
  }
  return successResponse({
    locales: localeList,
    defaultLocale,
    detected: detectUserLocale(),
    saved,
  })
}

// POST /api/i18n/locale — persist the authenticated user's preferred locale
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return successResponse({ error: 'Unauthorized' }, 401)

    const body = await request.json()
    const { locale } = body
    if (!locale || !locales[locale]) {
      return successResponse({ error: 'Invalid locale', valid: Object.keys(locales) }, 400)
    }

    await db.user.update({ where: { id: userId }, data: { language: locale } })

    return successResponse({ locale, set: true })
  } catch {
    return successResponse({ error: 'Invalid request' }, 400)
  }
}
