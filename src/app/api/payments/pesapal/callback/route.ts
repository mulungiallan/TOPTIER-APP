// PesaPal callback - PesaPal redirects the customer here after processing.
// The callback carries only the order identifiers (never the payment status),
// so we confirm the status with PesaPal before redirecting the customer and
// fulfilling the pending transaction.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fulfillPendingPayment } from '@/lib/payments/fulfillment'
import { fulfillWalletFunding } from '@/lib/services/wallet'
import { pesapalGateway } from '@/lib/payments/pesapal'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const searchParams = request.nextUrl.searchParams
  const orderTrackingId = searchParams.get('OrderTrackingId') || ''
  const merchantReference = searchParams.get('OrderMerchantReference') || ''

  if (!orderTrackingId) {
    return Response.redirect(`${appUrl}/?payment=failed&provider=pesapal`)
  }

  try {
    const transaction = await db.paymentTransaction.findFirst({
      where: { stripeSessionId: orderTrackingId },
      select: { id: true, userId: true, amount: true, planType: true, status: true, description: true },
    })

    // Already fulfilled by the IPN or a previous callback — treat as success.
    if (transaction && transaction.status === 'completed') {
      return Response.redirect(`${appUrl}/?page=${transaction.planType === 'wallet_fund' ? 'wallet' : 'pricing'}&payment=success&provider=pesapal`)
    }

    if (!transaction || transaction.status !== 'pending') {
      return Response.redirect(`${appUrl}/?payment=failed&provider=pesapal`)
    }

    // Confirm the payment status directly with PesaPal.
    const result = await pesapalGateway.verifyPayment({
      provider: 'pesapal',
      providerTransactionId: orderTrackingId,
      reference: merchantReference || undefined,
      metadata: { planType: transaction.planType },
    })

    if (result.status === 'completed') {
      // Amount integrity check before fulfilling.
      const paidAmount = Number(result.amount)
      if (Number.isFinite(paidAmount) && paidAmount > 0 && Math.abs(paidAmount - transaction.amount) > 0.01) {
        console.error(
          `[pesapal callback] Amount mismatch: expected ${transaction.amount}, PesaPal reported ${paidAmount} for transaction ${transaction.id}`
        )
        await db.paymentTransaction.update({
          where: { id: transaction.id },
          data: { status: 'failed', description: `${transaction.description || ''} | AMOUNT_MISMATCH` },
        })
        return Response.redirect(`${appUrl}/?payment=failed&provider=pesapal`)
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
      return Response.redirect(`${appUrl}/?page=${transaction.planType === 'wallet_fund' ? 'wallet' : 'pricing'}&payment=success&provider=pesapal`)
    }

    return Response.redirect(`${appUrl}/?payment=failed&provider=pesapal`)
  } catch (err) {
    console.error('[pesapal callback] verification error:', err)
    return Response.redirect(`${appUrl}/?payment=failed&provider=pesapal`)
  }
}