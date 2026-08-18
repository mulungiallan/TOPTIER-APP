// Stripe Webhook (legacy) — DEPRECATED
//
// This endpoint coexists with /api/webhooks/stripe which handles the newer
// Packages system. To avoid processing events twice, this legacy handler
// is now a no-op that logs the event and returns 200.
//
// If you are migrating from the old subscription-tier system to Packages,
// you can remove this file entirely after updating the Stripe Dashboard
// webhook URL to point to /api/webhooks/stripe.
//
// WARNING: Do NOT register BOTH webhook URLs in Stripe — events would be
// processed twice, causing data inconsistency.

import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return Response.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  console.warn(
    '[stripe webhook legacy] Received event on deprecated /api/payments/stripe/webhook. ' +
    'Migrate to /api/webhooks/stripe and remove this endpoint from the Stripe Dashboard.'
  )

  return Response.json({ received: true, deprecated: true })
}
