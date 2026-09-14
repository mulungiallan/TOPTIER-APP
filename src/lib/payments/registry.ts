// TOPTIER Payment Gateway Registry
// Central hub that manages all payment providers

import type { PaymentProvider, PaymentProviderInfo, PaymentGateway, InitPaymentParams, InitPaymentResult, VerifyPaymentParams, VerifyPaymentResult, RefundParams, RefundResult } from './types'
import { stripeGateway } from './stripe'
import { flutterwaveGateway } from './flutterwave'
import { mpesaGateway } from './mpesa'
import { paystackGateway } from './paystack'
import { paypalGateway } from './paypal'
import { revenuecatGateway } from './revenuecat'
import { pesapalGateway } from './pesapal'
import { bankGateway } from './bank'

// All registered gateways. Card / redirect gateways stay registered so their
// webhooks and callbacks keep working, but they are NOT offered in the app's
// payment chooser (see getAvailableProviders below) — everything is in-app.
const gateways: Record<PaymentProvider, PaymentGateway> = {
  stripe: stripeGateway,
  flutterwave: flutterwaveGateway,
  mpesa: mpesaGateway,
  paystack: paystackGateway,
  paypal: paypalGateway,
  revenuecat: revenuecatGateway,
  pesapal: pesapalGateway,
  bank: bankGateway,
}

// Check if a provider's environment variables are configured
function isProviderConfigured(provider: PaymentProvider): boolean {
  const envChecks: Record<PaymentProvider, string[]> = {
    stripe: ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
    flutterwave: ['FLUTTERWAVE_SECRET_KEY', 'NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY'],
    mpesa: ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY'],
    paystack: ['PAYSTACK_SECRET_KEY', 'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY'],
    paypal: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'NEXT_PUBLIC_PAYPAL_CLIENT_ID'],
    revenuecat: ['REVENUECAT_SECRET_KEY', 'NEXT_PUBLIC_REVENUECAT_PUBLIC_KEY'],
    pesapal: ['PESAPAL_CONSUMER_KEY', 'PESAPAL_CONSUMER_SECRET'],
    bank: ['BANK_ACCOUNT_NAME'],
  }

  const required = envChecks[provider] || []
  return required.every(key => !!process.env[key])
}

// Get list of available providers (for UI display).
//
// Only in-app methods are surfaced here. M-Pesa uses the Daraja STK push
// (the customer approves on their own phone — no redirect) and "Bank" is a
// manual, admin-confirmed transfer to our account details. Redirect gateways
// (Stripe, PesaPal, PayStack, Flutterwave, PayPal) are intentionally not
// exposed to the chooser.
export function getAvailableProviders(): PaymentProviderInfo[] {
  const list: PaymentProviderInfo[] = [
    {
      id: mpesaGateway.provider,
      name: mpesaGateway.displayName,
      icon: mpesaGateway.icon,
      description: 'Lipa Na M-Pesa — enter your phone and approve with your M-Pesa PIN on your phone.',
      supportedCurrencies: mpesaGateway.supportedCurrencies,
      supportedCountries: mpesaGateway.supportedCountries,
      isAvailable: isProviderConfigured(mpesaGateway.provider),
      checkoutConfig: mpesaGateway.getCheckoutConfig(),
    },
    {
      id: bankGateway.provider,
      name: bankGateway.displayName,
      icon: bankGateway.icon,
      description: 'Transfer from any bank, then confirm with your payment reference. Activated once we verify the funds.',
      supportedCurrencies: bankGateway.supportedCurrencies,
      supportedCountries: bankGateway.supportedCountries,
      isAvailable: true,
      checkoutConfig: bankGateway.getCheckoutConfig(),
    },
  ]
  return list
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
