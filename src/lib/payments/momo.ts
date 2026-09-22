// MTN MoMo Disbursement API (Uganda) — automatic UGX payouts to MTN MoMo
// wallets.
//
// MTN's Open API is async-by-design:
//   - POST {base}/disbursement/v1_0/transfer  → 202 Accepted. The result
//     arrives later via the X-Callback-Url POST.../api/payments/momo/callback.
//   - GET  {base}/disbursement/v1_0/transfer/{referenceId}  → poll status.
//
// Credentials come from https://momodeveloper.mtn.com/ (Uganda product):
//   - MTN_MOMO_API_USER / MTN_MOMO_API_KEY             (disbursement API user)
//   - MTN_MOMO_SUBSCRIPTION_KEY                        (Ocp-Apim-Subscription-Key)
//   - MTN_MOMO_TARGET_ENV                             (sandbox | mtnug)
//   - MTN_MOMO_BASE_URL (optional — MTN provides the prod host when provisioning)
//
// The X-Reference-Id must be a fresh UUIDv4 per transfer and is how we match
// callbacks/polls back to a payout, so we persist it as the payout txHash and
// echo our own payout id in `externalId`.

import { env } from '@/lib/env'
import { requireEnv } from '@/lib/env'

let tokenCache: { token: string; expiresAt: number } | null = null

export function momoEnabled(): boolean {
  return Boolean(process.env.MTN_MOMO_API_USER && process.env.MTN_MOMO_API_KEY && process.env.MTN_MOMO_SUBSCRIPTION_KEY)
}

function requireMomoConfig(): { apiUser: string; apiKey: string; subscriptionKey: string } {
  const apiUser = requireEnv('MTN_MOMO_API_USER')
  const apiKey = requireEnv('MTN_MOMO_API_KEY')
  const subscriptionKey = requireEnv('MTN_MOMO_SUBSCRIPTION_KEY')
  if (!apiUser || !apiKey || !subscriptionKey) {
    throw new Error('MTN_MOMO_API_USER, MTN_MOMO_API_KEY and MTN_MOMO_SUBSCRIPTION_KEY must be configured')
  }
  return { apiUser, apiKey, subscriptionKey }
}

async function getMomoAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token

  const { apiUser, apiKey, subscriptionKey } = requireMomoConfig()
  const auth = Buffer.from(`${apiUser}:${apiKey}`).toString('base64')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(`${env.momoBaseUrl}/disbursement/token/`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        refresh_token: '',
        subscription_key: subscriptionKey,
      }),
    })

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok || !data.access_token) {
      throw new Error(`MTN MoMo token request failed (HTTP ${response.status}): ${String(data.error_description || data.message || 'no token')}`)
    }

    const expiresIn = Number(data.expires_in || 3600)
    tokenCache = { token: String(data.access_token), expiresAt: Date.now() + (expiresIn - 90) * 1000 }
    return String(data.access_token)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Normalize a Ugandan phone to the MSISDN form MTN expects ("2567XXXXXXXX").
 * Accepts +256/256/0-prefixed input with 9 local digits. MTN's own API rejects
 * numbers that are not registered MoMo subscribers, so we only validate shape
 * here (country code + length) and let the provider be the authority on
 * registration — a rejected send refunds the reserve safely.
 */
export function normalizeUgMsisdn(input: string): string {
  const digits = String(input || '').replace(/[^0-9]/g, '')
  if (/^256\d{9}$/.test(digits)) return digits
  if (/^0\d{9}$/.test(digits)) return `256${digits.slice(1)}`
  if (/^7\d{8}$/.test(digits)) return `256${digits}`
  return ''
}

export interface MomoTransferResult {
  ok: boolean
  referenceId?: string
  error?: string
}

export async function momoTransfer(opts: {
  phone: string
  amount: number
  externalId: string
  payerMessage: string
  payeeNote: string
}): Promise<MomoTransferResult> {
  if (!momoEnabled()) {
    return { ok: false, error: 'MTN MoMo disbursements are not configured yet. Automatic UGX withdrawals are disabled.' }
  }

  const { subscriptionKey } = requireMomoConfig()
  const referenceId = crypto.randomUUID()
  const amountFixed = Number(opts.amount.toFixed(2))

  try {
    const token = await getMomoAccessToken()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)
    const response = await fetch(`${env.momoBaseUrl}/disbursement/v1_0/transfer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': env.momoTargetEnv,
        'X-Callback-Url': `${env.appUrl}/api/payments/momo/callback`,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        amount: amountFixed,
        currency: env.momoCurrency,
        externalId: opts.externalId,
        payee: { partyIdType: 'MSISDN', partyId: opts.phone },
        payerMessage: opts.payerMessage,
        payeeNote: opts.payeeNote,
      }),
    })
    clearTimeout(timer)

    if (response.status === 202) {
      return { ok: true, referenceId }
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
    const message = String(data.error_description || data.message || data.developerMessage || `HTTP ${response.status}`)
    return { ok: false, error: `MTN MoMo transfer rejected: ${message}` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'MTN MoMo transfer request failed' }
  }
}

export interface MomoTransferStatus {
  status?: string
  financialTransactionId?: string
  externalId?: string
  reasonMessage?: string
  reasonCode?: string
}

export async function momoTransferStatus(referenceId: string): Promise<MomoTransferStatus> {
  const token = await getMomoAccessToken()
  const { subscriptionKey } = requireMomoConfig()

  const response = await fetch(`${env.momoBaseUrl}/disbursement/v1_0/transfer/${encodeURIComponent(referenceId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Target-Environment': env.momoTargetEnv,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`MTN MoMo status query failed (HTTP ${response.status}): ${text.slice(0, 200)}`)
  }

  const data = (await response.json().catch(() => ({}))) as {
    status?: string
    financialTransactionId?: string
    externalId?: string
    reason?: { code?: string; message?: string }
  }

  return {
    status: typeof data.status === 'string' ? data.status : undefined,
    financialTransactionId: typeof data.financialTransactionId === 'string' ? data.financialTransactionId : undefined,
    externalId: typeof data.externalId === 'string' ? data.externalId : undefined,
    reasonCode: data.reason?.code,
    reasonMessage: data.reason?.message,
  }
}