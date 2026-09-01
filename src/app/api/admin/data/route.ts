import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'

// GET /api/admin/data — combined list data for the admin panel
// (users, signals, coupons, support tickets, audit log).
export async function GET(request: NextRequest) {
  try {
    const { error, user } = await requireAdmin(request)
    if (error) return error
    if (!user) return errorResponse('Admin access required', 403)

    const { searchParams } = new URL(request.url)
    const search = (searchParams.get('search') || '').toLowerCase()
    const tier = searchParams.get('tier') || 'all'
    const status = searchParams.get('status') || 'all'
    const signalStatus = searchParams.get('signalStatus') || 'all'

    const [users, signals, coupons, tickets, auditLog, adUsage, recentAdEvents] = await Promise.all([
      db.user.findMany({
        where: {
          deletedAt: null,
          ...(search
            ? {
                OR: [
                  { name: { contains: search } },
                  { email: { contains: search } },
                ],
              }
            : {}),
          ...(tier !== 'all' ? { subscriptionTier: tier } : {}),
          ...(status === 'suspended' || status === 'banned'
            ? { isBanned: true }
            : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          subscriptionTier: true,
          plan: true,
          role: true,
          isBanned: true,
          banReason: true,
          referralCode: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      db.signal.findMany({
        ...(signalStatus !== 'all' ? { where: { status: signalStatus } } : {}),
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.couponCode.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      db.supportTicket.findMany({
        where: { status: { in: ['open', 'in_progress'] } },
        select: {
          id: true,
          userId: true,
          subject: true,
          description: true,
          category: true,
          priority: true,
          status: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.adminAuditLog.findMany({
        select: {
          id: true,
          adminId: true,
          action: true,
          target: true,
          details: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      db.usageEvent.groupBy({
        by: ['userId'],
        where: { feature: 'ad' },
        _count: { _all: true },
        orderBy: { _count: { userId: 'desc' } },
        take: 50,
      }).then(async (groups) => {
        const ids = groups.map((g) => g.userId)
        const userMap = ids.length
          ? await db.user.findMany({
              where: { id: { in: ids } },
              select: { id: true, name: true, email: true },
            }).then((us) => new Map(us.map((u) => [u.id, u])))
          : new Map()
        return groups.map((g) => ({
          userId: g.userId,
          count: g._count._all,
          name: userMap.get(g.userId)?.name || 'Unnamed',
          email: userMap.get(g.userId)?.email || '',
        }))
      }),
      db.usageEvent.findMany({
        where: { feature: 'ad' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          userId: true,
          action: true,
          meta: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
    ])

    return successResponse({ users, signals, coupons, tickets, auditLog, adUsage, recentAdEvents })
  } catch (error) {
    console.error('Admin data GET error:', error)
    return errorResponse('Failed to fetch admin data', 500)
  }
}
