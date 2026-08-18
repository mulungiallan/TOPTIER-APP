// M-Pesa (Daraja) Callback - receives STK Push result from Safaricom

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fulfillPendingPayment } from '@/lib/payments/fulfillment'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const stkCallback = body.Body?.stkCallback

    if (!stkCallback) {
      return Response.json({ error: 'Invalid callback format' }, { status: 400 })
    }

    const checkoutRequestId = stkCallback.CheckoutRequestID
    const merchantRequestId = stkCallback.MerchantRequestID
    const resultCode = stkCallback.ResultCode

    if (resultCode === 0) {
      // Payment successful
      const callbackMetadata = stkCallback.CallbackMetadata?.Item || []
      const amount = callbackMetadata.find((i: { Name: string }) => i.Name === 'Amount')?.Value
      const mpesaReceipt = callbackMetadata.find((i: { Name: string }) => i.Name === 'MpesaReceiptNumber')?.Value
      const phone = callbackMetadata.find((i: { Name: string }) => i.Name === 'PhoneNumber')?.Value

      // Find the pending transaction by provider ID
      const transaction = await db.paymentTransaction.findFirst({
        where: { stripeSessionId: checkoutRequestId, status: 'pending' },
      })

      // Verify the callback amount matches the amount we charged when the
      // STK push was initiated. Safaricom callbacks are not signed, so this
      // is the server-side integrity check that prevents forged "successful"
      // callbacks from granting a free subscription.
      const callbackAmount = Number(amount)
      const expectedAmount = Number(transaction?.amount)

      if (transaction && !Number.isFinite(callbackAmount)) {
        console.error('[mpesa callback] Missing or invalid Amount in callback metadata')
        await db.paymentTransaction.update({
          where: { id: transaction.id },
          data: { status: 'failed' },
        })
        return Response.json({ error: 'Invalid callback amount' }, { status: 400 })
      }

      if (transaction && expectedAmount !== callbackAmount) {
        console.error(
          `[mpesa callback] Amount mismatch: expected ${expectedAmount}, callback reported ${callbackAmount} for transaction ${transaction.id}`
        )
        await db.paymentTransaction.update({
          where: { id: transaction.id },
          data: { status: 'failed' },
        })
        return Response.json({ error: 'Amount mismatch' }, { status: 400 })
      }

      if (transaction) {
        // Secondary integrity check: confirm the STK push status directly with
        // Safaricom before activating the subscription.
        try {
          const { mpesaGateway } = await import('@/lib/payments/mpesa')
          const queryResult = await mpesaGateway.verifyPayment({
            provider: 'mpesa',
            providerTransactionId: checkoutRequestId,
            metadata: { planType: transaction.planType },
          })
          if (queryResult.status !== 'completed') {
            console.error(
              `[mpesa callback] STK query did not confirm payment for transaction ${transaction.id} (status: ${queryResult.status})`
            )
            await db.paymentTransaction.update({
              where: { id: transaction.id },
              data: { status: 'failed' },
            })
            return Response.json({ error: 'Payment not confirmed by Safaricom' }, { status: 400 })
          }
        } catch (queryError) {
          // If the STK query itself fails (network / provider issue), we
          // CANNOT safely fulfill without Safaricom's confirmation. The
          // amount check alone is insufficient — a forged callback with
          // the correct CheckoutRequestID and amount would pass. Mark as
          // needing manual review instead of auto-fulfilling.
          console.error('[mpesa callback] STK query unavailable — marking transaction for manual review:', queryError)
          await db.paymentTransaction.update({
            where: { id: transaction.id },
            data: { status: 'failed', description: `${transaction.description || ''} | STK_QUERY_UNAVAILABLE` },
          })
          return Response.json({ error: 'Payment pending manual verification' }, { status: 202 })
        }
        await fulfillPendingPayment(
          { id: transaction.id },
          { provider: 'mpesa', paymentMethod: `M-Pesa (${mpesaReceipt})` }
        )
      }
    } else {
      // Payment failed or cancelled
      await db.paymentTransaction.updateMany({
        where: { stripeSessionId: checkoutRequestId, status: 'pending' },
        data: { status: 'failed' },
      })
    }

    return Response.json({ received: true })
  } catch (error) {
    console.error('M-Pesa callback error:', error)
    return Response.json({ error: 'Callback processing failed' }, { status: 400 })
  }
}
