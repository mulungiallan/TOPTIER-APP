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
      // `tokenVersion` is snapshotted into the token. A successful reset
      // increments it, which makes this token single-use without needing a
      // separate "used tokens" table — a replayed link fails the version check
      // in reset-password. Without this, a reset link stays replayable for its
      // full 30-minute life (e.g. from a shared or forwarded mailbox).
      const token = jwt.sign(
        { purpose: 'password_reset', email: user.email, tokenVersion: user.tokenVersion },
        getJwtSecret(),
        { expiresIn: '30m' }
      )
      try {
        await emailService.sendPasswordResetEmail(user.email, token)
      } catch (emailError) {
        // Never surface delivery failure to the caller — the response must stay
        // identical whether or not the address is registered (see above).
        console.error('[ForgotPassword] Email send failed (RESEND_API_KEY may be missing):', emailError)
      }
    }

    return successResponse({
      message: 'If an account exists for that email, a password reset link has been sent.',
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    return errorResponse('Failed to send reset email', 500)
  }
}
