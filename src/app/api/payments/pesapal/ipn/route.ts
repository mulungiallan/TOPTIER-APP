// PesaPal IPN (Instant Payment Notification) webhook
// Receives payment status-change notifications from PesaPal and confirms the
// payment status with PesaPal before fulfilling the transaction (the IPN
// payload alone never carries the payment status — it must be queried).

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fulfillPendingPayment } from '@/lib/payments/fulfillment'
import { fulfillWalletFunding } from '@/lib/services/wallet'
import { pesapalGateway } from '@/lib/payments/pesapal'

async function readIpnParams(request: NextRequest): Promise<{ orderTrackingId: string; merchantReference: string }> {
  const searchParams = request.nextUrl.searchParams
  if (searchParams.get('OrderTrackingId')) {
    return {
      orderTrackingId: searchParams.get('OrderTrackingId') || '',
      merchantReference: searchParams.get('OrderMerchantReference') || '',
    }
  }
  try {
    const body = await request.json()
    return {
      orderTrackingId: body?.OrderTrackingId || '',
      merchantReference: body?.OrderMerchantReference || '',
    }
  } catch {
    return { orderTrackingId: '', merchantReference: '' }
  }
}

async function processPesapalNotification(orderTrackingId: string, merchantReference: string) {
  if (!orderTrackingId) return

  // Find the pending transaction for this PesaPal order.
  const transaction = await db.paymentTransaction.findFirst({
    where: { stripeSessionId: orderTrackingId, status: 'pending' },
  })
  if (!transaction) return // Nothing pending — already fulfilled or unknown order.

  // Confirm the status server-side with PesaPal before granting anything.
  const result = await pesapalGateway.verifyPayment({
    provider: 'pesapal',
    providerTransactionId: orderTrackingId,
    reference: merchantReference || undefined,
    metadata: { planType: transaction.planType },
  })

  if (result.status === 'completed') {
    // Amount integrity check: the amount reported by PesaPal must match what
    // we charged, otherwise flag for manual review instead of fulfilling.
    const paidAmount = Number(result.amount)
    if (Number.isFinite(paidAmount) && paidAmount > 0 && Math.abs(paidAmount - transaction.amount) > 0.01) {
      console.error(
        `[pesapal ipn] Amount mismatch: expected ${transaction.amount}, PesaPal reported ${paidAmount} for transaction ${transaction.id}`
      )
      await db.paymentTransaction.update({
        where: { id: transaction.id },
        data: { status: 'failed', description: `${transaction.description || ''} | AMOUNT_MISMATCH` },
      })
      return
    }

    const paymentMethod = result.metadata?.payment_method || undefined
    if (transaction.planType === 'wallet_fund') {
      await fulfillWalletFunding(
        { id: transaction.id, userId: transaction.userId, description: transaction.description, orderTrackingId },
        { paymentMethod }
      )
    } else {
      await fulfillPendingPayment(
        { id: transaction.id },
        { provider: 'pesapal', paymentMethod }
      )
    }
  } else if (result.status === 'failed' || result.status === 'refunded') {
    await db.paymentTransaction.updateMany({
      where: { id: transaction.id, status: 'pending' },
      data: { status: 'failed' },
    })
  }
}

export async function GET(request: NextRequest) {
  const { orderTrackingId, merchantReference } = await readIpnParams(request)
  try {
    await processPesapalNotification(orderTrackingId, merchantReference)
  } catch (err) {
    console.error('[pesapal ipn] processing error:', err)
    return new Response('Internal server error', { status: 500 })
  }
  return new Response('IPN received', { status: 200 })
}

export async function POST(request: NextRequest) {
  const { orderTrackingId, merchantReference } = await readIpnParams(request)
  if (!orderTrackingId) {
    return Response.json({ status: 500, error: 'Missing OrderTrackingId' }, { status: 400 })
  }
  try {
    await processPesapalNotification(orderTrackingId, merchantReference)
  } catch (err) {
    console.error('[pesapal ipn] processing error:', err)
    return Response.json({ status: 500, error: 'Processing failed' }, { status: 500 })
  }
  // Confirmation statement required by PesaPal for POST IPNs.
  return Response.json({
    orderNotificationType: 'IPNCHANGE',
    orderTrackingId,
    orderMerchantReference: merchantReference,
    status: 200,
  })
}