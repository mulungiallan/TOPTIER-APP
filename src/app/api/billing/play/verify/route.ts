// Google Play purchase verification + entitlement fulfillment.
// The native app fires a purchase through RevenueCat (StoreKit / Play Billing),
// then the web layer calls this endpoint with the product id. The server
// confirms an ACTIVE entitlement on the RevenueCat subscriber before granting
// premium — the purchase token alone is never trusted.

import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { db } from '@/lib/db'
import { fulfillPendingPayment } from '@/lib/payments/fulfillment'

const REVENUECAT_BASE_URL = 'https://api.revenuecat.com/v1'

const PRODUCT_TO_PLAN: Record<string, string> = {
  toptier_premium_monthly: 'premium_monthly',
  toptier_premium_annual: 'premium_annual',
  toptier_lifetime: 'lifetime',
}

function planFromProduct(productId: string): string | null {
  if (PRODUCT_TO_PLAN[productId]) return PRODUCT_TO_PLAN[productId]
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('REVENUECAT_') && process.env[key] === productId) {
      const plan = key.replace('REVENUECAT_', '').toLowerCase()
      if (plan === 'android_monthly') return 'premium_monthly'
      if (plan === 'android_annual') return 'premium_annual'
      if (plan === 'android_lifetime') return 'lifetime'
    }
  }
  return null
}

async function getSubscriber(userId: string) {
  const apiKey = process.env.REVENUECAT_SECRET_KEY
  if (!apiKey) {
    throw new Error('RevenueCat not configured: set REVENUECAT_SECRET_KEY to verify Play purchases server-side.')
  }
  const res = await fetch(`${REVENUECAT_BASE_URL}/subscribers/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'GET',
  })
  if (!res.ok) {
    throw new Error(`RevenueCat look-up failed (${res.status}). If the purchase was NOT made through RevenueCat, connect the web purchase instead.`)
  }
  return res.json()
}

interface PlayPurchaseRecord {
  productIdentifier?: string
  expires_date?: string | null
  purchase_date?: string
  is_sandbox?: boolean
}

interface RevenueCatSubscriber {
  subscriber?: {
    purchases?: Record<string, PlayPurchaseRecord>
  }
}

function entitlementActive(purchase: PlayPurchaseRecord | undefined, expires: string | null): boolean {
  if (!purchase) return false
  if (expires == null) return true // non-consumable / lifetime
  const expiry = new Date(expires)
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() > Date.now()
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = (await request.json()) as {
      productId?: string
      purchaseToken?: string
    }
    const { productId, purchaseToken } = body

    if (!productId) return errorResponse('productId is required', 400)
    if (!purchaseToken) return errorResponse('purchaseToken is required', 400)

    const planType = planFromProduct(productId)
    if (!planType) {
      return errorResponse(`Unknown product: ${productId}. Create the product in RevenueCat and set REVENUECAT_ANDROID_* envs.`, 400)
    }

    let subscriber: RevenueCatSubscriber | null = null
    try {
      subscriber = (await getSubscriber(userId)) as RevenueCatSubscriber
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : 'Unable to verify purchase', 500)
    }

    const purchases = subscriber?.subscriber?.purchases || {}
    const purchase = purchases[productId]
    const expires = purchase?.expires_date ?? null

    if (!entitlementActive(purchase, expires)) {
      return errorResponse('No active Play purchase found for this product.', 403)
    }

    const now = new Date()
    const endDate = expires ? new Date(expires) : null

    const existing = await db.paymentTransaction.findFirst({
      where: { userId, stripeSessionId: purchaseToken, status: 'completed' },
    })
    if (existing) {
      return successResponse({
        verified: true,
        subscription: { tier: existing.planType === 'lifetime' ? 'lifetime' : 'premium', isActive: true, startDate: existing.createdAt, endDate },
      })
    }

    const transaction = await db.paymentTransaction.create({
      data: {
        userId,
        amount: 0,
        currency: 'USD',
        planType,
        paymentProvider: 'revenuecat',
        status: 'pending',
        stripeSessionId: purchaseToken,
        description: `Google Play ${planType.replace('_', ' ')} via RevenueCat${purchase?.is_sandbox ? ' (sandbox)' : ''}`,
      },
    })

    const fulfillment = await fulfillPendingPayment(
      { userId, planType, stripeSessionId: purchaseToken },
      { provider: 'revenuecat', paymentMethod: 'google_play' }
    )

    if (!fulfillment.fulfilled) {
      return errorResponse('Purchase already fulfilled for this token.', 409)
    }

    return successResponse({
      verified: true,
      transactionId: transaction.id,
      subscription: {
        tier: fulfillment.tier,
        isActive: true,
        startDate: now,
        endDate: fulfillment.endDate,
      },
    })
  } catch (error) {
    console.error('Play billing verify POST error:', error)
    return errorResponse(error instanceof Error ? error.message : 'Failed to verify Play purchase', 500)
  }
}