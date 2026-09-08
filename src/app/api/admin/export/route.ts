// src/app/api/admin/export/route.ts
// CSV exports for the panel. Rows are built fresh from the DB, and exports are
// audit-logged. GET /api/admin/export?kind=users|signals|audit|payments|coupons|tickets

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/admin-permissions'
import { NextResponse } from 'next/server'

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows: unknown[][], headers: string[]): string {
  return '\uFEFF' + [headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n')
}

async function collect(kind: string, search: string) {
  const q = (search || '').trim()
  switch (kind) {
    case 'users': {
      const rows = await db.user.findMany({
        where: q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }] } : undefined,
        select: { id: true, email: true, name: true, role: true, subscriptionTier: true, plan: true, isBanned: true, createdAt: true, isEmailVerified: true },
        take: 5000,
      })
      return {
        headers: ['id', 'email', 'name', 'role', 'tier', 'plan', 'banned', 'createdAt', 'emailVerified'],
        rows: rows.map((r) => [r.id, r.email, r.name, r.role, r.subscriptionTier, r.plan, r.isBanned, r.createdAt.toISOString(), r.isEmailVerified]),
      }
    }
    case 'signals': {
      const rows = await db.signal.findMany({
        select: { asset: true, type: true, entryPrice: true, stopLoss: true, takeProfit1: true, riskRewardRatio: true, confidence: true, strategyType: true, amdPhase: true, inMacroWindow: true, macroWindowName: true, status: true, timeframe: true, generatedAt: true },
        take: 3000,
      })
      return {
        headers: ['asset', 'type', 'entry', 'stop', 'tp1', 'rr', 'confidence', 'strategyType', 'amdPhase', 'macroWindow', 'macroWindowName', 'status', 'timeframe', 'generatedAt'],
        rows: rows.map((r) => [r.asset, r.type, r.entryPrice, r.stopLoss, r.takeProfit1, r.riskRewardRatio, r.confidence, r.strategyType, r.amdPhase, r.inMacroWindow, r.macroWindowName, r.status, r.timeframe, r.generatedAt.toISOString()]),
      }
    }
    case 'audit': {
      const rows = await db.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5000, select: { id: true, adminId: true, action: true, target: true, details: true, createdAt: true } })
      return {
        headers: ['id', 'adminId', 'action', 'target', 'details', 'createdAt'],
        rows: rows.map((r) => [r.id, r.adminId, r.action, r.target, r.details || '', r.createdAt.toISOString()]),
      }
    }
    case 'payments': {
      const rows = await db.paymentTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 5000, select: { id: true, userId: true, amount: true, currency: true, planType: true, status: true, paymentProvider: true, createdAt: true } })
      return {
        headers: ['id', 'userId', 'amount', 'currency', 'planType', 'status', 'provider', 'createdAt'],
        rows: rows.map((r) => [r.id, r.userId, r.amount, r.currency, r.planType, r.status, r.paymentProvider, r.createdAt.toISOString()]),
      }
    }
    case 'coupons': {
      const rows = await db.couponCode.findMany({ select: { id: true, code: true, discountType: true, discountAmount: true, maxUses: true, usedCount: true, maxPerUser: true, expiresAt: true, isActive: true, createdAt: true } })
      return {
        headers: ['id', 'code', 'type', 'amount', 'maxUses', 'used', 'maxPerUser', 'expiresAt', 'active', 'createdAt'],
        rows: rows.map((r) => [r.id, r.code, r.discountType, r.discountAmount, r.maxUses, r.usedCount, r.maxPerUser, r.expiresAt?.toISOString() ?? '', r.isActive, r.createdAt.toISOString()]),
      }
    }
    case 'tickets': {
      const rows = await db.supportTicket.findMany({ orderBy: { createdAt: 'desc' }, take: 5000, select: { id: true, userId: true, subject: true, category: true, priority: true, status: true, createdAt: true } })
      return {
        headers: ['id', 'userId', 'subject', 'category', 'priority', 'status', 'createdAt'],
        rows: rows.map((r) => [r.id, r.userId, r.subject, r.category, r.priority, r.status, r.createdAt.toISOString()]),
      }
    }
    default:
      return null
  }
}

export async function GET(request: NextRequest) {
  const { error, user } = await requirePermission(request, 'system.audit')
  if (error) return error

  const kind = request.nextUrl.searchParams.get('kind') || 'users'
  const search = request.nextUrl.searchParams.get('search') || ''
  const data = await collect(kind, search)
  if (!data) {
    return NextResponse.json({ success: false, error: 'Unknown export kind' }, { status: 400 })
  }

  await db.adminAuditLog.create({
    data: { adminId: user!.id, action: 'EXPORT', details: JSON.stringify({ kind, search: search || null }) },
  }).catch(() => {})

  const csv = toCsv(data.rows, data.headers)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}