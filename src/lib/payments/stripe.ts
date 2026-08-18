// Stripe Payment Gateway Integration for TOPTIER
// Supports: Credit/Debit cards, Apple Pay, Google Pay, Bank transfers (135+ countries)

import Stripe from 'stripe'
import type { PaymentGateway, InitPaymentParams, InitPaymentResult, VerifyPaymentParams, VerifyPaymentResult, RefundParams, RefundResult } from './types'

let stripeInstance: Stripe | null = null

function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
    stripeInstance = new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
  }
  return stripeInstance
}

// Map our plan IDs to Stripe Price IDs (configured in Stripe Dashboard)
function getStripePriceId(planType: string): string {
  const priceMap: Record<string, string> = {
    premium_monthly: process.env.STRIPE_PRICE_MONTHLY || '',
    premium_annual: process.env.STRIPE_PRICE_ANNUAL || '',
    lifetime: process.env.STRIPE_PRICE_LIFETIME || '',
  }
  return priceMap[planType] || ''
}

export const stripeGateway: PaymentGateway = {
  provider: 'stripe',
  name: 'stripe',
  displayName: 'Credit / Debit Card',
  icon: 'credit-card',
  supportedCurrencies: ['USD', 'EUR', 'GBP', 'KES', 'NGN', 'ZAR', 'GHS', 'TZS', 'UGX'],
  supportedCountries: [], // Global - supports 135+ countries
  description: 'Pay with Visa, Mastercard, American Express, Apple Pay, or Google Pay',

  async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    const stripe = getStripe()

    // For subscription plans, create a Checkout Session
    if (params.planType === 'premium_monthly' || params.planType === 'premium_annual') {
      const priceId = getStripePriceId(params.planType)
      if (!priceId) {
        throw new Error(
          `Stripe Price ID for "${params.planType}" is not configured. ` +
          `Set STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL in your environment.`
        )
      }

      // Use Stripe Prices (recurring subscriptions)
      const session = await stripe.checkout.sessions.create({
        customer_email: params.userEmail,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/?payment=success&provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/?payment=cancelled&provider=stripe`,
        metadata: {
          userId: params.userId,
          planType: params.planType,
          ...params.metadata,
        },
      })

      return {
        provider: 'stripe',
        providerTransactionId: session.id,
        checkoutUrl: session.url || undefined,
        status: 'pending',
      }
    }

    // One-time payments (lifetime, trial)
    const session = await stripe.checkout.sessions.create({
      customer_email: params.userEmail,
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: params.currency.toLowerCase(),
          product_data: {
            name: `TOPTIER ${params.planType === 'lifetime' ? 'Lifetime Access' : '7-Day Trial'}`,
            description: 'AI-powered trading signals and analysis platform',
          },
          unit_amount: Math.round(params.amount * 100),
        },
        quantity: 1,
      }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/?payment=success&provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/?payment=cancelled&provider=stripe`,
      metadata: {
        userId: params.userId,
        planType: params.planType,
        ...params.metadata,
      },
    })

    return {
      provider: 'stripe',
      providerTransactionId: session.id,
      checkoutUrl: session.url || undefined,
      status: 'pending',
    }
  },

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const stripe = getStripe()
    const sessionId = params.providerTransactionId || params.reference

    if (!sessionId) {
      throw new Error('No session ID provided for Stripe verification')
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId)

    const planType = (session.metadata?.planType || 'premium_monthly') as InitPaymentParams['planType']

    return {
      status: session.payment_status === 'paid' ? 'completed' : 'pending',
      amount: (session.amount_total || 0) / 100,
      currency: (session.currency || 'usd').toUpperCase(),
      planType,
      providerTransactionId: session.id,
      metadata: session.metadata as Record<string, string> | undefined,
    }
  },

  async refundPayment(params: RefundParams): Promise<RefundResult> {
    const stripe = getStripe()

    // Get the payment intent from the session
    const session = await stripe.checkout.sessions.retrieve(params.providerTransactionId)
    const paymentIntentId = session.payment_intent as string

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: params.amount ? Math.round(params.amount * 100) : undefined,
      reason: params.reason === 'duplicate' ? 'duplicate' : 'requested_by_customer',
      metadata: { reason: params.reason || 'Customer requested refund' },
    })

    return {
      refundId: refund.id,
      status: refund.status === 'succeeded' ? 'completed' : 'pending',
      amount: refund.amount / 100,
    }
  },

  getCheckoutConfig(): Record<string, string> {
    return {
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',
    }
  },
}
