// TOPTIER Payment Initialization API
// Starts a payment flow with the selected provider

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { initializePayment, getGateway, type PaymentProvider, type PlanType } from '@/lib/payments/registry'
import { PAYMENTS_ENABLED } from '@/lib/flags'

const PLANS: Record<string, { price: number; currency: string }> = {
  trial: { price: 0, currency: 'USD' },
  premium_monthly: { price: 29.99, currency: 'USD' },
  premium_annual: { price: 249.99, currency: 'USD' },
  lifetime: { price: 499.99, currency: 'USD' },
}

// Live exchange rate cache (refreshes every 5 minutes)
let rateCache: { rates: Record<string, number>; fetchedAt: number } | null = null
const RATE_CACHE_TTL = 5 * 60 * 1000

async function getExchangeRate(from: string, to: string, fallback: number): Promise<number> {
  try {
    const now = Date.now()
    if (!rateCache || now - rateCache.fetchedAt > RATE_CACHE_TTL) {
      const res = await fetch(
        `https://api.exchangerate-api.com/v4/latest/${from}`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (res.ok) {
        const data = await res.json()
        rateCache = { rates: data.rates || {}, fetchedAt: now }
      }
    }
    const rate = rateCache?.rates[to]
    if (rate && rate > 0) return rate
  } catch {
    // API unavailable — use fallback
  }
  return fallback
}

export async function POST(request: NextRequest) {
  try {
    if (!PAYMENTS_ENABLED) {
      return errorResponse('Premium subscriptions are not open yet.', 503)
    }

    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { provider, planType, couponCode, metadata } = body as {
      provider: PaymentProvider
      planType: PlanType
      couponCode?: string
      metadata?: Record<string, string>
    }

    if (!provider || !planType) {
      return errorResponse('provider and planType are required', 400)
    }

    // Validate provider
    try {
      getGateway(provider)
    } catch {
      return errorResponse(`Invalid payment provider: ${provider}`, 400)
    }

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
    if (user.country === 'KE' && (provider === 'mpesa' || provider === 'flutterwave')) {
      currency = 'KES'
      finalAmount = Math.round(finalAmount * await getExchangeRate('USD', 'KES', 153))
    } else if (user.country === 'NG' && (provider === 'paystack' || provider === 'flutterwave')) {
      currency = 'NGN'
      finalAmount = Math.round(finalAmount * await getExchangeRate('USD', 'NGN', 1550))
    } else if (user.country === 'GH' && (provider === 'paystack' || provider === 'flutterwave')) {
      currency = 'GHS'
      finalAmount = Math.round(finalAmount * await getExchangeRate('USD', 'GHS', 15))
    } else if (user.country === 'ZA' && (provider === 'paystack' || provider === 'flutterwave')) {
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
        country: user.country || '',
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
    return errorResponse(error instanceof Error ? error.message : 'Failed to initialize payment', 500)
  }
}
