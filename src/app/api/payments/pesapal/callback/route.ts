// PesaPal callback - PesaPal redirects the customer here after processing.
// The callback carries only the order identifiers (never the payment status),
// so we confirm the status with PesaPal before redirecting the customer and
// fulfilling the pending transaction.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fulfillPendingPayment } from '@/lib/payments/fulfillment'
import { fulfillWalletFunding } from '@/lib/services/wallet'
import { pesapalGateway, pesapalAmountAccepted } from '@/lib/payments/pesapal'

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
      select: { id: true, userId: true, amount: true, currency: true, planType: true, status: true, description: true },
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
      // Amount check: currency-aware and non-fatal. PesaPal reports cross-
      // currency/mobile-money payments in a different currency than the order
      // was submitted in (e.g. a 329 KES order paid via AirtelUG returns
      // amount=9980). The wallet credits the user-approved amount from the
      // WALLET_FUND marker, never the reported value, so a mismatch must never
      // strand a paid order — log it and fulfill.
      const amountCheck = pesapalAmountAccepted({
        expectedAmount: transaction.amount,
        expectedCurrency: transaction.currency,
        reportedAmount: result.amount,
        reportedCurrency: result.currency,
      })
      if (!amountCheck.accepted) {
        console.error(`[pesapal callback] Amount discrepancy for transaction ${transaction.id}: ${amountCheck.reason}`)
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