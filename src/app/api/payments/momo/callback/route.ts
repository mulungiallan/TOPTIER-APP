// MTN MoMo Disbursement callback — settles a UGX payout.
//
// MTN POSTs the async transfer result to the X-Callback-Url we supplied. MTN
// may also replay or deliver via PUT; we accept both. The payload echoes our
// `externalId` (= the payout id), which is how we match. Only an open payout
// (pending/processing) can be settled, so a replayed callback can't double-pay.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { depositCash } from '@/lib/services/wallet'

async function handleMomoCallback(request: NextRequest): Promise<Response> {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const externalId = typeof payload.externalId === 'string' ? payload.externalId : ''
  const status = typeof payload.status === 'string' ? payload.status.toUpperCase() : ''
  if (!externalId || !status) {
    return Response.json({ error: 'Invalid MoMo callback payload' }, { status: 400 })
  }

  const payout = await db.payoutRequest.findFirst({
    where: { id: externalId, method: 'mtn_momo', status: { in: ['pending', 'processing'] } },
    select: { id: true, amount: true, userId: true, txHash: true },
  })

  if (!payout) {
    console.warn('[momo callback] No matching open payout for externalId', externalId)
    return Response.json({ received: true, matched: false }, { status: 200 })
  }

  const amountRaw = payload.amount
  const callbackAmount = typeof amountRaw === 'number' || typeof amountRaw === 'string' ? Number(amountRaw) : NaN
  if (Number.isFinite(callbackAmount) && Math.abs(callbackAmount - payout.amount) > 0.01) {
    console.error(`[momo callback] Amount mismatch payout ${payout.id}: expected ${payout.amount}, callback reported ${callbackAmount}`)
  }

  const financialTransactionId = typeof payload.financialTransactionId === 'string' ? payload.financialTransactionId : undefined

  if (status === 'SUCCESSFUL') {
    await db.payoutRequest.update({
      where: { id: payout.id },
      data: { status: 'paid', paidAt: new Date(), txHash: financialTransactionId || payout.txHash },
    })
    return Response.json({ received: true, matched: true }, { status: 200 })
  }

  const reasonObj = payload.reason as { code?: string; message?: string } | undefined
  const reason =
    typeof reasonObj?.message === 'string'
      ? `${String(reasonObj.code || '')} ${reasonObj.message}`.trim()
      : status

  await db.payoutRequest.update({
    where: { id: payout.id },
    data: { status: 'failed', failureReason: reason },
  })
  try {
    await depositCash({
      userId: payout.userId || '',
      asset: 'UGX',
      amount: payout.amount,
      reference: `refund_${payout.id}`,
      memo: `Refund — MTN MoMo payout failed (${reason})`,
    })
  } catch (error) {
    console.error(`[momo callback] Refund failed for payout ${payout.id}:`, error)
  }

  return Response.json({ received: true, matched: true, settled: 'failed' }, { status: 200 })
}

export async function POST(request: NextRequest) {
  try {
    return await handleMomoCallback(request)
  } catch (error) {
    console.error('[momo callback] error:', error)
    return Response.json({ error: 'Callback processing failed' }, { status: 400 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    return await handleMomoCallback(request)
  } catch (error) {
    console.error('[momo callback] error:', error)
    return Response.json({ error: 'Callback processing failed' }, { status: 400 })
  }
}