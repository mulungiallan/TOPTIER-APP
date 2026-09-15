// NOWPayments crypto payments client for TOPTIER wallet deposits.
//
// Flow (per NOWPayments API docs):
//   1. POST /v1/payment  -> a per-payment deposit address is minted
//   2. The customer sends the asset to that address
//   3. NOWPayments POSTs an IPN (Instant Payment Notification) to the
//      ipn_callback_url whenever payment_status changes. The body is signed:
//      sort the JSON object keys alphabetically, JSON.stringify it, then
//      HMAC-SHA512 with the IPN secret; the digest is sent in the request
//      header `x-nowpayments-sig`.
//   4. Status can also be polled with GET /v1/payment/{payment_id} as a
//      fallback for a missed webhook.
//
// The wallet is only credited on `finished`, keyed idempotently by
// `nowpayments_<payment_id>` (see src/lib/services/crypto-deposits.ts).

import { createHmac, timingSafeEqual } from 'crypto'
import { env } from '@/lib/env'

const NOWPAYMENTS_API_URL = process.env.NOWPAYMENTS_API_URL || 'https://api.nowpayments.io/v1'

// A foreseeable, low-friction currency ticket per supported asset. USDT is
// received on TRON (TRC-20); the other assets use their native networks.
const CURRENCY_TICKETS: Record<string, string> = {
  BTC: 'btc',
  ETH: 'eth',
  USDT: 'usdttrc20',
  SOL: 'sol',
}

export interface NowpaymentsPayment {
  paymentId: string
  paymentStatus: string
  payAddress: string
  payAmount: number | null
  payCurrency: string
  priceAmount: number
  priceCurrency: string
  actuallyPaid: number | null
}

export function toNowpaymentsCurrency(asset: string): string {
  return CURRENCY_TICKETS[asset] || asset.toLowerCase()
}

/**
 * Crypto deposits are available only when both credentials exist — the API key
 * creates payments and the IPN secret is what lets us trust confirmation
 * webhooks (polling alone cannot be relied on for real money).
 */
export function nowpaymentsConfigured(): boolean {
  return Boolean(env.nowpaymentsApiKey && env.nowpaymentsIpnSecret)
}

function apiKey(): string {
  const key = env.nowpaymentsApiKey
  if (!key) throw new Error('NOWPAYMENTS_API_KEY is not configured')
  return key
}

async function request<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const response = await fetch(`${NOWPAYMENTS_API_URL}${path}`, {
    ...init,
    headers: {
      'x-api-key': apiKey(),
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  const data = (await response.json().catch(() => ({}))) as T
  return { ok: response.ok, status: response.status, data }
}

/**
 * Minimum payment for an asset pair. When we cannot resolve it (misconfigured
 * account, sandbox, provider hiccup) we return 0 so deposits are not blocked on
 * a value we can't be sure about.
 */
export async function getMinAmount(asset: string): Promise<number> {
  try {
    const currency = toNowpaymentsCurrency(asset)
    const { ok, data } = await request<{ min_amount?: number }>(
      `/min-amount?currency_from=${encodeURIComponent(currency)}&currency_to=${encodeURIComponent(currency)}`
    )
    if (!ok) return 0
    const min = Number(data.min_amount)
    return Number.isFinite(min) && min > 0 ? min : 0
  } catch {
    return 0
  }
}

export async function createCryptoPayment(opts: {
  asset: string
  amount: number
  orderId: string
  ipnCallbackUrl: string
}): Promise<NowpaymentsPayment> {
  const currency = toNowpaymentsCurrency(opts.asset)
  const { ok, status, data } = await request<Record<string, unknown>>('/payment', {
    method: 'POST',
    body: JSON.stringify({
      price_amount: opts.amount,
      price_currency: currency,
      pay_currency: currency,
      order_id: opts.orderId,
      order_description: `TOPTIER wallet crypto deposit (${opts.asset})`,
      ipn_callback_url: opts.ipnCallbackUrl,
    }),
  })

  if (!ok) {
    const message =
      (data.message as string) ||
      (data.error as string) ||
      (data.status as string) ||
      (Array.isArray(data.errors) ? (data.errors as string[]).join(', ') : '') ||
      `NOWPayments create payment failed (HTTP ${status})`
    throw new Error(`NOWPayments: ${message}`)
  }

  if (!data.payment_id || !data.pay_address) {
    throw new Error('NOWPayments did not return a deposit address')
  }

  return {
    paymentId: String(data.payment_id),
    paymentStatus: String(data.payment_status || 'waiting'),
    payAddress: String(data.pay_address),
    payAmount: data.pay_amount != null ? Number(data.pay_amount) : null,
    payCurrency: String(data.pay_currency || currency),
    priceAmount: data.price_amount != null ? Number(data.price_amount) : opts.amount,
    priceCurrency: String(data.price_currency || currency),
    actuallyPaid: data.actually_paid != null ? Number(data.actually_paid) : null,
  }
}

export async function getPaymentStatus(paymentId: string): Promise<NowpaymentsPayment | null> {
  const { ok, data } = await request<Record<string, unknown>>(`/payment/${encodeURIComponent(paymentId)}`)
  if (!ok || !data.payment_id) return null
  return {
    paymentId: String(data.payment_id),
    paymentStatus: String(data.payment_status || 'waiting'),
    payAddress: String(data.pay_address || ''),
    payAmount: data.pay_amount != null ? Number(data.pay_amount) : null,
    payCurrency: String(data.pay_currency || ''),
    priceAmount: data.price_amount != null ? Number(data.price_amount) : 0,
    priceCurrency: String(data.price_currency || ''),
    actuallyPaid: data.actually_paid != null ? Number(data.actually_paid) : null,
  }
}

function sortObjectKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = value[key]
      return acc
    }, {})
}

/**
 * Verify a NOWPayments IPN signature. The canonical algorithm signs
 * JSON.stringify of the body with its top-level keys sorted alphabetically,
 * using HMAC-SHA512 and the IPN secret, hex-encoded, compared in constant time.
 */
export function verifyIpnSignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature || !rawBody || !secret) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false

  const sorted = sortObjectKeys(parsed as Record<string, unknown>)
  const expected = createHmac('sha512', secret).update(JSON.stringify(sorted)).digest('hex')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const receivedBuffer = Buffer.from(signature, 'utf8')
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}