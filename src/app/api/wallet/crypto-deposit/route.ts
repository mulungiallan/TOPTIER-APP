// POST /api/wallet/crypto-deposit
//   Start a real on-chain crypto deposit. Creates a NOWPayments payment, which
//   mints a one-time deposit address + exact send amount for the asset. The
//   wallet is credited on confirmation (IPN webhook or status polling) — never
//   at creation time.
//
// GET /api/wallet/crypto-deposit
//   List the authenticated user's recent crypto deposits (for UI resume).

import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse } from '@/lib/auth'
import { nowpaymentsConfigured } from '@/lib/payments/nowpayments'
import {
  createCryptoDepositRequest,
  listCryptoDeposits,
} from '@/lib/services/crypto-deposits'
import { validateBody, cryptoDepositSchema } from '@/lib/validation'

export async function POST(request: NextRequest) {
  try {
    if (!nowpaymentsConfigured()) {
      return errorResponse('Crypto deposits are not configured yet.', 503)
    }

    const auth = await authenticateRequest(request, { id: true })
    if (!auth.user) return errorResponse(auth.error || 'Unauthorized', 401)

    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const parsed = validateBody(cryptoDepositSchema, body)
    if (!parsed.success) return errorResponse(parsed.error, 400)

    const deposit = await createCryptoDepositRequest({
      userId: auth.user.id,
      asset: parsed.data.asset,
      amount: parsed.data.amount,
    })

    return successResponse({ deposit })
  } catch (error) {
    console.error('Crypto deposit create error:', error)
    const message =
      error instanceof Error && error.message.startsWith('NOWPayments: ')
        ? error.message.slice('NOWPayments: '.length)
        : error instanceof Error && error.message.includes('below the')
          ? error.message
          : 'Failed to create crypto deposit. Please try again.'
    return errorResponse(message, 400)
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, { id: true })
    if (!auth.user) return errorResponse(auth.error || 'Unauthorized', 401)

    const deposits = await listCryptoDeposits(auth.user.id)
    return successResponse({ deposits })
  } catch (error) {
    console.error('Crypto deposit list error:', error)
    return errorResponse('Failed to fetch crypto deposits', 500)
  }
}