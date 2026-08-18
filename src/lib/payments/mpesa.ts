// M-Pesa (Daraja API) Payment Gateway Integration for TOPTIER
// Supports: M-Pesa STK Push (Lipa Na M-Pesa Online) - Kenya

import type { PaymentGateway, InitPaymentParams, InitPaymentResult, VerifyPaymentParams, VerifyPaymentResult, RefundParams, RefundResult } from './types'
import { env } from '@/lib/env'

const MPESA_BASE_URL = process.env.MPESA_ENVIRONMENT === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke'

// Cache the access token (expires every 59 minutes)
let tokenCache: { token: string; expiresAt: number } | null = null

function requireMpesaConfig(): { shortcode: string; passkey: string } {
  const shortcode = env.mpesaShortcode
  const passkey = env.mpesaPasskey
  if (!shortcode || !passkey) {
    throw new Error('MPESA_SHORTCODE and MPESA_PASSKEY must be configured to use M-Pesa payments')
  }
  return { shortcode, passkey }
}

async function getMpesaAccessToken(): Promise<string> {
  const consumerKey = process.env.MPESA_CONSUMER_KEY
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET

  if (!consumerKey || !consumerSecret) {
    throw new Error('MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET are not configured')
  }

  // Use cached token if still valid
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')

  const response = await fetch(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
    },
  })

  const data = await response.json()

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // 1 minute buffer
  }

  return data.access_token
}

// Generate timestamp in the format YYYYMMDDHHmmss
function getTimestamp(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  const second = String(now.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}${hour}${minute}${second}`
}

// Generate password (Base64 of Shortcode + Passkey + Timestamp)
function generatePassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64')
}

export const mpesaGateway: PaymentGateway = {
  provider: 'mpesa',
  name: 'mpesa',
  displayName: 'M-Pesa',
  icon: 'phone',
  supportedCurrencies: ['KES'],
  supportedCountries: ['KE'],
  description: 'Pay with M-Pesa (Lipa Na M-Pesa Online) - Kenya',

  async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    const accessToken = await getMpesaAccessToken()
    const { shortcode, passkey } = requireMpesaConfig()
    const timestamp = getTimestamp()
    const password = generatePassword(shortcode, passkey, timestamp)

    // M-Pesa requires amount in KES. Convert if needed
    let amountKES = params.amount
    if (params.currency === 'USD') {
      amountKES = Math.round(params.amount * 153) // Approximate USD to KES rate
    }

    // Generate a unique reference
    const reference = `TOPTIER${Date.now()}`
    const transactionDesc = `TOPTIER ${params.planType.replace('_', ' ')}`

    const response = await fetch(`${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amountKES,
        PartyA: params.metadata?.phone || '', // Phone number sending money
        PartyB: shortcode,
        PhoneNumber: params.metadata?.phone || '',
        CallBackURL: `${env.appUrl}/api/payments/mpesa/callback`,
        AccountReference: reference,
        TransactionDesc: transactionDesc,
      }),
    })

    const data = await response.json()

    if (data.ResponseCode !== '0') {
      throw new Error(data.ResponseDescription || 'M-Pesa STK Push failed')
    }

    return {
      provider: 'mpesa',
      providerTransactionId: data.CheckoutRequestID,
      reference: data.MerchantRequestID,
      status: 'processing', // M-Pesa is async - user gets an STK push on their phone
    }
  },

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const accessToken = await getMpesaAccessToken()
    const { shortcode, passkey } = requireMpesaConfig()
    const timestamp = getTimestamp()
    const password = generatePassword(shortcode, passkey, timestamp)

    const checkoutRequestId = params.providerTransactionId || params.reference

    if (!checkoutRequestId) {
      throw new Error('No CheckoutRequestID provided for M-Pesa verification')
    }

    const response = await fetch(`${MPESA_BASE_URL}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
    })

    const data = await response.json()

    const resultCode = data.ResultCode
    const planType = (params.metadata?.planType || 'premium_monthly') as InitPaymentParams['planType']

    return {
      status: resultCode === '0' ? 'completed' :
              resultCode === '1032' ? 'cancelled' : // User cancelled
              resultCode === '1037' ? 'pending' : // Timeout, still processing
              'failed',
      amount: 0, // Amount comes from callback, not query
      currency: 'KES',
      planType,
      providerTransactionId: checkoutRequestId,
      metadata: { resultCode: resultCode?.toString(), resultDesc: data.ResultDesc },
    }
  },

  async refundPayment(params: RefundParams): Promise<RefundResult> {
    // M-Pesa doesn't have a direct refund API - typically handled manually or via B2C
    // For now, we record the refund request
    return {
      refundId: `MPESA_REFUND_${Date.now()}`,
      status: 'pending' as const,
      amount: params.amount || 0,
    }
  },

  getCheckoutConfig(): Record<string, string> {
    return {
      shortcode: process.env.MPESA_SHORTCODE || '',
      environment: process.env.MPESA_ENVIRONMENT || 'sandbox',
    }
  },}
