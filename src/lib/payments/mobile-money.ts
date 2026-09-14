// In-app "Mobile Money" payment methods for TOPTIER (Airtel Money, MTN MoMo).
//
// Like Bank, these are manual by design: the customer pays from their own
// Airtel Money / MTN MoMo wallet on their phone, then we confirm the funds
// arrive. The transaction stays 'pending' until an admin confirms it (admin
// action `confirm_payment`). No external page is opened and no third-party
// API is required.

import type {
  PaymentGateway,
  InitPaymentParams,
  InitPaymentResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  RefundParams,
  RefundResult,
} from './types'

function generateMobileReference(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix}${Date.now()}${rand}`
}

function makeManualGateway(provider: 'airtel' | 'mtn', displayName: string): PaymentGateway {
  return {
    provider,
    name: provider,
    displayName,
    icon: 'phone',
    supportedCurrencies: [],
    supportedCountries: [],
    description: `Pay with ${displayName} on your phone, then we confirm once your payment arrives.`,

    async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
      return {
        provider,
        providerTransactionId: generateMobileReference(provider.toUpperCase()),
        reference: generateMobileReference(provider.toUpperCase()),
        status: 'pending',
        metadata: params.metadata,
      }
    },

    async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
      return {
        status: 'pending', // manual — admin confirms when funds arrive
        amount: 0,
        currency: 'KES',
        planType: (params.metadata?.planType as InitPaymentParams['planType']) || 'premium_monthly',
        providerTransactionId: params.providerTransactionId || params.reference || '',
      }
    },

    async refundPayment(params: RefundParams): Promise<RefundResult> {
      return {
        refundId: `${provider.toUpperCase()}_REFUND_${Date.now()}`,
        status: 'pending' as const,
        amount: params.amount || 0,
      }
    },

    getCheckoutConfig(): Record<string, string> {
      return {
        method: 'mobile',
        network: displayName,
      }
    },
  }
}

export const airtelGateway: PaymentGateway = makeManualGateway('airtel', 'Airtel Money')
export const mtnGateway: PaymentGateway = makeManualGateway('mtn', 'MTN MoMo')