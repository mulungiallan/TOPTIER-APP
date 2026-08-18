// Flutterwave Callback - handles redirect after payment
//
// SECURITY: We NEVER trust client-supplied meta for userId/planType.
// Instead, we verify the transaction with Flutterwave's API, then look up
// the pending transaction by the Flutterwave transaction ID (stored as
// stripeSessionId at init).

import { NextRequest } from 'next/server'
import { fulfillPendingPayment } from '@/lib/payments/fulfillment'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const transactionId = searchParams.get('transaction_id')

    if (status === 'successful' && transactionId) {
      // Verify with Flutterwave API
      const secretKey = process.env.FLUTTERWAVE_SECRET_KEY
      if (!secretKey) {
        console.error('[flutterwave callback] FLUTTERWAVE_SECRET_KEY not configured')
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        return Response.redirect(`${appUrl}/?payment=error`)
      }

      const verifyResponse = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
        headers: { 'Authorization': `Bearer ${secretKey}` },
      })
      const data = await verifyResponse.json()

      if (data.status === 'success' && data.data?.status === 'successful') {
        // SECURE: Look up the pending transaction by Flutterwave's transaction ID,
        // NOT by user-supplied meta. The transaction ID is stored at init.
        await fulfillPendingPayment(
          { stripeSessionId: transactionId },
          { provider: 'flutterwave' }
        )
      }
    }

    // Redirect back to app
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return Response.redirect(`${appUrl}/?payment=${status === 'successful' ? 'success' : 'failed'}`)
  } catch (error) {
    console.error('Flutterwave callback error:', error)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return Response.redirect(`${appUrl}/?payment=error`)
  }
}
