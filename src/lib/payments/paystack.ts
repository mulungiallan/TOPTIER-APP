// Paystack Payment Gateway Integration for TOPTIER
// Supports: Cards, Bank Transfer, Mobile Money, USSD (Nigeria, Ghana, South Africa)

import type { PaymentGateway, InitPaymentParams, InitPaymentResult, VerifyPaymentParams, VerifyPaymentResult, RefundParams, RefundResult } from './types'

const PAYSTACK_BASE_URL = 'https://api.paystack.co'

async function paystackRequest(endpoint: string, method: string = 'POST', body?: Record<string, unknown>) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) throw new Error('PAYSTACK_SECRET_KEY is not configured')

  const response = await fetch(`${PAYSTACK_BASE_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await response.json()
  if (!data.status) {
    throw new Error(data.message || 'Paystack API error')
  }
  return data
}

export const paystackGateway: PaymentGateway = {
  provider: 'paystack',
  name: 'paystack',
  displayName: 'Paystack',
  icon: 'building',
  supportedCurrencies: ['NGN', 'GHS', 'ZAR', 'USD'],
  supportedCountries: ['NG', 'GH', 'ZA'],
  description: 'Pay with Card, Bank Transfer, USSD, or Mobile Money (Nigeria, Ghana, South Africa)',

  async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    const reference = `TPT_${params.planType}_${params.userId}_${Date.now()}`

    const planNames: Record<string, string> = {
      trial: 'TOPTIER 7-Day Trial',
      premium_monthly: 'TOPTIER Premium Monthly',
      premium_annual: 'TOPTIER Premium Annual',
      lifetime: 'TOPTIER Lifetime Access',
    }

    const response = await paystackRequest('/transaction/initialize', 'POST', {
      email: params.userEmail,
      amount: Math.round(params.amount * 100), // Paystack uses kobo/cents
      currency: params.currency,
      reference,
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/payments/paystack/callback`,
      plan: undefined, // Could link to Paystack Plan ID for recurring
      metadata: {
        userId: params.userId,
        planType: params.planType,
        custom_fields: [
          {
            display_name: 'Plan',
            variable_name: 'plan',
            value: planNames[params.planType] || params.planType,
          },
        ],
      },
      channels: ['card', 'bank', 'ussd', 'mobile_money'],
    })

    return {
      provider: 'paystack',
      providerTransactionId: response.data.reference,
      checkoutUrl: response.data.authorization_url,
      reference: response.data.reference,
      status: 'pending',
    }
  },

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const reference = params.reference || params.providerTransactionId
    if (!reference) throw new Error('No reference provided for Paystack verification')

    const response = await paystackRequest(`/transaction/verify/${reference}`, 'GET')

    const data = response.data
    return {
      status: data.status === 'success' ? 'completed' :
              data.status === 'failed' ? 'failed' : 'pending',
      amount: data.amount / 100,
      currency: data.currency,
      planType: (data.metadata?.planType || 'premium_monthly') as InitPaymentParams['planType'],
      providerTransactionId: data.reference,
      metadata: data.metadata,
    }
  },

  async refundPayment(params: RefundParams): Promise<RefundResult> {
    const response = await paystackRequest('/refund', 'POST', {
      transaction: params.providerTransactionId,
      amount: params.amount ? Math.round(params.amount * 100) : undefined,
      reason: params.reason || 'Customer requested refund',
    })

    return {
      refundId: response.data.id?.toString() || 'unknown',
      status: response.data.status === 'processed' ? 'completed' : 'pending',
      amount: (response.data.amount || 0) / 100,
    }
  },

  getCheckoutConfig(): Record<string, string> {
    return {
      publicKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '',
    }
  },
}
