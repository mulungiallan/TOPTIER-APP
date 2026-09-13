// PesaPal (API v3 / JSON) Payment Gateway Integration for TOPTIER
// Follows the PesaPal API 3.0 flow described in the PesaPal Developer Community
// integration overview and the sample files in PesapalAPI-Files:
//   1. Authenticate  -> POST /api/Auth/RequestToken          (token cached)
//   2. Register IPN  -> POST /api/URLSetup/RegisterIPN       (url -> ipn_id)
//   3. Submit order  -> POST /api/Transactions/SubmitOrderRequest -> redirect_url
//   4. Redirect the customer to the PesaPal hosted payment page
//   5. Check status  -> GET /api/Transactions/GetTransactionStatus?orderTrackingId=...
//   6. IPN webhook   -> /api/payments/pesapal/ipn (status-change notifications)

import type {
  PaymentGateway,
  InitPaymentParams,
  InitPaymentResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  RefundParams,
  RefundResult,
} from './types'
import { env } from '@/lib/env'

const PESAPAL_BASE_URL =
  process.env.PESAPAL_ENVIRONMENT === 'production'
    ? 'https://pay.pesapal.com/v3'
    : 'https://cybqa.pesapal.com/pesapalv3'

// Cache the bearer access token (only valid for a limited window)
let tokenCache: { token: string; expiresAt: number } | null = null
// Cache the registered IPN id so we don't re-register the URL on every order
let ipnCache: { url: string; ipnId: string } | null = null

function requirePesapalCredentials(): { consumerKey: string; consumerSecret: string } {
  const consumerKey = process.env.PESAPAL_CONSUMER_KEY
  const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET
  if (!consumerKey || !consumerSecret) {
    throw new Error('PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET must be configured to use PesaPal payments')
  }
  return { consumerKey, consumerSecret }
}

async function getPesapalToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token
  }

  const { consumerKey, consumerSecret } = requirePesapalCredentials()

  const response = await fetch(`${PESAPAL_BASE_URL}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ consumer_key: consumerKey, consumer_secret: consumerSecret }),
  })

  if (!response.ok) {
    throw new Error(`PesaPal authentication failed (HTTP ${response.status})`)
  }

  const data = await response.json()
  if (!data.token) {
    throw new Error('PesaPal did not return an access token')
  }

  // PesaPal returns expiryDate in UTC; keep a 1-minute safety buffer.
  const expiresAt = data.expiryDate
    ? new Date(data.expiryDate).getTime() - 60 * 1000
    : Date.now() + 59 * 60 * 1000
  tokenCache = { token: data.token, expiresAt }

  return data.token
}

/**
 * Resolve the IPN notification id for this app's webhook URL. Reuses an
 * existing registration when present, otherwise registers a new one.
 */
async function getPesapalIpnId(): Promise<string> {
  const url = `${env.appUrl}/api/payments/pesapal/ipn`
  if (ipnCache?.url === url) {
    return ipnCache.ipnId
  }

  const token = await getPesapalToken()
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  }

  // Reuse an already-registered IPN for this exact URL if one exists.
  try {
    const listRes = await fetch(`${PESAPAL_BASE_URL}/api/URLSetup/GetIpnList`, {
      method: 'GET',
      headers,
    })
    if (listRes.ok) {
      const list = await listRes.json()
      const existing = (list || []).find((ipn: { url?: string; ipn_id?: string }) => ipn.url === url)
      if (existing?.ipn_id) {
        ipnCache = { url, ipnId: existing.ipn_id }
        return existing.ipn_id
      }
    }
  } catch {
    // Registration below will surface any real problem.
  }

  const res = await fetch(`${PESAPAL_BASE_URL}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url, ipn_notification_type: 'POST' }),
  })

  if (!res.ok) {
    throw new Error(`PesaPal IPN registration failed (HTTP ${res.status})`)
  }

  const data = await res.json()
  if (!data.ipn_id) {
    throw new Error('PesaPal did not return an ipn_id for the registered IPN URL')
  }

  ipnCache = { url, ipnId: data.ipn_id }
  return data.ipn_id
}

function splitName(name: string): { first: string; last: string } {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  return {
    first: parts[0] || 'Valued',
    last: parts.slice(1).join(' ') || 'Customer',
  }
}

