import { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'
import { db } from '@/lib/db'
import { getJwtSecret, rehashPassword, successResponse, errorResponse } from '@/lib/auth'
import { resetPasswordSchema, validateBody } from '@/lib/validation'

// POST /api/auth/reset-password — public, no auth required.
// Verifies the signed reset token and sets a new password.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = validateBody(resetPasswordSchema, body)
    if (!parsed.success) {
      return errorResponse(parsed.error, 400)
    }

    const { token, newPassword } = parsed.data

    let payload: { purpose?: string; email?: string }
    try {
      payload = jwt.verify(token, getJwtSecret()) as { purpose?: string; email?: string }
    } catch {
      return errorResponse('Invalid or expired reset token', 400)
    }

    if (payload?.purpose !== 'password_reset' || !payload?.email) {
      return errorResponse('Invalid reset token', 400)
    }

    const user = await db.user.findUnique({ where: { email: payload.email } })
    if (!user) return errorResponse('Account not found', 404)

    await db.user.update({
      where: { id: user.id },
      data: { password: rehashPassword(newPassword), tokenVersion: { increment: 1 } },
    })

    await db.activityLog.create({
      data: {
        userId: user.id,
        action: 'password_reset',
        details: 'Password reset via email link',
      },
    })

    return successResponse({ message: 'Password updated. You can now sign in.' })
  } catch (error) {
    console.error('Reset password error:', error)
    return errorResponse('Failed to reset password', 500)
  }
}
