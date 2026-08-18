// Paystack Callback - handles redirect after payment
//
// SECURITY: We NEVER trust client-supplied metadata for userId/planType.
// Instead, we verify the transaction with Paystack's API, then look up the
// pending transaction by the Paystack reference (stored as stripeSessionId).

import { NextRequest } from 'next/server'
import { fulfillPendingPayment } from '@/lib/payments/fulfillment'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const reference = searchParams.get('reference')

    if (!reference) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      return Response.redirect(`${appUrl}/?payment=error`)
    }

    // Verify with Paystack API
    const secretKey = process.env.PAYSTACK_SECRET_KEY
    if (!secretKey) {
      console.error('[paystack callback] PAYSTACK_SECRET_KEY not configured')
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      return Response.redirect(`${appUrl}/?payment=error`)
    }

    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { 'Authorization': `Bearer ${secretKey}` },
    })
    const data = await verifyResponse.json()

    if (data.status && data.data?.status === 'success') {
      // SECURE: Look up the pending transaction by Paystack's reference,
      // NOT by user-supplied metadata. The reference is stored at init.
      await fulfillPendingPayment(
        { stripeSessionId: reference },
        { provider: 'paystack' }
      )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return Response.redirect(`${appUrl}/?payment=${data.data?.status === 'success' ? 'success' : 'failed'}`)
  } catch (error) {
    console.error('Paystack callback error:', error)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return Response.redirect(`${appUrl}/?payment=error`)
  }
}
