// src/app/api/admin/security/route.ts
// Admin 2FA + RBAC introspection for the panel gate.
//
//  GET  /api/admin/security
//    → { required, enabled (this admin has 2FA set up), secretPreview,
//        setupPayload (when !enabled: { secret, otpauth } to render QR),
//        adminRoles, myRole, permissions[] }
//
//  POST /api/admin/security/verify   { code }        → verify TOTP against this admin
//  POST /api/admin/security/setup    {}              → rotate to a fresh TOTP secret
//  PUT  /api/admin/security/enforce  { required }    → toggle global admin 2FA (super_admin only)

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requirePermission, ADMIN_ROLES, adminCan, type AdminPermission } from '@/lib/admin-permissions'
import { generateBase32Secret, verifyTotp, otpauthUrl } from '@/lib/totp'

export const runtime = 'nodejs'

const ALL_PERMISSIONS: AdminPermission[] = [
  'panel.access', 'users.read', 'users.write', 'users.admin', 'users.gdpr',
  'signals.read', 'signals.write', 'signals.run',
  'payments.read', 'payments.write', 'payments.payout',
  'content.write', 'tickets.manage',
  'system.settings', 'system.jobs', 'system.audit', 'impersonate', 'ai.ask', 'analytics.read',
]

function maskSecret(secret: string): string {
  return secret.length > 6 ? `${secret.slice(0, 3)}•••${secret.slice(-3)}` : secret
}

export async function GET(request: NextRequest) {
  const { error, user } = await requirePermission(request, 'panel.access')
  if (error) return error
  const me = await db.user.findUnique({ where: { id: user!.id } })

  const enforceRow = await db.appSetting.findUnique({ where: { key: 'app.adminRequire2fa' } })
  const required = enforceRow ? enforceRow.value === 'true' : false

  const enabled = me?.twoFactorSecret ? true : false
  let setupPayload: { secret: string; otpauth: string } | null = null
  if (!enabled) {
    const secret = generateBase32Secret()
    setupPayload = {
      secret,
      otpauth: otpauthUrl(secret, me?.email || user!.email),
    }
  }

  const permissions: string[] = []
  for (const p of ALL_PERMISSIONS) if (adminCan(user!.role, p)) permissions.push(p)

  return successResponse({
    required,
    enabled,
    secretPreview: enabled && me ? maskSecret(me.twoFactorSecret!) : null,
    setupPayload,
    adminRoles: ADMIN_ROLES,
    myRole: user!.role,
    permissions,
  })
}

export async function POST(request: NextRequest) {
  try {
    const { error, user } = await requirePermission(request, 'panel.access')
    if (error) return error
    const body = await request.json().catch(() => null)
    const action = body?.action || 'verify'

    const me = await db.user.findUnique({ where: { id: user!.id } })

    if (action === 'verify') {
      const code = String(body?.code || '').trim()
      if (!me?.twoFactorSecret) return errorResponse('2FA is not set up for this account', 400)
      if (verifyTotp(me.twoFactorSecret, code)) {
        return successResponse({ ok: true, verified: true })
      }
      return errorResponse('Invalid or expired code', 401)
    }

    if (action === 'setup') {
      const secret = generateBase32Secret()
      await db.user.update({
        where: { id: user!.id },
        data: { twoFactorSecret: secret, twoFactorEnabled: true },
      })
      await db.adminAuditLog.create({
        data: { adminId: user!.id, action: 'SETUP_2FA', details: JSON.stringify({ email: user!.email }) },
      })
      return successResponse({
        enabled: true,
        secret,
        otpauth: otpauthUrl(secret, me?.email || user!.email),
      })
    }

    return errorResponse('Unknown action', 400)
  } catch (e) {
    console.error('Admin security POST error:', e)
    return errorResponse('Security action failed', 500)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { error, user } = await requirePermission(request, 'system.settings')
    if (error) return error
    const body = await request.json().catch(() => null)
    const required = Boolean(body?.required)

    await db.appSetting.upsert({
      where: { key: 'app.adminRequire2fa' },
      update: { value: String(required) },
      create: { key: 'app.adminRequire2fa', value: String(required) },
    })

    await db.adminAuditLog.create({
      data: {
        adminId: user!.id,
        action: 'UPDATE_SETTINGS',
        details: JSON.stringify({ app_adminRequire2fa: required }),
      },
    })

    return successResponse({ required })
  } catch (e) {
    console.error('Admin security PUT error:', e)
    return errorResponse('Failed to update 2FA enforcement', 500)
  }
}