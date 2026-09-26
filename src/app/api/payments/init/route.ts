// TOPTIER Payment Initialization API
// Starts a payment flow with the selected provider

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, authenticateRequest, successResponse, errorResponse } from '@/lib/auth'
import { initializePayment, type PaymentProvider, type PlanType } from '@/lib/payments/registry'
import { generateBankReference } from '@/lib/payments/bank'
import { getExchangeRate } from '@/lib/payments/exchange-rates'
import { countryNameToCode } from '@/lib/countries'
import { PAYMENTS_ENABLED } from '@/lib/flags'
import { validateBody, paymentInitSchema } from '@/lib/validation'
import { getAllBalances, withdrawCash, CASH_ASSETS } from '@/lib/services/wallet'
import { fulfillPendingPayment } from '@/lib/payments/fulfillment'

const PLANS: Record<string, { price: number; currency: string }> = {
  trial: { price: 0, currency: 'USD' },
  premium_daily: { price: 1.5, currency: 'USD' },
  premium_weekly: { price: 7, currency: 'USD' },
  premium_quarterly: { price: 75, currency: 'USD' },
  premium_annual: { price: 120, currency: 'USD' },
  lifetime: { price: 499.99, currency: 'USD' },
  signals_monthly: { price: 20, currency: 'USD' },
  bot_quarterly: { price: 100, currency: 'USD' },
  remove_ads: { price: 5, currency: 'USD' },
  mentorship_physical: { price: 150, currency: 'USD' },
  mentorship_online: { price: 100, currency: 'USD' },
  ebook: { price: 1.5, currency: 'USD' },
}

const productLabels: Record<string, string> = {
    trial: 'Trial',
    premium_daily: 'Premium Daily',
    premium_weekly: 'Premium Weekly',
    premium_quarterly: 'Premium Quarterly',
    premium_annual: 'Premium Annual',
    lifetime: 'Lifetime Access',
    signals_monthly: 'Signals (30 days)',
    bot_quarterly: 'Trading Bot (3 months)',
    remove_ads: 'Remove Ads (lifetime)',
    mentorship_physical: '1-on-1 Mentorship (in person, 2 months)',
    mentorship_online: '1-on-1 Mentorship (online, 2 months)',
    ebook: 'E-Book',
  }

  function productLabel(planType: string): string {
    return productLabels[planType] || planType.replace('_', ' ')
  }

