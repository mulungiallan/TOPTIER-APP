// TOPTIER Payment Initialization API
// Starts a payment flow with the selected provider

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, authenticateRequest, successResponse, errorResponse } from '@/lib/auth'
import { initializePayment, type PaymentProvider, type PlanType } from '@/lib/payments/registry'
import { getExchangeRate } from '@/lib/payments/exchange-rates'
import { countryNameToCode } from '@/lib/countries'
import { PAYMENTS_ENABLED } from '@/lib/flags'
import { validateBody, paymentInitSchema } from '@/lib/validation'

const PLANS: Record<string, { price: number; currency: string }> = {
  trial: { price: 0, currency: 'USD' },
  premium_monthly: { price: 29.99, currency: 'USD' },
  premium_annual: { price: 249.99, currency: 'USD' },
  lifetime: { price: 499.99, currency: 'USD' },
}

export async function POST(request: NextRequest) {
  try {
    if (!PAYMENTS_ENABLED) {
      return errorResponse('Premium subscriptions are not open yet.', 503)
    }

    const auth = await authenticateRequest(request)
    if (auth.error) {
      return errorResponse(auth.error, 401)
    }
    const userId = auth.user!.id

    const body = await request.json()
    const parsed = validateBody(paymentInitSchema, body)
    if (!parsed.success) {
      return errorResponse(parsed.error, 400)
    }

    const { provider, planType, couponCode, metadata } = parsed.data

    // Validate plan
    const plan = PLANS[planType]
    if (!plan) {
      return errorResponse(`Invalid plan type: ${planType}`, 400)
    }

    // Free trial doesn't need payment
    if (planType === 'trial' || plan.price === 0) {
      const now = new Date()
      const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

      const existing = await db.user.findUnique({
        where: { id: userId },
        select: { trialStartDate: true, subscriptionTier: true, subscriptionEndDate: true },
      })
      if (!existing) {
        return errorResponse('User not found', 404)
      }
      if (existing.trialStartDate) {
        return errorResponse('You have already used your free trial. It can only be activated once.', 400)
      }
      if (existing.subscriptionTier === 'premium' || existing.subscriptionTier === 'lifetime') {
        return errorResponse('You already have an active subscription.', 400)
      }
      if (existing.subscriptionEndDate && new Date() < existing.subscriptionEndDate) {
        return errorResponse('You already have an active subscription.', 400)
      }

      await db.user.update({
        where: { id: userId },
        data: {
          subscriptionTier: 'trial',
          trialStartDate: now,
          trialEndDate: trialEnd,
          subscriptionStartDate: now,
          subscriptionEndDate: trialEnd,
        },
      })

      return successResponse({
        subscription: { tier: 'trial', startDate: now, endDate: trialEnd, isActive: true },
        requiresPayment: false,
      })
    }

    // Get user info for payment
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, phone: true, country: true },
    })

    if (!user) {
      return errorResponse('User not found', 404)
    }

    // Apply coupon discount (validated but NOT consumed here — usage is
    // incremented only once the payment actually completes, to avoid burning
    // coupons on abandoned checkouts).
    let discount = 0
    let finalAmount = plan.price
    let couponUsed: string | null = null
    if (couponCode) {
      const coupon = await db.couponCode.findUnique({ where: { code: couponCode } })
      if (coupon && coupon.isActive && (!coupon.expiresAt || new Date() < coupon.expiresAt)) {
        if (!coupon.maxUses || coupon.usedCount < coupon.maxUses) {
          discount = coupon.discountType === 'percentage'
            ? plan.price * (coupon.discountAmount / 100)
            : coupon.discountAmount
          finalAmount = Math.max(0, plan.price - discount)
          couponUsed = coupon.code
        }
      }
    }

    // Determine currency based on user country.
    // Fetch live exchange rates from a free API; fall back to approximate
    // rates if the API is unavailable (never silently overcharge).
    let currency = plan.currency
    const userCountryCode = countryNameToCode(user.country)
    if (userCountryCode === 'KE' && (provider === 'mpesa' || provider === 'flutterwave' || provider === 'pesapal')) {
      currency = 'KES'
      finalAmount = Math.round(finalAmount * await getExchangeRate('USD', 'KES', 153))
    } else if (userCountryCode === 'NG' && (provider === 'paystack' || provider === 'flutterwave')) {
      currency = 'NGN'
      finalAmount = Math.round(finalAmount * await getExchangeRate('USD', 'NGN', 1550))
    } else if (userCountryCode === 'GH' && (provider === 'paystack' || provider === 'flutterwave')) {
      currency = 'GHS'
      finalAmount = Math.round(finalAmount * await getExchangeRate('USD', 'GHS', 15))
    } else if (userCountryCode === 'ZA' && (provider === 'paystack' || provider === 'flutterwave')) {
      currency = 'ZAR'
      finalAmount = Math.round(finalAmount * await getExchangeRate('USD', 'ZAR', 18))
    }

    // Create pending payment transaction
    const transaction = await db.paymentTransaction.create({
      data: {
        userId,
        amount: finalAmount,
        currency,
        planType,
        paymentProvider: provider,
        status: 'pending',
        description: `TOPTIER ${planType.replace('_', ' ')} subscription${discount > 0 ? ` (discount: $${discount.toFixed(2)})` : ''}${couponUsed ? `|coupon:${couponUsed}` : ''}`,
      },
    })

    // Initialize payment with the selected provider
    const result = await initializePayment(provider, {
      userId,
      userEmail: user.email || '',
      userName: user.name || 'TOPTIER User',
      planType,
      amount: finalAmount,
      currency,
      couponCode,
      metadata: {
        transactionId: transaction.id,
        phone: user.phone || '',
        country: userCountryCode,
        ...metadata,
      },
    })

    // Update transaction with provider info
    await db.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        stripeSessionId: result.providerTransactionId,
      },
    })

    return successResponse({
      requiresPayment: true,
      transaction: {
        id: transaction.id,
        amount: finalAmount,
        currency,
        planType,
        originalAmount: plan.price,
        discount,
        status: 'pending',
      },
      payment: result,
    })
  } catch (error) {
    console.error('Payment init POST error:', error)
    // Do NOT leak internal error messages to the client.
    return errorResponse('Failed to initialize payment. Please try again.', 500)
  }
}
