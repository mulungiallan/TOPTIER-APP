import { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'
import { db } from '@/lib/db'
import { getJwtSecret, successResponse, errorResponse } from '@/lib/auth'
import { emailService } from '@/lib/services/email'

// POST /api/auth/forgot-password — public, no auth required.
// Sends a signed, 30-minute reset link to the account email (if it exists).
// Always returns success to avoid leaking which emails are registered.
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : ''
    if (!normalized) {
      return errorResponse('Email is required', 400)
    }

    const user = await db.user.findUnique({ where: { email: normalized } })

    if (user) {
      const token = jwt.sign(
        { purpose: 'password_reset', email: user.email },
        getJwtSecret(),
        { expiresIn: '30m' }
      )
      await emailService.sendPasswordResetEmail(user.email, token)
    }

    return successResponse({
      message: 'If an account exists for that email, a password reset link has been sent.',
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    return errorResponse('Failed to send reset email', 500)
  }
}
