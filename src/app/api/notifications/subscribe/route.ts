import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

// GET /api/notifications/subscribe — list user's push subscriptions
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const subs = await db.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    return successResponse({ subscriptions: subs })
  } catch (error) {
    console.error('Push subscriptions GET error:', error)
    return errorResponse('Failed to fetch subscriptions', 500)
  }
}

// POST /api/notifications/subscribe — register a new push subscription
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { subscription } = body
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return errorResponse('Invalid subscription payload', 400)
    }

    const record = await db.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: subscription.userAgent || null,
        isActive: true,
      },
      update: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: subscription.userAgent || null,
        isActive: true,
      },
    })
    return successResponse({ subscription: record }, 201)
  } catch (error) {
    console.error('Push subscription POST error:', error)
    return errorResponse('Failed to save subscription', 500)
  }
}

// DELETE /api/notifications/subscribe — disable a subscription
export async function DELETE(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { endpoint } = body
    if (!endpoint) return errorResponse('endpoint is required', 400)

    await db.pushSubscription.updateMany({
      where: { endpoint, userId },
      data: { isActive: false },
    })
    return successResponse({ unsubscribed: true })
  } catch (error) {
    console.error('Push subscription DELETE error:', error)
    return errorResponse('Failed to unsubscribe', 500)
  }
}
