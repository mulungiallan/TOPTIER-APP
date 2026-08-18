// PayPal Payment Gateway Integration for TOPTIER
// Supports: PayPal Balance, Credit/Debit Cards, Bank Accounts (200+ countries)

import type { PaymentGateway, InitPaymentParams, InitPaymentResult, VerifyPaymentParams, VerifyPaymentResult, RefundParams, RefundResult } from './types'

const PAYPAL_BASE_URL = process.env.PAYPAL_ENVIRONMENT === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

// Cache PayPal access token
let paypalTokenCache: { token: string; expiresAt: number } | null = null

async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not configured')
  }

  // Use cached token if valid
  if (paypalTokenCache && Date.now() < paypalTokenCache.expiresAt) {
    return paypalTokenCache.token
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  const data = await response.json()

  if (!data.access_token) {
    throw new Error(data.error_description || 'Failed to obtain PayPal access token')
  }

  paypalTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  }

  return data.access_token
}

async function paypalRequest(endpoint: string, method: string = 'POST', body?: Record<string, unknown>) {
  const token = await getPayPalAccessToken()

  const response = await fetch(`${PAYPAL_BASE_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  return await response.json()
}

export const paypalGateway: PaymentGateway = {
  provider: 'paypal',
  name: 'paypal',
  displayName: 'PayPal',
  icon: 'wallet',
  supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'],
  supportedCountries: [], // Global - 200+ countries
  description: 'Pay with your PayPal account or credit/debit card (Global)',

  async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    const planNames: Record<string, string> = {
      trial: 'TOPTIER 7-Day Trial',
      premium_monthly: 'TOPTIER Premium Monthly',
      premium_annual: 'TOPTIER Premium Annual',
      lifetime: 'TOPTIER Lifetime Access',
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const order = await paypalRequest('/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: `TOPTIER_${params.planType}_${params.userId}`,
        description: planNames[params.planType] || 'TOPTIER Subscription',
        custom_id: JSON.stringify({
          userId: params.userId,
          planType: params.planType,
        }),
        amount: {
          currency_code: params.currency,
          value: params.amount.toFixed(2),
        },
      }],
      application_context: {
        brand_name: 'TOPTIER',
        landing_page: 'LOGIN',
        user_action: 'PAY_NOW',
        return_url: `${appUrl}/api/payments/paypal/callback?success=true`,
        cancel_url: `${appUrl}/api/payments/paypal/callback?success=false`,
      },
    })

    // Extract the approval link
    const approvalLink = order.links?.find((link: { rel: string; href: string }) => link.rel === 'approve')?.href

    return {
      provider: 'paypal',
      providerTransactionId: order.id,
      checkoutUrl: approvalLink,
      checkoutToken: order.id,
      status: 'pending',
    }
  },

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const orderId = params.providerTransactionId || params.reference
    if (!orderId) throw new Error('No order ID provided for PayPal verification')

    // Capture the order to complete payment
    const captured = await paypalRequest(`/v2/checkout/orders/${orderId}/capture`, 'POST')

    const purchaseUnit = captured.purchase_units?.[0]
    let customId: Record<string, string> = {}
    try {
      customId = purchaseUnit?.custom_id ? JSON.parse(purchaseUnit.custom_id) : {}
    } catch {
      // malformed custom_id from PayPal — treat as empty
    }

    return {
      status: captured.status === 'COMPLETED' ? 'completed' :
              captured.status === 'CANCELLED' ? 'cancelled' : 'pending',
      amount: parseFloat(purchaseUnit?.amount?.value || '0'),
      currency: purchaseUnit?.amount?.currency_code || 'USD',
      planType: (customId.planType || 'premium_monthly') as InitPaymentParams['planType'],
      providerTransactionId: captured.id,
      metadata: customId,
    }
  },

  async refundPayment(params: RefundParams): Promise<RefundResult> {
    // PayPal refunds require the capture ID
    const refund = await paypalRequest(`/v2/payments/captures/${params.providerTransactionId}/refund`, 'POST', {
      amount: params.amount ? {
        value: params.amount.toFixed(2),
        currency_code: 'USD',
      } : undefined,
      note: params.reason || 'Customer requested refund',
    })

    return {
      refundId: refund.id || 'unknown',
      status: refund.status === 'COMPLETED' ? 'completed' : 'pending',
      amount: parseFloat(refund.amount?.value || '0'),
    }
  },

  getCheckoutConfig(): Record<string, string> {
    return {
      clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || '',
      environment: process.env.PAYPAL_ENVIRONMENT || 'sandbox',
    }
  },
}
