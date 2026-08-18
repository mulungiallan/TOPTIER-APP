// PayPal Callback - handles redirect after payment approval
//
// SECURITY: We NEVER trust client-supplied custom_id for userId/planType.
// Instead, we verify the order with PayPal's API, then look up the pending
// transaction by PayPal's order ID (stored as stripeSessionId at init).

import { NextRequest } from 'next/server'
import { fulfillPendingPayment } from '@/lib/payments/fulfillment'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const success = searchParams.get('success')
    const orderId = searchParams.get('token') // PayPal order token

    if (success === 'true' && orderId) {
      const clientId = process.env.PAYPAL_CLIENT_ID
      const clientSecret = process.env.PAYPAL_CLIENT_SECRET
      if (!clientId || !clientSecret) {
        console.error('[paypal callback] PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET not configured')
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        return Response.redirect(`${appUrl}/?payment=error`)
      }

      const baseUrl = process.env.PAYPAL_ENVIRONMENT === 'production'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com'

      // Get access token
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      })
      const tokenData = await tokenResponse.json()

      if (!tokenData.access_token) {
        console.error('[paypal callback] Failed to obtain PayPal access token')
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        return Response.redirect(`${appUrl}/?payment=error`)
      }

      // Capture the order
      const captureResponse = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
      })
      const captureData = await captureResponse.json()

      if (captureData.status === 'COMPLETED') {
        // SECURE: Look up the pending transaction by PayPal's order ID,
        // NOT by user-supplied custom_id. The order ID is stored at init.
        await fulfillPendingPayment(
          { stripeSessionId: orderId },
          { provider: 'paypal' }
        )
      } else {
        console.warn(`[paypal callback] Order ${orderId} status: ${captureData.status}`)
      }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return Response.redirect(`${appUrl}/?payment=${success === 'true' ? 'success' : 'failed'}`)
  } catch (error) {
    console.error('PayPal callback error:', error)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return Response.redirect(`${appUrl}/?payment=error`)
  }
}
