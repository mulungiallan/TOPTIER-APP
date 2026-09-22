import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'
import { buildPaidEarningsUpdates, refundReservedUserPayout } from '@/lib/payouts'

export async function POST(request: NextRequest) {
  try {
    const { error } = await requireAdmin(request)
    if (error) return error

    const body = await request.json()
    const { requestId, action } = body

    if (!requestId || typeof requestId !== 'string') {
      return errorResponse('requestId is required', 400)
    }

    const payout = await db.payoutRequest.findUnique({ where: { id: requestId } })
    if (!payout) {
      return errorResponse('Payout request not found', 404)
    }

    if (action === 'cancel') {
      if (payout.status !== 'pending') {
        return errorResponse('Only pending requests can be cancelled', 400)
      }
      // User payout: return any ledger reserve to the user's wallet first.
      if (payout.userId) {
        await refundReservedUserPayout(payout)
      }
      await db.payoutRequest.update({
        where: { id: payout.id },
        data: { status: 'cancelled' },
      })
      return successResponse({ status: 'cancelled' })
    }

    if (action === 'mark_paid') {
      if (payout.status === 'paid') {
        return successResponse({ status: 'paid' })
      }
      if (payout.status === 'cancelled') {
        return errorResponse('Cancelled requests cannot be marked paid', 400)
      }

      if (payout.userId) {
        // User payouts are funded from the platform's Binance balance and the
        // user's ledger was already reserved — never consume platform earnings.
        await db.payoutRequest.update({
          where: { id: payout.id },
          data: { status: 'paid', paidAt: new Date() },
        })
        return successResponse({ status: 'paid' })
      }

      await db.$transaction([
        db.payoutRequest.update({
          where: { id: payout.id },
          data: { status: 'paid', paidAt: new Date() },
        }),
        // Mark the oldest available earnings as paid until this payout is covered.
        ...(await buildPaidEarningsUpdates(payout.netAmount)),
      ])

      return successResponse({ status: 'paid' })
    }

    return errorResponse('action must be "cancel" or "mark_paid"', 400)
  } catch (err) {
    console.error('Payout action error:', err)
    return errorResponse('Failed to update payout', 500)
  }
}
