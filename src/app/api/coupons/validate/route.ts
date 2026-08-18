import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { code } = body as { code?: string }
    if (!code || !code.trim()) {
      return errorResponse('Coupon code is required', 400)
    }

    const coupon = await db.couponCode.findUnique({
      where: { code: code.trim().toUpperCase() },
    })

    if (!coupon || !coupon.isActive) {
      return errorResponse('Invalid or inactive coupon code', 400)
    }
    if (coupon.expiresAt && new Date() > coupon.expiresAt) {
      return errorResponse('Coupon code has expired', 400)
    }
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
      return errorResponse('Coupon code has reached maximum uses', 400)
    }

    return successResponse({
      valid: true,
      code: coupon.code,
      discountType: coupon.discountType,
      discountAmount: coupon.discountAmount,
    })
  } catch (error) {
    console.error('Coupon validate POST error:', error)
    return errorResponse('Failed to validate coupon', 500)
  }
}