export const pesapalGateway: PaymentGateway = {
  provider: 'pesapal',
  name: 'pesapal',
  displayName: 'PesaPal',
  icon: 'building',
  supportedCurrencies: ['KES'],
  supportedCountries: ['KE'],
  description: 'Pay with PesaPal (M-Pesa, cards, Airtel Money) - Kenya',

  async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    const token = await getPesapalToken()
    const notificationId = await getPesapalIpnId()
    const { first, last } = splitName(params.userName)

    // PesaPal merchant reference: alphanumeric + -, _, ., : only (max 50 chars).
    const merchantReference = `TOPTIER-${params.metadata?.transactionId || Date.now()}`

    const callbackUrl = `${env.appUrl}/api/payments/pesapal/callback`

    const response = await fetch(`${PESAPAL_BASE_URL}/api/Transactions/SubmitOrderRequest`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: merchantReference,
        currency: params.currency,
        amount: params.amount,
        description: (params.metadata?.description || `TOPTIER ${params.planType.replace('_', ' ')} subscription`).slice(0, 100),
        callback_url: callbackUrl,
        cancellation_url: callbackUrl,
        notification_id: notificationId,
        branch: 'BAGMUL ENTERPRISES',
        billing_address: {
          email_address: params.userEmail,
          phone_number: params.metadata?.phone || '',
          country_code: params.metadata?.country || 'KE',
          first_name: first,
          last_name: last,
          line_1: '',
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`PesaPal order submission failed (HTTP ${response.status})`)
    }

    const data = await response.json()
    if (!data.redirect_url) {
      throw new Error(data.message || data.error_message || 'PesaPal did not return a redirect URL')
    }

    return {
      provider: 'pesapal',
      providerTransactionId: data.order_tracking_id,
      reference: data.merchant_reference || merchantReference,
      checkoutUrl: data.redirect_url,
      status: 'pending',
      metadata: { merchant_reference: merchantReference, notification_id: notificationId },
    }
  },

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const token = await getPesapalToken()
    const orderTrackingId = params.providerTransactionId

    if (!orderTrackingId) {
      throw new Error('No orderTrackingId provided for PesaPal verification')
    }

    const response = await fetch(
      `${PESAPAL_BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`PesaPal status query failed (HTTP ${response.status})`)
    }

    const data = await response.json()

    // Map PesaPal's status_code (0=INVALID, 1=COMPLETED, 2=FAILED, 3=REVERSED)
    // and/or payment_status_description onto our generic PaymentStatus.
    const code = Number(data.status_code)
    const desc = (data.payment_status_description || '').toUpperCase()
    const status =
      code === 1 || desc === 'COMPLETED'
        ? 'completed'
        : code === 3 || desc === 'REVERSED'
          ? 'refunded'
          : code === 0 || code === 2 || desc === 'INVALID' || desc === 'FAILED'
            ? 'failed'
            : 'pending'

    const planType = (params.metadata?.planType || 'premium_monthly') as InitPaymentParams['planType']

    return {
      status,
      amount: Number(data.amount) || 0,
      currency: data.currency || 'KES',
      planType,
      providerTransactionId: orderTrackingId,
      metadata: {
        merchant_reference: data.merchant_reference || params.reference || '',
        confirmation_code: data.confirmation_code || '',
        payment_method: data.payment_method || '',
        payment_account: data.payment_account || '',
        payment_status_description: data.payment_status_description || '',
      },
    }
  },

  async refundPayment(params: RefundParams): Promise<RefundResult> {
    // PesaPal processes refunds on their side (payment provider dependent).
    // Record the request for manual processing to stay consistent with the
    // other gateway stubs in this codebase.
    return {
      refundId: `PESAPAL_REFUND_${Date.now()}`,
      status: 'pending' as const,
      amount: params.amount || 0,
    }
  },

  getCheckoutConfig(): Record<string, string> {
    return {
      environment: process.env.PESAPAL_ENVIRONMENT || 'sandbox',
      merchant: 'BAGMUL ENTERPRISES',
      ipnUrl: `${env.appUrl}/api/payments/pesapal/ipn`,
    }
  },
}