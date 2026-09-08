// src/app/api/admin/search/route.ts
// Global ⌘K search across users, signals, tickets, coupons, news, bots.
// GET /api/admin/search?q=...

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse } from '@/lib/auth'
import { requirePermission } from '@/lib/admin-permissions'

export async function GET(request: NextRequest) {
  const { error, user } = await requirePermission(request, 'panel.access')
  if (error) return error

  const q = (request.nextUrl.searchParams.get('q') || '').trim().toLowerCase()
  if (q.length < 2) return successResponse({ q, results: [] })

  const [users, signals, tickets, coupons, news, bots] = await Promise.all([
    db.user.findMany({
      where: { OR: [{ email: { contains: q } }, { name: { contains: q } }, { id: { contains: q } }], deletedAt: null },
      select: { id: true, email: true, name: true, role: true, subscriptionTier: true, isBanned: true, createdAt: true },
      take: 8,
    }),
    db.signal.findMany({
      where: { OR: [{ asset: { contains: q } }, { id: { contains: q } }, { generatedKey: { contains: q } }] },
      select: { id: true, asset: true, type: true, status: true, strategyType: true, timeframe: true, createdAt: true },
      take: 8,
    }),
    db.supportTicket.findMany({
      where: { OR: [{ subject: { contains: q } }, { description: { contains: q } }, { id: { contains: q } }] },
      select: { id: true, subject: true, status: true, priority: true, createdAt: true },
      take: 8,
    }),
    db.couponCode.findMany({
      where: { code: { contains: q.toUpperCase() } },
      select: { id: true, code: true, discountType: true, discountAmount: true, usedCount: true, isActive: true },
      take: 8,
    }),
    db.newsArticle.findMany({
      where: { OR: [{ title: { contains: q } }, { summary: { contains: q } }] },
      select: { id: true, title: true, source: true, publishedAt: true },
      take: 8,
    }),
    db.botConnection.findMany({
      where: { OR: [{ login: { contains: q } }, { label: { contains: q } }, { brokerName: { contains: q } }] },
      select: { id: true, label: true, login: true, brokerName: true, isActive: true },
      take: 8,
    }),
  ])

  return successResponse({
    q,
    results: [
      { kind: 'users', label: 'Users', items: users },
      { kind: 'signals', label: 'Signals', items: signals },
      { kind: 'tickets', label: 'Tickets', items: tickets },
      { kind: 'coupons', label: 'Coupons', items: coupons },
      { kind: 'news', label: 'News', items: news },
      { kind: 'bots', label: 'Bots', items: bots },
    ],
    total: users.length + signals.length + tickets.length + coupons.length + news.length + bots.length,
  })
}