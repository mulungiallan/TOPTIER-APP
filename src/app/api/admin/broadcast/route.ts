// src/app/api/admin/broadcast/route.ts
// Admin-only email broadcasts. Split into two concerns:
//
//   POST /api/admin/broadcast            create a campaign (freezes the audience)
//   GET  /api/admin/broadcast?preview=1  audience size for the filters in the UI
//   GET  /api/admin/broadcast            recent campaigns + delivery config
//
// Actually *delivering* is POST /api/admin/broadcast/:id/process — creating a
// campaign never sends. That split is deliberate: a single blocking request
// cannot reliably email a large list (it would hit the platform request
// timeout mid-send with no record of what went out), so the campaign row is
// created up-front and drained chunk-by-chunk instead. The UI polls progress.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/admin-permissions'
import { successResponse, errorResponse } from '@/lib/auth'
import { validateBody, broadcastCreateSchema } from '@/lib/validation'
import {
  createCampaign,
  previewAudience,
  sendTestEmail,
  serializeCampaign,
  AUDIENCE_LABELS,
  type BroadcastAudience,
} from '@/lib/services/broadcast'

/** True when the server can actually deliver mail. */
function emailConfigured() {
  return !!process.env.RESEND_API_KEY
}

// POST /api/admin/broadcast — create a campaign, or send a test to the caller.
export async function POST(request: NextRequest) {
  try {
    const { error, user } = await requirePermission(request, 'content.write')
    if (error) return error
    if (!user) return errorResponse('Admin access required', 403)

    const body = await request.json()
    const parsed = validateBody(broadcastCreateSchema, body)
    if (!parsed.success) return errorResponse(parsed.error, 400)
    const { testOnly, idempotencyKey, ...input } = parsed.data

    // Refuse early rather than after snapshotting: without a Resend key every
    // send would throw and the campaign would just fill up with failures.
    if (!emailConfigured()) {
      return errorResponse(
        'Email is not configured on this server. Set RESEND_API_KEY (and a verified EMAIL_FROM domain) before broadcasting.',
        503
      )
    }

    if (testOnly) {
      await sendTestEmail(user, input)
      return successResponse({ test: true, sentTo: user.email })
    }

    const { campaign, recipients, skippedInvalid } = await createCampaign(user, input, idempotencyKey)
    if (!campaign) {
      return errorResponse('No users matched that audience. Try widening the filters.', 400)
    }

    // Immutable audit trail (matches /api/admin-actions conventions).
    await db.adminAuditLog
      .create({
        data: {
          adminId: user.id,
          action: 'create_broadcast',
          target: campaign.id,
          details: JSON.stringify({
            subject: campaign.subject,
            audience: campaign.audience,
            recipients,
            skippedInvalid,
          }),
        },
      })
      .catch((e) => console.error('Failed to log broadcast creation:', e))

    return successResponse({
      campaign,
      message: `Campaign queued for ${recipients} recipient(s).`,
    })
  } catch (error) {
    console.error('Create broadcast error:', error)
    return errorResponse('Failed to create the broadcast campaign.', 500)
  }
}

// GET /api/admin/broadcast — recent campaigns, or audience size with ?preview=1
export async function GET(request: NextRequest) {
  try {
    const { error } = await requirePermission(request, 'content.write')
    if (error) return error

    const params = request.nextUrl.searchParams

    if (params.get('preview') === '1') {
      const raw = params.get('audience')
      const audience: BroadcastAudience = raw && raw in AUDIENCE_LABELS ? (raw as BroadcastAudience) : 'all'
      const counts = await previewAudience(audience, params.get('joinedAfter') || undefined)
      return successResponse({
        audience,
        audienceLabel: AUDIENCE_LABELS[audience],
        ...counts,
      })
    }

    const campaigns = await db.broadcastCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    return successResponse({
      campaigns: campaigns.map(serializeCampaign),
      config: {
        emailConfigured: emailConfigured(),
        from: process.env.EMAIL_FROM || 'notifications@toptier.app',
      },
      audiences: Object.entries(AUDIENCE_LABELS).map(([value, label]) => ({ value, label })),
    })
  } catch (error) {
    console.error('List broadcasts error:', error)
    return errorResponse('Failed to load broadcasts.', 500)
  }
}
