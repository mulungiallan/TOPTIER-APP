// TOPTIER Payment Gateway Registry
// Central hub that manages all payment providers

import type { PaymentProvider, PaymentProviderInfo, PaymentGateway, InitPaymentParams, InitPaymentResult, VerifyPaymentParams, VerifyPaymentResult, RefundParams, RefundResult } from './types'
import { stripeGateway } from './stripe'
import { flutterwaveGateway } from './flutterwave'
import { mpesaGateway } from './mpesa'
import { paystackGateway } from './paystack'
import { paypalGateway } from './paypal'
import { revenuecatGateway } from './revenuecat'

// All registered gateways
const gateways: Record<PaymentProvider, PaymentGateway> = {
  stripe: stripeGateway,
  flutterwave: flutterwaveGateway,
  mpesa: mpesaGateway,
  paystack: paystackGateway,
  paypal: paypalGateway,
  revenuecat: revenuecatGateway,
}

// Check if a provider's environment variables are configured
function isProviderConfigured(provider: PaymentProvider): boolean {
  const envChecks: Record<PaymentProvider, string[]> = {
    stripe: ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
    flutterwave: ['FLUTTERWAVE_SECRET_KEY', 'NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY'],
    mpesa: ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE'],
    paystack: ['PAYSTACK_SECRET_KEY', 'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY'],
    paypal: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'NEXT_PUBLIC_PAYPAL_CLIENT_ID'],
    revenuecat: ['REVENUECAT_SECRET_KEY', 'NEXT_PUBLIC_REVENUECAT_PUBLIC_KEY'],
  }

  const required = envChecks[provider] || []
  return required.every(key => !!process.env[key])
}

// Get list of all available providers (for UI display)
export function getAvailableProviders(): PaymentProviderInfo[] {
  return Object.values(gateways).map(gw => ({
    id: gw.provider,
    name: gw.displayName,
    icon: gw.icon,
    description: gw.description,
    supportedCurrencies: gw.supportedCurrencies,
    supportedCountries: gw.supportedCountries,
    isAvailable: isProviderConfigured(gw.provider),
  }))
}

// Get a specific gateway instance
export function getGateway(provider: PaymentProvider): PaymentGateway {
  const gw = gateways[provider]
  if (!gw) throw new Error(`Unknown payment provider: ${provider}`)
  return gw
}

// Initialize a payment with any provider
export async function initializePayment(
  provider: PaymentProvider,
  params: InitPaymentParams
): Promise<InitPaymentResult> {
  const gateway = getGateway(provider)
  return gateway.initializePayment(params)
}

// Verify a payment with any provider
export async function verifyPayment(
  provider: PaymentProvider,
  params: VerifyPaymentParams
): Promise<VerifyPaymentResult> {
  const gateway = getGateway(provider)
  return gateway.verifyPayment(params)
}

// Process a refund with any provider
export async function refundPayment(
  provider: PaymentProvider,
  params: RefundParams
): Promise<RefundResult> {
  const gateway = getGateway(provider)
  return gateway.refundPayment(params)
}

// Get provider-specific checkout configuration for the frontend
export function getCheckoutConfig(provider: PaymentProvider): Record<string, string> {
  const gateway = getGateway(provider)
  return gateway.getCheckoutConfig()
}

// Re-export types
export type { PaymentProvider, PaymentProviderInfo, PaymentGateway, InitPaymentParams, InitPaymentResult, VerifyPaymentParams, VerifyPaymentResult, RefundParams, RefundResult, PaymentPlan, PaymentStatus, PlanType } from './types'
