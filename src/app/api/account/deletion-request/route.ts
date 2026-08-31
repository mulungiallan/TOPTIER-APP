import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'

// POST /api/account/deletion-request
// Public endpoint (no auth) for GDPR/CCPA/Google Play data-deletion requests.
// Users can request deletion of their account and personal data by email.
// Requests are stored so they can be actioned by support.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    const requestType = body.requestType === 'export' ? 'export' : 'delete'

    if (!email) {
      return errorResponse('An email address is required', 400)
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return errorResponse('Please provide a valid email address', 400)
    }
    if (email.length > 200) {
      return errorResponse('Email is too long', 400)
    }
    if (reason.length > 2000) {
      return errorResponse('Reason is too long (max 2000 characters)', 400)
    }

    const record = await db.dataDeletionRequest.create({
      data: {
        email,
        reason: reason || null,
        requestType,
      },
    })

    return successResponse(
      {
        id: record.id,
        message:
          requestType === 'export'
            ? 'Your data export request has been received. We will contact you at the email provided.'
            : 'Your account and data deletion request has been received. We will process it within 30 days and confirm at the email provided.',
      },
      201,
    )
  } catch (error) {
    console.error('Deletion request error:', error)
    return errorResponse('Failed to submit request', 500)
  }
}