// Approximate "1 <asset> = N USD" rates, used only when the live rates API is
// unreachable. Mirrors the KES 153 / USD basis used by the wallet top-up route
// so funding and spending convert at the same fallback rate.
const USD_FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  KES: 1 / 153,
  UGX: 1 / 4371,
  EUR: 1.1,
  GBP: 1.27,
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

    // E-books: the specific title comes from metadata.book (its slug). It must
    // exist and be active; the book id is folded into the transaction
    // description so fulfillment can unlock exactly that title.
    let ebookId: string | null = null
    if (planType === 'ebook') {
      const slug = metadata?.book
      if (!slug) {
        return errorResponse('Please select the e-book you want to buy.', 400)
      }
      const book = await db.eBook.findUnique({
        where: { slug },
        select: { id: true, isActive: true },
      })
      if (!book || !book.isActive) {
        return errorResponse('E-book not found or no longer available.', 404)
      }
      ebookId = book.id
    }
    const bookTag = ebookId ? `|book:${ebookId}` : ''

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
        description: `TOPTIER ${productLabel(planType)}${discount > 0 ? ` (discount: $${discount.toFixed(2)})` : ''}${couponUsed ? `|coupon:${couponUsed}` : ''}${bookTag}`,
      },
    })

    // In-app manual methods (bank transfer, Airtel Money, MTN MoMo): no
    // gateway call. Record the intent, mint our order reference, and wait for
    // manual admin confirmation.
    if (provider === 'bank' || provider === 'airtel' || provider === 'mtn') {
      const bankRef = generateBankReference()
      const bank = metadata?.bank || ''
      const userRef = metadata?.reference || ''
      const phone = metadata?.phone || user.phone || ''
      const detailTag = provider === 'bank' ? `bank:${bank}|ref:${userRef}` : `phone:${phone}`
      await db.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          stripeSessionId: bankRef,
          description: `${transaction.description || ''}|${detailTag}`,
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
        payment: {
          provider,
          providerTransactionId: bankRef,
          reference: bankRef,
          status: 'pending',
          metadata: provider === 'bank' ? { bank, reference: userRef } : { phone },
        },
      })
    }

    // Pay from wallet balance — synchronous, no gateway. Charge USD and
    // fulfill the subscription immediately.
    if (provider === 'wallet') {
      // The wallet is multi-currency: a top-up credits the asset the user picked
      // (`WALLET_FUND|${asset}|${amount}`), and PesaPal always bills in KES, so
      // most users end up holding KES. This branch used to read ONLY the USD leg
      // via getBalance(userId, 'USD'), so a user holding KES 150,000 was told
      // "your wallet holds $0.00" and could never spend their own money on a
      // plan. Value the entire cash wallet in USD and debit what is actually held.
      const balances = await getAllBalances(userId)

      const holdings: { asset: string; amount: number; usd: number }[] = []
      for (const asset of CASH_ASSETS) {
        const amount = balances[asset] ?? 0
        if (!(amount > 0)) continue
        const rate = asset === 'USD' ? 1 : await getExchangeRate(asset, 'USD', USD_FALLBACK_RATES[asset] ?? 0)
        if (!(rate > 0)) continue
        holdings.push({ asset, amount, usd: amount * rate })
      }
      // Spend the largest USD holding first so we usually make a single posting.
      holdings.sort((a, b) => b.usd - a.usd)

      const totalUsd = holdings.reduce((sum, h) => sum + h.usd, 0)

      if (totalUsd + 1e-9 < finalAmount) {
        const breakdown = holdings.length
          ? ` (${holdings
              .map(h => `${h.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${h.asset}`)
              .join(' + ')})`
          : ''
        return errorResponse(
          `Insufficient wallet balance. You need $${finalAmount.toFixed(2)} but your wallet holds $${totalUsd.toFixed(2)}${breakdown}. Please top up your wallet or choose another payment method.`,
          400
        )
      }

      // Debit asset by asset until the price is met. Each posting gets its own
      // reference (transaction id + asset) so a retry cannot double-charge, and
      // a plan cheaper than the balance never sweeps up the remainder.
      let remaining = finalAmount
      const debits: { asset: string; amount: number }[] = []
      for (const h of holdings) {
        if (remaining <= 1e-9) break
        const perUnitUsd = h.usd / h.amount
        const usdToSpend = Math.min(h.usd, remaining)
        let assetAmount = usdToSpend / perUnitUsd
        // UGX has no practical minor units; keep whole units there so we never
        // post a fraction the ledger cannot represent.
        assetAmount = h.asset === 'UGX' ? Math.floor(assetAmount) : Math.round(assetAmount * 100) / 100
        if (!(assetAmount > 0)) continue
        assetAmount = Math.min(assetAmount, h.amount)

        await withdrawCash({
          userId,
          asset: h.asset as Parameters<typeof withdrawCash>[0]['asset'],
          amount: assetAmount,
          reference: `${transaction.id}:${h.asset}`,
          memo: `${productLabel(planType)} payment from wallet`,
        })
        debits.push({ asset: h.asset, amount: assetAmount })
        remaining -= assetAmount * perUnitUsd
      }

      const chargedUsd = finalAmount - Math.max(remaining, 0)
      if (debits.length === 0 || chargedUsd + 0.01 < finalAmount) {
        return errorResponse(
          'Could not settle this purchase from your wallet balance. No funds were taken - please try again.',
          400
        )
      }

      await db.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          description: `${transaction.description || ''}|wallet:${debits.map(d => `${d.amount}${d.asset}`).join('+')}`,
        },
      })

      await fulfillPendingPayment({ id: transaction.id }, { provider: 'wallet', paymentMethod: 'wallet' })

      return successResponse({
        requiresPayment: true,
        transaction: {
          id: transaction.id,
          amount: finalAmount,
          currency: 'USD',
          planType,
          originalAmount: plan.price,
          discount,
          status: 'completed',
        },
        payment: {
          provider: 'wallet',
          providerTransactionId: transaction.id,
          reference: transaction.id,
          status: 'completed',
          metadata: {
            method: 'wallet',
            debits,
            chargedUsd: Number(chargedUsd.toFixed(2)),
          },
        },
      })
    }

    // Initialize payment with the selected provider — except wallet, which is
    // fulfilled synchronously below (no external gateway involved).
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
