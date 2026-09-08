// src/lib/admin-permissions.ts
// RBAC for the admin panel. A role carries a set of permissions, and every
// admin action / tab is gated on one (or more) of them. The client mirrors
// this map for UI visibility; the server re-validates in requirePermission.

export type AdminRole =
  | 'owner'
  | 'super_admin'
  | 'admin'
  | 'moderator'
  | 'support'
  | 'analyst'
  | 'read_only'
  | 'user'

export type AdminPermission =
  | 'panel.access' // view the panel at all
  | 'users.read' // view user lists / profiles
  | 'users.write' // suspend / warn / ban / unban
  | 'users.admin' // role changes, force logout, premium grants
  | 'users.gdpr' // GDPR export / deletion workflows
  | 'signals.read'
  | 'signals.write' // generate / override / expire signals
  | 'signals.run' // trigger the generator / jobs
  | 'payments.read'
  | 'payments.write' // payouts, refunds, revenue logging
  | 'payments.payout' // approve/reject/mark-paid actually move money
  | 'content.write' // news, calendar, coupons, reviews, tickets
  | 'tickets.manage' // assign, escalate, reply to tickets
  | 'system.settings' // feature flags + app settings
  | 'system.jobs' // run background jobs
  | 'system.audit' // audit log + exports
  | 'impersonate'
  | 'ai.ask' // ask-the-panel + AI drafts
  | 'analytics.read' // BI dashboards + exports

const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  owner: [
    'panel.access', 'users.read', 'users.write', 'users.admin', 'users.gdpr',
    'signals.read', 'signals.write', 'signals.run',
    'payments.read', 'payments.write', 'payments.payout',
    'content.write', 'tickets.manage',
    'system.settings', 'system.jobs', 'system.audit', 'impersonate', 'ai.ask', 'analytics.read',
  ],
  super_admin: [
    'panel.access', 'users.read', 'users.write', 'users.admin', 'users.gdpr',
    'signals.read', 'signals.write', 'signals.run',
    'payments.read', 'payments.write', 'payments.payout',
    'content.write', 'tickets.manage',
    'system.settings', 'system.jobs', 'system.audit', 'impersonate', 'ai.ask', 'analytics.read',
  ],
  admin: [
    'panel.access', 'users.read', 'users.write',
    'signals.read', 'signals.write', 'signals.run',
    'payments.read', 'payments.write',
    'content.write', 'tickets.manage',
    'system.settings', 'system.jobs', 'system.audit',
    'impersonate', 'ai.ask', 'analytics.read',
  ],
  moderator: [
    'panel.access', 'users.read', 'users.write',
    'tickets.manage', 'content.write', 'analytics.read',
  ],
  support: [
    'panel.access', 'users.read', 'tickets.manage', 'analytics.read',
  ],
  analyst: [
    'panel.access', 'signals.read', 'analytics.read', 'ai.ask',
  ],
  read_only: ['panel.access', 'users.read', 'signals.read', 'payments.read', 'analytics.read'],
  user: [],
}

export const ADMIN_ROLES: AdminRole[] = [
  'owner',
  'super_admin',
  'admin',
  'moderator',
  'support',
  'analyst',
  'read_only',
]

export function isAdminRole(role: string): boolean {
  return role === 'admin' || role === 'super_admin' || role === 'owner'
}

export function rolePermissions(role: string): readonly AdminPermission[] {
  return ROLE_PERMISSIONS[(role as AdminRole) || 'user'] ?? ROLE_PERMISSIONS.user
}

export function adminCan(role: string, perm: AdminPermission): boolean {
  return rolePermissions(role).includes(perm)
}

// Server-side gate. Returns a Response to return (or null when allowed).
import { NextRequest } from 'next/server'
import { requireAdmin, type AdminUser } from '@/lib/admin-guard'
import { errorResponse } from '@/lib/auth'

export async function requirePermission(
  request: NextRequest,
  perm: AdminPermission
): Promise<{ error: Response | null; user: AdminUser | null }> {
  const { error, user } = await requireAdmin(request)
  if (error) return { error, user }
  if (!user) return { error: errorResponse('Forbidden: Admin access required', 403), user: null }
  if (!adminCan(user.role, perm)) {
    return { error: errorResponse(`Forbidden: role "${user.role}" lacks permission "${perm}"`, 403), user }
  }
  return { error: null, user }
}