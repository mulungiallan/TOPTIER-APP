// M-Pesa B2C ResultURL callback — settles a KES payout.
//
// Safaricom POSTs the async B2C result here (ResultURL + QueueTimeOutURL).
// The HTTP body is not signed; integrity comes from matching the conversation
// IDs we stored on submit and only settling a payout still in
// pending/processing (a replayed or superseded callback can never double-pay
// or double-refund — ledger refunds are idempotent per reference too).
//
// ResultType 2 (timeout/enqueued) means the final result arrives later — we
// leave the payout untouched.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { depositCash } from '@/lib/services/wallet'
import { mpesaB2cParseResult } from '@/lib/payments/mpesa-b2c'

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const result = mpesaB2cParseResult(payload)
    if (!result) {
      return Response.json({ error: 'Not a B2C result payload' }, { status: 400 })
    }

    if (result.resultType === 2) {
      // Timed out / enqueued for retry — the definitive result is on its way.
      return Response.json({ received: true, pending: true }, { status: 200 })
    }

    const ids = [result.originatorConversationId, result.conversationId, result.transactionId].filter(Boolean) as string[]
    const payout = await db.payoutRequest.findFirst({
      where: { method: 'mpesa', status: { in: ['pending', 'processing'] }, txHash: { in: ids } },
      select: { id: true, amount: true, userId: true, txHash: true },
    })

    if (!payout) {
      console.warn('[mpesa b2c callback] No matching open payout for', ids)
      return Response.json({ received: true, matched: false }, { status: 200 })
    }

    const succeeded = result.resultCode === 0

    if (result.amount !== undefined && Math.abs(result.amount - payout.amount) > 0.001) {
      console.error(
        `[mpesa b2c callback] Amount mismatch payout ${payout.id}: expected ${payout.amount}, callback reported ${result.amount}`
      )
    }

    if (succeeded) {
      await db.payoutRequest.update({
        where: { id: payout.id },
        data: { status: 'paid', paidAt: new Date(), txHash: result.transactionId || payout.txHash },
      })
      return Response.json({ received: true, matched: true }, { status: 200 })
    }

    await db.payoutRequest.update({
      where: { id: payout.id },
      data: { status: 'failed', failureReason: result.resultDesc || 'M-Pesa B2C disbursement failed' },
    })
    try {
      await depositCash({
        userId: payout.userId || '',
        asset: 'KES',
        amount: payout.amount,
        reference: `refund_${payout.id}`,
        memo: `Refund — M-Pesa payout failed (${result.resultDesc || 'provider error'})`,
      })
    } catch (error) {
      console.error(`[mpesa b2c callback] Refund failed for payout ${payout.id}:`, error)
    }

    return Response.json({ received: true, matched: true, settled: 'failed' }, { status: 200 })
  } catch (error) {
    console.error('[mpesa b2c callback] error:', error)
    return Response.json({ error: 'Callback processing failed' }, { status: 400 })
  }
}