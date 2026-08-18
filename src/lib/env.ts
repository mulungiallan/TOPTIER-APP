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
    return requireEnv('MPESA_PASSKEY')
  },
  get mpesaShortcode(): string | undefined {
    return requireEnv('MPESA_SHORTCODE')
  },
  get mpesaConsumerKey(): string | undefined {
    return requireEnv('MPESA_CONSUMER_KEY')
  },
  get mpesaConsumerSecret(): string | undefined {
    return requireEnv('MPESA_CONSUMER_SECRET')
  },
  get hfToken(): string | undefined {
    return process.env.HF_TOKEN
  },
  get geminiApiKey(): string | undefined {
    return requireEnv('GEMINI_API_KEY')
  },
  get resendApiKey(): string | undefined {
    return requireEnv('RESEND_API_KEY')
  },
  get stripeSecretKey(): string | undefined {
    return requireEnv('STRIPE_SECRET_KEY')
  },
  get stripePriceMonthly(): string | undefined {
    return requireEnv('STRIPE_PRICE_MONTHLY')
  },
  get stripePriceAnnual(): string | undefined {
    return requireEnv('STRIPE_PRICE_ANNUAL')
  },
  get appUrl(): string {
    return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  },
  // ─── Auto-trading bot (MT5/MT4) ─────────────────────────────────────────
  get botServiceUrl(): string {
    return optionalEnv('BOT_SERVICE_URL', 'http://127.0.0.1:8765')
  },
  get botServiceKey(): string {
    return process.env.BOT_SERVICE_KEY || ''
  },
  get botCredentialsSecret(): string | undefined {
    return requireEnv('BOT_CREDENTIALS_SECRET')
  },
}
