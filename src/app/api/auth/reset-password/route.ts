import { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'
import { db } from '@/lib/db'
import { getJwtSecret, rehashPassword, successResponse, errorResponse } from '@/lib/auth'

// POST /api/auth/reset-password — public, no auth required.
// Verifies the signed reset token and sets a new password.
export async function POST(request: NextRequest) {
  try {
    const { token, newPassword } = await request.json()

    if (!token) return errorResponse('Reset token is required', 400)
    if (!newPassword || newPassword.length < 8) {
      return errorResponse('Password must be at least 8 characters', 400)
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return errorResponse('Password must contain uppercase, lowercase, and a number', 400)
    }

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
      data: { password: rehashPassword(newPassword) },
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
