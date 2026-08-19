// RevenueCat Payment Gateway Integration for TOPTIER
// Handles in-app purchases for iOS App Store and Google Play Store

import type { PaymentGateway, InitPaymentParams, InitPaymentResult, VerifyPaymentParams, VerifyPaymentResult, RefundParams, RefundResult } from './types'

const REVENUECAT_BASE_URL = 'https://api.revenuecat.com/v1'

async function revenuecatRequest(endpoint: string, method: string = 'GET', body?: Record<string, unknown>, platform: 'ios' | 'android' = 'android') {
  const apiKey = process.env.REVENUECAT_SECRET_KEY
  if (!apiKey) throw new Error('REVENUECAT_SECRET_KEY is not configured')

  const response = await fetch(`${REVENUECAT_BASE_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Platform': platform,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  return await response.json()
}

// Map our plan types to RevenueCat entitlements / offerings
function getRevenueCatProductId(planType: string, platform: 'ios' | 'android'): string {
  const productMap: Record<string, Record<string, string>> = {
    premium_monthly: {
      ios: process.env.REVENUECAT_IOS_MONTHLY || 'toptier_premium_monthly',
      android: process.env.REVENUECAT_ANDROID_MONTHLY || 'toptier_premium_monthly',
    },
    premium_annual: {
      ios: process.env.REVENUECAT_IOS_ANNUAL || 'toptier_premium_annual',
      android: process.env.REVENUECAT_ANDROID_ANNUAL || 'toptier_premium_annual',
    },
    lifetime: {
      ios: process.env.REVENUECAT_IOS_LIFETIME || 'toptier_lifetime',
      android: process.env.REVENUECAT_ANDROID_LIFETIME || 'toptier_lifetime',
    },
  }
  return productMap[planType]?.[platform] || ''
}

export const revenuecatGateway: PaymentGateway = {
  provider: 'revenuecat',
  name: 'revenuecat',
  displayName: 'In-App Purchase',
  icon: 'shopping-bag',
  supportedCurrencies: [], // Handles all currencies via app stores
  supportedCountries: [], // Global - whatever the app store supports
  description: 'Subscribe via App Store or Google Play Store',

  async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    const platform = (params.metadata?.platform || 'android') as 'ios' | 'android'
    const productId = getRevenueCatProductId(params.planType, platform)

    // Get or create the customer in RevenueCat
    const customer = await revenuecatRequest(`/subscribers/${params.userId}`, 'GET', undefined, platform)

    // RevenueCat doesn't create a "checkout session" like other gateways.
    // Instead, the mobile app initiates the purchase through the native store,
    // and then we tell RevenueCat about the receipt.
    // This endpoint returns the offerings/products available to the user.
    return {
      provider: 'revenuecat',
      providerTransactionId: `RC_${params.userId}_${Date.now()}`,
      reference: productId,
      status: 'pending',
      metadata: {
        productId,
        platform,
        subscriberId: params.userId,
        offerings: JSON.stringify(customer.subscriber?.entitlements || {}),
      },
    }
  },

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    // In RevenueCat, verification is done via receipt posting
    // The mobile app sends the store receipt, and RevenueCat validates it
    const userId = params.metadata?.userId
    if (!userId) throw new Error('No userId provided for RevenueCat verification')
    const platform = (params.metadata?.platform || 'android') as 'ios' | 'android'

    const customer = await revenuecatRequest(`/subscribers/${userId}`, 'GET', undefined, platform)

    const entitlements = customer.subscriber?.entitlements || {}
    const hasPremium = Object.keys(entitlements).some(key =>
      key.includes('premium') || key.includes('lifetime')
    )

    const activeEntitlement = hasPremium ?
      (Object.values(entitlements) as Array<Record<string, unknown>>).find(e =>
        e.expires_date && new Date(e.expires_date as string) > new Date()
      ) || Object.values(entitlements)[0] : null

    return {
      status: hasPremium ? 'completed' : 'pending',
      amount: 0, // RevenueCat doesn't expose pricing directly
      currency: 'USD',
      planType: (params.metadata?.planType || 'premium_monthly') as InitPaymentParams['planType'],
      providerTransactionId: params.providerTransactionId || `RC_${userId}`,
      metadata: {
        entitlements: JSON.stringify(entitlements),
        isActive: hasPremium.toString(),
      },
    }
  },

  async refundPayment(params: RefundParams): Promise<RefundResult> {
    // RevenueCat handles refunds automatically when Apple/Google processes them
    // We can also use the RevenueCat REST API to revoke entitlements
    const userId = params.metadata?.userId
    if (!userId) throw new Error('No userId provided for RevenueCat refund')
    const platform = (params.metadata?.platform || 'android') as 'ios' | 'android'

    // Delete the subscriber's entitlements
    await revenuecatRequest(`/subscribers/${userId}/entitlements`, 'DELETE', undefined, platform)

    return {
      refundId: `RC_REFUND_${Date.now()}`,
      status: 'completed',
      amount: params.amount || 0,
    }
  },

  getCheckoutConfig(): Record<string, string> {
    return {
      apiKey: process.env.NEXT_PUBLIC_REVENUECAT_PUBLIC_KEY || '',
      iosProductId: process.env.REVENUECAT_IOS_MONTHLY || '',
      androidProductId: process.env.REVENUECAT_ANDROID_MONTHLY || '',
    }
  },
}
