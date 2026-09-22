// POST /api/wallet/crypto/ipn
// NOWPayments IPN (Instant Payment Notification) webhook. Receives payment
// status updates signed with HMAC-SHA512 (sorted top-level JSON keys) in the
// `x-nowpayments-sig` header. On `finished` the wallet is credited with an
// idempotent ledger posting — duplicate/looping IPNs are harmless.

import { NextRequest } from 'next/server'
import { verifyIpnSignature } from '@/lib/payments/nowpayments'
import { env } from '@/lib/env'
import { reconcileCryptoDeposit } from '@/lib/services/crypto-deposits'

interface NowpaymentsIpn {
  payment_id?: unknown
  payment_status?: string
  pay_amount?: number | string
  actually_paid?: number | string
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-nowpayments-sig')
  const secret = env.nowpaymentsIpnSecret

  if (!secret) {
    // Misconfigured webhook — do not trust anything; the status poll path is
    // the fallback. Ack so NOWPayments stops retrying and does not flag 5xx.
    console.error('[nowpayments ipn] IPN secret is not configured — ignoring webhook')
    return Response.json({ ok: false }, { status: 200 })
  }

  if (!verifyIpnSignature(rawBody, signature, secret)) {
    console.error('[nowpayments ipn] signature verification failed')
    return Response.json({ ok: false, error: 'Invalid signature' }, { status: 400 })
  }

  let payload: NowpaymentsIpn
  try {
    payload = JSON.parse(rawBody) as NowpaymentsIpn
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const paymentId = String(payload.payment_id || '')
  if (!paymentId) {
    return Response.json({ ok: false, error: 'Missing payment_id' }, { status: 400 })
  }

  try {
    await reconcileCryptoDeposit(paymentId, {
      paymentStatus: String(payload.payment_status || 'waiting'),
      payAmount: payload.pay_amount != null ? Number(payload.pay_amount) : undefined,
    })
    return Response.json({ ok: true }, { status: 200 })
  } catch (error) {
    console.error('[nowpayments ipn] processing error:', error)
    return Response.json({ ok: false, error: 'Processing failed' }, { status: 500 })
  }
}