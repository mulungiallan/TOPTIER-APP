import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getStripe } from '@/lib/stripe'
import { notifyUser } from '@/lib/services/notifications'
import type Stripe from 'stripe'

/**
 * POST /api/webhooks/stripe
 *
 * Webhook handler for the new Packages system. Handles:
 *   - checkout.session.completed  → activate order, set user.plan
 *   - invoice.payment_succeeded   → extend planExpiresAt
 *   - invoice.payment_failed      → notify user
 *   - customer.subscription.deleted → downgrade to free
 *
 * Configure this URL in Stripe Dashboard → Webhooks.
 * Signing secret: STRIPE_WEBHOOK_SECRET env var.
 *
 * NOTE: The legacy Stripe webhook at /api/payments/stripe/webhook handles
 * the older subscription-tier system. Both can coexist.
 */

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET not configured')
    return new Response('Webhook secret not configured', { status: 500 })
  }

  const stripe = getStripe()
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[webhook] Signature verification failed:', message)
    return new Response(`Webhook Error: ${message}`, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice)
        break
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object as Stripe.Subscription)
        break
      default:
        // Not an error — many event types we don't care about
        console.info(`[webhook] Unhandled event type: ${event.type}`)
    }

    return new Response('Webhook received', { status: 200 })
  } catch (error) {
    console.error('[webhook] Processing failed:', error)
    return new Response('Webhook processing failed', { status: 500 })
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {}
  const { userId, packageId, analyses, duration } = metadata
  const uid = String(userId || '')
  const pkgId = String(packageId || '')
  const anaCount = Number(analyses || 0)

  if (!uid || !pkgId) {
    console.error('[webhook] checkout.session.completed missing metadata', metadata)
    return
  }

  const pkg = await db.package.findUnique({ where: { id: pkgId } })
  if (!pkg) {
    console.error(`[webhook] Package not found: ${pkgId}`)
    return
  }

  // Calculate subscription window
  const startDate = new Date()
  const endDate = new Date()
  if (duration === 'annual') {
    endDate.setFullYear(endDate.getFullYear() + 1)
  } else {
    endDate.setMonth(endDate.getMonth() + 1)
  }

  // Activate the pending order
  await db.order.updateMany({
    where: {
      userId: uid,
      packageId: pkgId,
      status: 'pending',
      stripeSessionId: session.id,
    },
    data: {
      status: 'paid',
      startDate,
      endDate,
      stripePaymentId: String(session.payment_intent || ''),
      stripeSubscriptionId: String(session.subscription || ''),
    },
  })

  // Update user's plan + analyses quota
  const analysesLimit = anaCount || 0
  await db.user.update({
    where: { id: uid },
    data: {
      plan: pkg.name.toLowerCase().replace(/\s+/g, '_'),
      analysesLimit,
      analysesUsed: 0,
      analysesResetAt: startDate,
      planExpiresAt: endDate,
      stripeCustomerId: String(session.customer || ''),
      // Keep legacy subscriptionTier in sync for backward compatibility
      subscriptionTier: pkg.name.toLowerCase().includes('unlimited')
        ? 'lifetime'
        : 'premium',
      subscriptionStartDate: startDate,
      subscriptionEndDate: endDate,
    },
  })

  // Notify the user
  await notifyUser(uid, {
    type: 'subscription',
    title: `${pkg.name} activated`,
    message: `Your ${pkg.name} plan is now active. ${
      analysesLimit === 0 ? 'Unlimited analyses' : `${analysesLimit} analyses/month`
    } available.`,
  })

  console.log(`[webhook] ✓ Activated ${pkg.name} for user ${userId}`)
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string
  if (!customerId) return

  const user = await db.user.findFirst({ where: { stripeCustomerId: customerId } })
  if (!user) {
    console.warn(`[webhook] payment_succeeded: no user for customer ${customerId}`)
    return
  }

  // For subscriptions, extend the plan expiry to the new period end.
  // The `subscription` field moved to `invoice.parent.subscription_details.subscription`
  // in API version 2026-05-27.dahlia, but old invoices still have `invoice.subscription`.
  // Use a safe accessor that handles both shapes.
  const rawInvoice = invoice as unknown as Record<string, unknown>
  const subscriptionId =
    (typeof rawInvoice.subscription === 'string' && rawInvoice.subscription) ||
    (typeof (rawInvoice.parent as { subscription_details?: { subscription?: unknown } })?.subscription_details?.subscription === 'string'
      && ((rawInvoice.parent as { subscription_details: { subscription: string } }).subscription_details.subscription)) ||
    null

  if (subscriptionId) {
    const stripe = getStripe()
    const subscription = (await stripe.subscriptions.retrieve(subscriptionId)) as unknown as {
      current_period_end?: number
    }

    // `current_period_end` is a unix timestamp; falls back to now+30d if missing
    const periodEndTs = subscription.current_period_end ?? Math.floor(Date.now() / 1000) + 30 * 86400
    const periodEnd = new Date(periodEndTs * 1000)

    await db.user.update({
      where: { id: user.id },
      data: {
        planExpiresAt: periodEnd,
        subscriptionEndDate: periodEnd,
        // Reset monthly analyses counter on renewal
        analysesUsed: 0,
        analysesResetAt: new Date(),
      },
    })

    console.log(`[webhook] ✓ Renewed plan for user ${user.id} until ${periodEnd.toISOString()}`)
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string
  if (!customerId) return

  const user = await db.user.findFirst({ where: { stripeCustomerId: customerId } })
  if (!user) return

  await notifyUser(user.id, {
    type: 'subscription',
    title: 'Payment failed',
    message:
      'Your subscription payment failed. Please update your payment method to avoid losing access.',
  })

  console.warn(`[webhook] ⚠ Payment failed for user ${user.id}`)
}

async function handleSubscriptionCancelled(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string
  if (!customerId) return

  const user = await db.user.findFirst({ where: { stripeCustomerId: customerId } })
  if (!user) return

  await db.user.update({
    where: { id: user.id },
    data: {
      plan: 'free',
      analysesLimit: 5,
      analysesUsed: 0,
      planExpiresAt: null,
      // Keep legacy field in sync
      subscriptionTier: 'free',
      subscriptionEndDate: new Date(),
    },
  })

  await notifyUser(user.id, {
    type: 'subscription',
    title: 'Subscription cancelled',
    message:
      'Your subscription has been cancelled. Your account has been downgraded to the Free plan.',
  })

  console.log(`[webhook] ↓ Downgraded user ${user.id} to free`)
}
