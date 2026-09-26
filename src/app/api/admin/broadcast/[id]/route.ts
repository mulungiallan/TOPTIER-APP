// src/app/api/admin/broadcast/[id]/route.ts
// Drive and inspect a single campaign.
//
//   GET  /api/admin/broadcast/:id   status + per-recipient failures
//   POST /api/admin/broadcast/:id   { action: 'process' | 'cancel' | 'resume' }
//
// 'process' drains one chunk of pending recipients and returns. The client
// re-calls it until the campaign reports `completed`. This keeps every request
// short (no timeout risk on a large list) and — because pending rows are only
// ever moved once — a crash or redeploy mid-send resumes rather than
// duplicating. 'cancel' stops further sends; 'resume' re-queues a cancelled one.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/admin-permissions'
import { successResponse, errorResponse } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { z } from 'zod'
import {
  processCampaign,
  cancelCampaign,
  resumeCampaign,
  serializeCampaign,
  BROADCAST_CHUNK_SIZE,
} from '@/lib/services/broadcast'

type Params = { params: Promise<{ id: string }> }

const actionSchema = z.object({
  action: z.enum(['process', 'cancel', 'resume']),
})

const FAILURE_LIMIT = 25

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { error } = await requirePermission(request, 'content.write')
    if (error) return error

    const { id } = await params
    const campaign = await db.broadcastCampaign.findUnique({ where: { id } })
    if (!campaign) return errorResponse('Campaign not found.', 404)

    const failed = await db.broadcastRecipient.findMany({
      where: { campaignId: id, status: 'failed' },
      orderBy: { id: 'asc' },
      take: FAILURE_LIMIT,
      select: { email: true, error: true },
    })
    const failureTotal = await db.broadcastRecipient.count({ where: { campaignId: id, status: 'failed' } })

    return successResponse({
      campaign: serializeCampaign(campaign),
      chunkSize: BROADCAST_CHUNK_SIZE,
      failures: failed.map((f) => ({ email: f.email, error: f.error })),
      failureTotal,
    })
  } catch (error) {
    console.error('Get broadcast error:', error)
    return errorResponse('Failed to load the campaign.', 500)
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { error, user } = await requirePermission(request, 'content.write')
    if (error) return error
    if (!user) return errorResponse('Admin access required', 403)

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const parsed = validateBody(actionSchema, body)
    if (!parsed.success) return errorResponse(parsed.error, 400)
    const { action } = parsed.data

    const existing = await db.broadcastCampaign.findUnique({ where: { id } })
    if (!existing) return errorResponse('Campaign not found.', 404)

    if (action === 'cancel') {
      const campaign = await cancelCampaign(id)
      return successResponse({ campaign: serializeCampaign(campaign) })
    }

    if (action === 'resume') {
      const campaign = await resumeCampaign(id)
      return successResponse({ campaign: serializeCampaign(campaign) })
    }

    // Refuse to start sending when the server has no delivery credentials —
    // otherwise every recipient row would be burned as a failure.
    if (!process.env.RESEND_API_KEY) {
      return errorResponse(
        'Email is not configured on this server. Set RESEND_API_KEY before sending.',
        503
      )
    }

    const result = await processCampaign(id)

    await db.adminAuditLog
      .create({
        data: {
          adminId: user.id,
          action: 'process_broadcast',
          target: id,
          details: JSON.stringify({ status: result.status, sent: result.sent, failed: result.failed, pending: result.pending }),
        },
      })
      .catch((e) => console.error('Failed to log broadcast progress:', e))

    return successResponse({ ...result, done: result.pending === 0 })
  } catch (error) {
    console.error('Process broadcast error:', error)
    return errorResponse('Failed to advance the campaign.', 500)
  }
}
