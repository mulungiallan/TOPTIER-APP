import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'
import { getAvailableBalance, getEarningsBySource } from '@/lib/payouts'

export async function GET(request: NextRequest) {
  try {
    const { error } = await requireAdmin(request)
    if (error) return error

    const [balance, summaryBySource] = await Promise.all([
      getAvailableBalance(),
      getEarningsBySource(),
    ])

    const [earnings, accounts, requests] = await Promise.all([
      db.platformEarning.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.payoutAccount.findMany({
        orderBy: { isDefault: 'desc' },
      }),
      db.payoutRequest.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { account: { select: { method: true } } },
      }),
    ])

    return successResponse({ balance, earnings, accounts, requests, summaryBySource })
  } catch (err) {
    console.error('Payouts GET error:', err)
    return errorResponse('Failed to load payout data', 500)
  }
}
