// Shared admin authorization guard.
// Enforces BOTH role (admin/super_admin) AND an optional email allow-list.
// Set ADMIN_EMAILS="you@example.com,other@example.com" to restrict the panel
// to only those accounts. If unset, any admin-role account is allowed.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest } from '@/lib/auth'

export type AdminUser = {
  id: string
  email: string
  name: string | null
  role: string
}

export async function requireAdmin(request: NextRequest): Promise<{ error: Response | null; user: AdminUser | null }> {
  const userId = getUserIdFromRequest(request)
  if (!userId) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }), user: null }
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  })
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return { error: Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 }), user: null }
  }

  const allowList = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  if (allowList.length > 0 && !allowList.includes(user.email.toLowerCase())) {
    return { error: Response.json({ error: 'Forbidden: This account is not authorized for the admin panel' }, { status: 403 }), user: null }
  }

  return { error: null, user }
}
