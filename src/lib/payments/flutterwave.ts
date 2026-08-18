// Flutterwave Payment Gateway Integration for TOPTIER
// Supports: Mobile Money, Bank Transfer, Cards, USSD (Africa - Nigeria, Kenya, Ghana, SA, Uganda, Tanzania)

import type { PaymentGateway, InitPaymentParams, InitPaymentResult, VerifyPaymentParams, VerifyPaymentResult, RefundParams, RefundResult } from './types'

const FLUTTERWAVE_BASE_URL = 'https://api.flutterwave.com/v3'

async function flutterwaveRequest(endpoint: string, method: string = 'POST', body?: Record<string, unknown>) {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY
  if (!secretKey) throw new Error('FLUTTERWAVE_SECRET_KEY is not configured')

  const response = await fetch(`${FLUTTERWAVE_BASE_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await response.json()
  if (data.status !== 'success') {
    throw new Error(data.message || 'Flutterwave API error')
  }
  return data
}

export const flutterwaveGateway: PaymentGateway = {
  provider: 'flutterwave',
  name: 'flutterwave',
  displayName: 'Flutterwave',
  icon: 'smartphone',
  supportedCurrencies: ['NGN', 'KES', 'GHS', 'ZAR', 'USD', 'TZS', 'UGX', 'RWF', 'XOF'],
  supportedCountries: ['NG', 'KE', 'GH', 'ZA', 'UG', 'TZ', 'RW', 'SN', 'CI'],
  description: 'Pay with Mobile Money, Bank Transfer, USSD, or Card (Africa)',

  async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    const txRef = `TOPTIER_${params.planType}_${params.userId}_${Date.now()}`

    const planNames: Record<string, string> = {
      trial: 'TOPTIER 7-Day Trial',
      premium_monthly: 'TOPTIER Premium Monthly',
      premium_annual: 'TOPTIER Premium Annual',
      lifetime: 'TOPTIER Lifetime Access',
    }

    const response = await flutterwaveRequest('/payments', 'POST', {
      tx_ref: txRef,
      amount: params.amount,
      currency: params.currency,
      redirect_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/payments/flutterwave/callback`,
      customer: {
        email: params.userEmail,
        name: params.userName,
      },
      customizations: {
        title: 'TOPTIER',
        description: planNames[params.planType] || 'TOPTIER Subscription',
        logo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/icons/icon-192x192.png`,
      },
      meta: {
        userId: params.userId,
        planType: params.planType,
        consumer_id: params.userId,
      },
      payment_options: 'card, mobilemoney, ussd, banktransfer',
    })

    return {
      provider: 'flutterwave',
      providerTransactionId: response.data.id?.toString() || txRef,
      checkoutUrl: response.data.link,
      reference: txRef,
      status: 'pending',
    }
  },

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const id = params.providerTransactionId || params.reference
    if (!id) throw new Error('No transaction ID provided for Flutterwave verification')

    const response = await flutterwaveRequest(`/transactions/${id}/verify`, 'GET')

    const data = response.data
    return {
      status: data.status === 'successful' ? 'completed' :
              data.status === 'failed' ? 'failed' : 'pending',
      amount: data.amount,
      currency: data.currency,
      planType: (data.meta?.planType || 'premium_monthly') as InitPaymentParams['planType'],
      providerTransactionId: data.id?.toString() || id,
      metadata: data.meta,
    }
  },

  async refundPayment(params: RefundParams): Promise<RefundResult> {
    const response = await flutterwaveRequest('/refunds', 'POST', {
      transaction_id: parseInt(params.providerTransactionId),
      amount: params.amount,
      reason: params.reason || 'Customer requested refund',
    })

    return {
      refundId: response.data.id?.toString() || 'unknown',
      status: response.data.status === 'completed' ? 'completed' : 'pending',
      amount: response.data.amount || params.amount || 0,
    }
  },

  getCheckoutConfig(): Record<string, string> {
    return {
      publicKey: process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY || '',
    }
  },
}
