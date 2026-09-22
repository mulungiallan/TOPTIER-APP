// M-Pesa B2C (Daraja) — automatic KES payouts to M-Pesa phone numbers.
//
// B2C (Business-to-Customer) lets us DISBURSE money to a customer's M-Pesa
// wallet directly. This is the funds-out counterpart to the STK push (funds-in).
//
// Credentials (all M-Pesa production):
//   - MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET (shared with STK)
//   - MPESA_B2C_INITIATOR                 the B2C initiator username
//   - MPESA_B2C_SECURITY_CREDENTIAL       RSA-encrypted initiator password
//                                         (generate once with Safaricom's
//                                         utility; it never becomes plaintext)
//   - MPESA_B2C_SHORTCODE (≈ MPESA_SHORTCODE) B2C-approved short code
//   - MPESA_B2C_COMMAND_ID                default BusinessPayment
//
// The HTTP response only says whether the request was ACCEPTED by Daraja; the
// real outcome arrives asynchronously via the ResultURL callback. We record
// the OriginatorConversationID so the callback can be matched to our payout.
//
// The Init (response) is not money movement — the ledger stays reserved
// ('processing') until the ResultURL callback settles it.

import { env } from '@/lib/env'
import { getMpesaAccessToken } from './mpesa'

const MPESA_BASE_URL =
  process.env.MPESA_ENVIRONMENT === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke'

export function mpesaB2cEnabled(): boolean {
  return Boolean(
    process.env.MPESA_CONSUMER_KEY &&
      process.env.MPESA_CONSUMER_SECRET &&
      env.mpesaB2cInitiator &&
      env.mpesaB2cSecurityCredential &&
      env.mpesaB2cShortcode
  )
}

export interface MpesaB2cSendResult {
  ok: boolean
  originatorConversationId?: string
  conversationId?: string
  error?: string
}

/**
 * Submit a B2C disbursement. `phone` must be in E.164 form without '+'
 * (e.g. `254712345678`) and `amount` is in KES (the fee is absorbed by the
 * business — the recipient receives the full Amount).
 */
export async function mpesaB2cSendMoney(opts: {
  phone: string
  amount: number
  remark: string
}): Promise<MpesaB2cSendResult> {
  if (!mpesaB2cEnabled()) {
    return { ok: false, error: 'M-Pesa B2C is not configured yet. Automatic KES withdrawals are disabled.' }
  }

  try {
    const accessToken = await getMpesaAccessToken()
    const response = await fetch(`${MPESA_BASE_URL}/mpesa/b2c/v1/paymentrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        InitiatorName: env.mpesaB2cInitiator,
        SecurityCredential: env.mpesaB2cSecurityCredential,
        CommandID: env.mpesaB2cCommandId,
        Amount: String(opts.amount),
        PartyA: env.mpesaB2cShortcode,
        PartyB: opts.phone,
        Remarks: opts.remark,
        QueueTimeOutURL: env.mpesaB2cTimeoutUrl,
        ResultURL: env.mpesaB2cResultUrl,
        Occasion: 'TOPTIER withdrawal',
      }),
    })

    const data = await response.json().catch(() => ({} as Record<string, unknown>))

    if (String(data.ResponseCode) !== '0') {
      return { ok: false, error: String(data.ResponseDescription || 'M-Pesa B2C request rejected') }
    }

    return {
      ok: true,
      originatorConversationId: String(data.OriginatorConversationID || ''),
      conversationId: String(data.ConversationID || ''),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'M-Pesa B2C request failed' }
  }
}

export interface MpesaB2cResultPayload {
  resultType?: number
  resultCode?: number
  resultDesc?: string
  originatorConversationId?: string
  conversationId?: string
  transactionId?: string
  amount?: number
}

/**
 * Parse the async ResultURL payload sent by Safaricom. Returns null when the
 * body is not a B2C result (so non-B2C callbacks to the same URL — e.g. STK
 * parking — are ignored, not settled).
 */
export function mpesaB2cParseResult(body: unknown): MpesaB2cResultPayload | null {
  const result = (body as { Result?: Record<string, unknown> })?.Result
  if (!result || typeof result !== 'object') return null

  const params = result.ResultParameters as { Item?: Array<{ Name?: string; Value?: unknown }> } | undefined
  const item = params?.Item || []
  const findItem = (name: string): unknown => item.find((i) => i.Name === name)?.Value

  const amountRaw = findItem('TransactionAmount')
  const amount = typeof amountRaw === 'number' || typeof amountRaw === 'string' ? Number(amountRaw) : undefined

  return {
    resultType: Number(result.ResultType),
    resultCode: Number(result.ResultCode),
    resultDesc: typeof result.ResultDesc === 'string' ? result.ResultDesc : undefined,
    originatorConversationId: typeof result.OriginatorConversationID === 'string' ? result.OriginatorConversationID : undefined,
    conversationId: typeof result.ConversationID === 'string' ? result.ConversationID : undefined,
    transactionId: typeof result.TransactionID === 'string' ? result.TransactionID : undefined,
    amount: Number.isFinite(amount) ? amount : undefined,
  }
}