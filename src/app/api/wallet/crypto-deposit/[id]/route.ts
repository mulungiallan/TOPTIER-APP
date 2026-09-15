// GET /api/wallet/crypto-deposit/[id]
// Returns one of the user's crypto deposits. While the deposit is still open it
// polls NOWPayments for the current status and reconciles — so a payment that
// completes but whose IPN was missed still credits the wallet the moment the
// user (or the UI poll loop) checks.

import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse } from '@/lib/auth'
import { pollAndReconcileCryptoDeposit } from '@/lib/services/crypto-deposits'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateRequest(request, { id: true })
    if (!auth.user) return errorResponse(auth.error || 'Unauthorized', 401)

    const { id } = await params
    const deposit = await pollAndReconcileCryptoDeposit(id, auth.user.id)
    if (!deposit) return errorResponse('Crypto deposit not found', 404)

    return successResponse({ deposit })
  } catch (error) {
    console.error('Crypto deposit status error:', error)
    return errorResponse('Failed to fetch crypto deposit status', 500)
  }
}