// TOPTIER Payment Verification API
// Verifies and completes a payment after user returns from checkout

import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { verifyPayment, type PaymentProvider } from '@/lib/payments/registry'
import { fulfillPendingPayment } from '@/lib/payments/fulfillment'
import { PAYMENTS_ENABLED } from '@/lib/flags'

export async function POST(request: NextRequest) {
  try {
    if (!PAYMENTS_ENABLED) {
      return errorResponse('Premium subscriptions are not open yet.', 503)
    }

    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { provider, providerTransactionId, reference } = body as {
      provider: PaymentProvider
      providerTransactionId?: string
      reference?: string
    }

    if (!provider) {
      return errorResponse('provider is required', 400)
    }

    // Verify the payment with the provider
    const result = await verifyPayment(provider, {
      provider,
      providerTransactionId,
      reference,
    })

    if (result.status === 'completed') {
      const planType = result.planType
      if (!planType) {
        return successResponse({ verified: true, status: result.status, amount: result.amount, currency: result.currency })
      }

      const fulfillment = await fulfillPendingPayment(
        { userId, planType, stripeSessionId: providerTransactionId || reference || undefined },
        { provider }
      )

      if (fulfillment.fulfilled) {
        return successResponse({
          verified: true,
          subscription: {
            tier: fulfillment.tier,
            startDate: new Date(),
            endDate: fulfillment.endDate,
            isActive: true,
          },
          transaction: {
            amount: result.amount,
            currency: result.currency,
            planType,
            status: 'completed',
          },
        })
      }
    }

    return successResponse({
      verified: result.status === 'completed',
      status: result.status,
      amount: result.amount,
      currency: result.currency,
    })
  } catch (error) {
    console.error('Payment verify POST error:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to verify payment', 500)
  }
}
