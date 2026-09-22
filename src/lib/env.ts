// src/lib/env.ts
// Centralized environment-variable access.
//
// All production secrets must be supplied via the environment. This module
// fails loudly in production when a required variable is missing instead of
// silently falling back to a hardcoded value (which was a security hole).

const isProd = process.env.NODE_ENV === 'production'

/**
 * Read an environment variable. In production, a missing required variable
 * throws an error so misconfiguration is caught at boot instead of at runtime.
 * In development, undefined is returned and callers degrade gracefully.
 */
export function requireEnv(name: string): string | undefined {
  const value = process.env[name]
  if (isProd && !value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

/** Read an optional environment variable with a default fallback. */
export function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback
}

// ─── Named accessors ─────────────────────────────────────────────────────────

export const env = {
  get jwtSecret(): string | undefined {
    return process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET
  },
  // Optional: Finnhub augments Yahoo data. Absent → Yahoo-only fallback.
  get finnhubApiKey(): string | undefined {
    return process.env.FINNHUB_API_KEY
  },
  get mpesaPasskey(): string | undefined {
    return process.env.MPESA_PASSKEY
  },
  get mpesaShortcode(): string | undefined {
    return process.env.MPESA_SHORTCODE
  },
  get mpesaConsumerKey(): string | undefined {
    return process.env.MPESA_CONSUMER_KEY
  },
  get mpesaConsumerSecret(): string | undefined {
    return process.env.MPESA_CONSUMER_SECRET
  },
  // ─── M-Pesa B2C (Daraja disbursements, KES payouts) ──────────────────────
  // The B2C product needs its own InitiatorName + SecurityCredential (RSA-
  // encrypted initiator password, generated once with Safaricom's utility)
  // plus a B2C-approved shortcode. Consumer key/secret are shared with STK.
  get mpesaB2cInitiator(): string | undefined {
    return process.env.MPESA_B2C_INITIATOR
  },
  get mpesaB2cSecurityCredential(): string | undefined {
    return process.env.MPESA_B2C_SECURITY_CREDENTIAL
  },
  get mpesaB2cShortcode(): string | undefined {
    return process.env.MPESA_B2C_SHORTCODE || process.env.MPESA_SHORTCODE
  },
  get mpesaB2cCommandId(): string {
    return process.env.MPESA_B2C_COMMAND_ID || 'BusinessPayment'
  },
  get mpesaB2cMin(): number {
    return Number(process.env.MPESA_B2C_MIN ?? 50)
  },
  get mpesaB2cMax(): number {
    return Number(process.env.MPESA_B2C_MAX ?? 150000)
  },
  get mpesaB2cResultUrl(): string {
    return process.env.MPESA_B2C_RESULT_URL || `${this.appUrl}/api/payments/mpesa/b2c-callback`
  },
  get mpesaB2cTimeoutUrl(): string {
    return process.env.MPESA_B2C_TIMEOUT_URL || `${this.appUrl}/api/payments/mpesa/b2c-callback`
  },
  // ─── MTN MoMo Disbursement (Uganda, UGX payouts) ─────────────────────────
  get momoApiUser(): string | undefined {
    return process.env.MTN_MOMO_API_USER
  },
  get momoApiKey(): string | undefined {
    return process.env.MTN_MOMO_API_KEY
  },
  get momoSubscriptionKey(): string | undefined {
    return process.env.MTN_MOMO_SUBSCRIPTION_KEY
  },
  get momoTargetEnv(): string {
    return process.env.MTN_MOMO_TARGET_ENV || 'sandbox'
  },
  get momoBaseUrl(): string {
    return (
      process.env.MTN_MOMO_BASE_URL ||
      (this.momoTargetEnv === 'sandbox' ? 'https://sandbox.momodeveloper.mtn.com' : 'https://api.mtn.com')
    )
  },
  get momoCurrency(): string {
    return process.env.MTN_MOMO_CURRENCY || 'UGX'
  },
  get momoMin(): number {
    return Number(process.env.MTN_MOMO_MIN ?? 1000)
  },
  get momoMax(): number {
    return Number(process.env.MTN_MOMO_MAX ?? 2000000)
  },
  get pesapalConsumerKey(): string | undefined {
    return process.env.PESAPAL_CONSUMER_KEY
  },
  get pesapalConsumerSecret(): string | undefined {
    return process.env.PESAPAL_CONSUMER_SECRET
  },
  // ─── Crypto deposits (NOWPayments) ───────────────────────────────────────
  get nowpaymentsApiKey(): string | undefined {
    return process.env.NOWPAYMENTS_API_KEY
  },
  get nowpaymentsIpnSecret(): string | undefined {
    return process.env.NOWPAYMENTS_IPN_SECRET
  },
  // Where incoming deposits settle: your Binance deposit addresses. When set,
  // every crypto deposit is paid out straight to Binance instead of sitting in
  // a NOWPayments balance.
  get binanceBtcAddress(): string | undefined {
    return process.env.BINANCE_BTC_ADDRESS
  },
  get binanceEthAddress(): string | undefined {
    return process.env.BINANCE_ETH_ADDRESS
  },
  get binanceUsdtAddress(): string | undefined {
    return process.env.BINANCE_USDT_ADDRESS
  },
  get binanceSolAddress(): string | undefined {
    return process.env.BINANCE_SOL_ADDRESS
  },
  // ─── In-app bank / manual payments ───────────────────────────────────────
  get bankAccountName(): string | undefined {
    return process.env.BANK_ACCOUNT_NAME
  },
  get bankAccountNumber(): string | undefined {
    return process.env.BANK_ACCOUNT_NUMBER
  },
  get bankName(): string | undefined {
    return process.env.BANK_NAME
  },
  get bankTillNumber(): string | undefined {
    return process.env.BANK_TILL_NUMBER
  },
  get bankPaymentPhone(): string | undefined {
    return process.env.BANK_PAYMENT_PHONE
  },
  get hfToken(): string | undefined {
    return process.env.HF_TOKEN
  },
  get geminiApiKey(): string | undefined {
    return process.env.GEMINI_API_KEY
  },
  get resendApiKey(): string | undefined {
    return process.env.RESEND_API_KEY
  },
  get stripeSecretKey(): string | undefined {
    return process.env.STRIPE_SECRET_KEY
  },
  get stripePriceMonthly(): string | undefined {
    return process.env.STRIPE_PRICE_MONTHLY
  },
  get stripePriceAnnual(): string | undefined {
    return process.env.STRIPE_PRICE_ANNUAL
  },
  get appUrl(): string {
    const url = process.env.NEXT_PUBLIC_APP_URL
    if (!url && isProd) {
      throw new Error('NEXT_PUBLIC_APP_URL is required in production — payment callbacks and emails will break without it.')
    }
    return url || 'http://localhost:3000'
  },
  // ─── Auto-trading bot (MT5/MT4) ─────────────────────────────────────────
  get botServiceUrl(): string {
    return optionalEnv('BOT_SERVICE_URL', 'http://127.0.0.1:8765')
  },
  get botServiceKey(): string {
    return process.env.BOT_SERVICE_KEY || ''
  },
  get botCredentialsSecret(): string | undefined {
    return process.env.BOT_CREDENTIALS_SECRET
  },
  // ─── Social login (Google / Apple) ─────────────────────────────────────────
  get googleClientId(): string | undefined {
    return process.env.GOOGLE_CLIENT_ID
  },
  get appleClientId(): string | undefined {
    return process.env.APPLE_CLIENT_ID
  },
}
