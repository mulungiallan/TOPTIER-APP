import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { getStripe, STRIPE_APP_URL } from '@/lib/stripe'
import { PAYMENTS_ENABLED } from '@/lib/flags'

/**
 * POST /api/packages/checkout
 * Creates a Stripe Checkout Session for the given package.
 *
 * Body: { "packageId": "...", "couponCode"?: "..." }
 * Returns: { "sessionId": "...", "url": "...", "orderId": "..." }
 */
export async function POST(request: NextRequest) {
  try {
    if (!PAYMENTS_ENABLED) {
      return errorResponse('Premium subscriptions are not open yet.', 503)
    }

    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const packageId = body.packageId as string | undefined
    const couponCode = body.couponCode as string | undefined

    if (!packageId) {
      return errorResponse('packageId is required', 400)
    }

    // Skip Stripe if not configured (dev mode) — return mock success
    const stripeKey = process.env.STRIPE_SECRET_KEY
    if (!stripeKey) {
      return errorResponse(
        'Stripe is not configured. Set STRIPE_SECRET_KEY in .env to enable checkout.',
        503
      )
    }

    const pkg = await db.package.findUnique({ where: { id: packageId } })
    if (!pkg || !pkg.isActive) {
      return errorResponse('Package not found or inactive', 404)
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, stripeCustomerId: true },
    })
    if (!user) {
      return errorResponse('User not found', 404)
    }

    const stripe = getStripe()

    // 1. Create or reuse Stripe customer
    let customerId = user.stripeCustomerId
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        name: user.name || undefined,
        metadata: { userId },
      })
      customerId = customer.id
      await db.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      })
    }

    // 2. Build line item
    const isAnnual = pkg.duration === 'annual'
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem =
      pkg.stripePriceId
        ? { price: pkg.stripePriceId, quantity: 1 }
        : {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `TOPTIER ${pkg.name}`,
                description: `${pkg.analyses === 0 ? 'Unlimited' : pkg.analyses} analyses · ${pkg.duration}`,
              },
              unit_amount: Math.round(pkg.price * 100),
              ...(isAnnual
                ? {}
                : { recurring: { interval: 'month', interval_count: 1 } }),
            },
            quantity: 1,
          }

    // 3. Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [lineItem],
      mode: isAnnual ? 'payment' : 'subscription',
      success_url: `${STRIPE_APP_URL}/?payment=success&session_id={CHECKOUT_SESSION_ID}&package=${pkg.name}`,
      cancel_url: `${STRIPE_APP_URL}/?payment=cancelled&package=${pkg.name}`,
      metadata: {
        userId,
        packageId,
        packageName: pkg.name,
        analyses: String(pkg.analyses),
        duration: pkg.duration,
        splitRatio: String(pkg.splitRatio),
      },
      ...(couponCode ? { discounts: [{ coupon: couponCode }] } : {}),
      allow_promotion_codes: true,
    })

    // 4. Create pending order in DB
    const now = new Date()
    const endDate = new Date(now)
    if (isAnnual) {
      endDate.setFullYear(endDate.getFullYear() + 1)
    } else {
      endDate.setMonth(endDate.getMonth() + 1)
    }

    const order = await db.order.create({
      data: {
        userId,
        packageId,
        amount: pkg.price,
        currency: 'USD',
        status: 'pending',
        analysesLimit: pkg.analyses,
        startDate: now,
        endDate,
        stripeSessionId: session.id,
      },
    })

    return successResponse({
      sessionId: session.id,
      url: session.url,
      orderId: order.id,
    })
  } catch (error) {
    console.error('Checkout failed:', error)
    const message = error instanceof Error ? error.message : 'Checkout failed'
    return errorResponse(message, 500)
  }
}

// Bring Stripe namespace into scope for type-only access
import type Stripe from 'stripe'
