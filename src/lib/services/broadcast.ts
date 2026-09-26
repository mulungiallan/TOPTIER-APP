// src/lib/services/broadcast.ts
// Admin email broadcasts.
//
// Design notes:
// - A campaign freezes its audience into BroadcastRecipient rows up-front, so
//   the recipient list can't shift under a running send (and a resumed send
//   re-reads the same rows).
// - Sending is chunked and resumable, driven by `processCampaign`, which drains
//   `pending` recipients a page at a time. A single blocking HTTP request can't
//   reliably email a large list — it would hit the platform request timeout
//   mid-send with no record of what went out. Here the campaign row is the
//   record, so a timeout or redeploy resumes instead of losing the send.
// - Recipient rows are the idempotency guard: a row is only sent while it is
//   still `pending`, so overlapping/re-triggered workers cannot double-send.
// - Banned and soft-deleted users are never snapshotted, and only admins with
//   the `content.write` permission can drive any of this.

import { Prisma } from '@/generated/prisma'
import { db } from '@/lib/db'
import { emailService } from '@/lib/services/email'
import type { AdminUser } from '@/lib/admin-guard'

export type BroadcastAudience =
  | 'all'
  | 'verified'
  | 'premium'
  | 'trial'
  | 'free'
  | 'signals'
  | 'bot'
  | 'joined_after'

export interface BroadcastInput {
  title: string
  message: string
  actionUrl?: string
  actionLabel?: string
  audience: BroadcastAudience
  joinedAfter?: string
}

export type CampaignStatus = 'queued' | 'sending' | 'paused' | 'completed' | 'cancelled'

/** Recipients drained per processCampaign call. Keeps one call well under the
 *  request timeout so the worker can be re-triggered safely. */
export const BROADCAST_CHUNK_SIZE = 20

/** Concurrent sends inside a chunk. Deliberately low: Resend rate-limits and we
 *  would rather be slow than trip a 429 across the whole list. */
const CONCURRENCY = 3

export const AUDIENCE_LABELS: Record<BroadcastAudience, string> = {
  all: 'All users',
  verified: 'Verified email only',
  premium: 'Paying subscribers',
  trial: 'Trial users',
  free: 'Free-tier users',
  signals: 'Signals subscribers',
  bot: 'Bot subscribers',
  joined_after: 'Joined after a date',
}

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Prisma filter for an audience. `isBanned`/`deletedAt` are always applied —
 * they are a safety rule, not an audience option.
 */
export function audienceWhere(audience: BroadcastAudience, joinedAfter?: string): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = { isBanned: false, deletedAt: null }

  switch (audience) {
    case 'verified':
      return { ...base, isEmailVerified: true }
    case 'premium':
      return {
        ...base,
        OR: [
          { subscriptionTier: { in: ['premium', 'lifetime'] } },
          { subscriptionEndDate: { gt: new Date() } },
          { plan: { in: ['starter', 'premium', 'pro', 'enterprise', 'unlimited'] } },
        ],
      }
    case 'trial':
      return { ...base, subscriptionTier: 'trial' }
    case 'free':
      return {
        ...base,
        subscriptionTier: 'free',
        plan: 'free',
        signalsUnlocked: false,
        botExpiresAt: null,
      }
    case 'signals':
      return {
        ...base,
        OR: [
          { signalsUnlocked: true },
          { signalsExpiresAt: { gt: new Date() } },
        ],
      }
    case 'bot':
      return { ...base, botExpiresAt: { gt: new Date() } }
    case 'joined_after': {
      // An unparseable/missing date must not silently widen to "everyone" —
      // fall back to the narrowest sensible audience (nobody).
      const from = joinedAfter ? new Date(`${joinedAfter}T00:00:00.000Z`) : null
      return from && !Number.isNaN(from.getTime()) ? { ...base, createdAt: { gte: from } } : { ...base, id: '__none__' }
    }
    case 'all':
    default:
      return base
  }
}

/** Snapshot the audience and persist the campaign + its recipient rows. */
export async function createCampaign(
  admin: AdminUser,
  input: BroadcastInput,
  idempotencyKey?: string
) {
  // Idempotency: a retried create (double-click, flaky mobile network) must not
  // spawn a second campaign. The client-supplied key becomes the campaign id,
  // so the unique primary key does the deduplication for us.
  if (idempotencyKey) {
    const existing = await db.broadcastCampaign.findUnique({ where: { id: idempotencyKey } })
    if (existing) {
      return { campaign: serializeCampaign(existing), recipients: existing.totalCount, skippedInvalid: 0, deduplicated: true }
    }
  }

  const users = await db.user.findMany({
    where: audienceWhere(input.audience, input.joinedAfter),
    select: { email: true },
  })

  // De-dupe case-insensitively: `email` is unique in SQLite but "A@b.com" and
  // "a@b.com" can both exist on a case-sensitive collation, and sending twice
  // to the same inbox is the fastest way to get a domain flagged.
  const seen = new Set<string>()
  const targets: string[] = []
  let skippedInvalid = 0
  for (const u of users) {
    const email = (u.email || '').trim()
    if (!VALID_EMAIL.test(email)) {
      skippedInvalid++
      continue
    }
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    targets.push(email)
  }

  if (targets.length === 0) {
    return { campaign: null, recipients: 0, skippedInvalid }
  }

  const created = await db.broadcastCampaign.create({
    data: {
      // A client-supplied idempotency key doubles as the primary key, so a
      // duplicated create request collides instead of creating a second send.
      ...(idempotencyKey ? { id: idempotencyKey } : {}),
      adminId: admin.id,
      subject: input.title,
      body: input.message,
      actionUrl: input.actionUrl || null,
      actionLabel: input.actionLabel || null,
      audience: input.audience,
      status: 'queued',
      totalCount: targets.length,
      // createMany is a single statement — far faster than N inserts when the
      // list is large. `targets` is already de-duped above, which SQLite's
      // createMany can't enforce for us (skipDuplicates is Postgres-only).
      recipients: {
        createMany: {
          data: targets.map((email) => ({ email })),
        },
      },
    },
  })

  return {
    campaign: serializeCampaign(created),
    recipients: targets.length,
    skippedInvalid,
    deduplicated: false,
  }
}

/** Send the campaign to the admin only — validates the template end to end. */
export async function sendTestEmail(admin: AdminUser, input: BroadcastInput) {
  await emailService.sendBroadcastEmail(admin.email, {
    subject: input.title,
    body: input.message,
    actionUrl: input.actionUrl || undefined,
    actionLabel: input.actionLabel || undefined,
  })
}

async function countPending(campaignId: string): Promise<number> {
  return db.broadcastRecipient.count({ where: { campaignId, status: 'pending' } })
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 500)
  return String(err).slice(0, 500)
}

/**
 * Drain up to BROADCAST_CHUNK_SIZE pending recipients. Safe to call
 * repeatedly: it stops at the chunk boundary, leaves the campaign `sending`
 * while work remains, and only marks `completed` when nothing is pending.
 * Returns the updated counters so the caller can report progress.
 */
export async function processCampaign(
  campaignId: string,
  options: { maxChunks?: number } = {}
): Promise<{ status: CampaignStatus; sent: number; failed: number; pending: number; total: number }> {
  const campaign = await db.broadcastCampaign.findUnique({ where: { id: campaignId } })
  if (!campaign) throw new Error('Campaign not found')
  if (campaign.status === 'cancelled') {
    const pending = await countPending(campaignId)
    return { status: 'cancelled', sent: campaign.sentCount, failed: campaign.failedCount, pending, total: campaign.totalCount }
  }

  await db.broadcastCampaign.update({
    where: { id: campaignId },
    data: { status: 'sending', lastError: null, startedAt: campaign.startedAt ?? new Date() },
  })

  const maxChunks = options.maxChunks ?? 1
  let sent = campaign.sentCount
  let failed = campaign.failedCount

  for (let chunk = 0; chunk < maxChunks; chunk++) {
    const batch = await db.broadcastRecipient.findMany({
      where: { campaignId, status: 'pending' },
      orderBy: { id: 'asc' },
      take: BROADCAST_CHUNK_SIZE,
    })
    if (batch.length === 0) break

    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const slice = batch.slice(i, i + CONCURRENCY)
      await Promise.all(
        slice.map(async (recipient) => {
          try {
            await emailService.sendBroadcastEmail(recipient.email, {
              subject: campaign.subject,
              body: campaign.body,
              actionUrl: campaign.actionUrl || undefined,
              actionLabel: campaign.actionLabel || undefined,
            })
            // Guarded by the unique index + status filter: if two workers race,
            // only one updateMany matches and the other send is a no-op.
            const updated = await db.broadcastRecipient.updateMany({
              where: { id: recipient.id, status: 'pending' },
              data: { status: 'sent', sentAt: new Date(), error: null },
            })
            if (updated.count === 1) sent++
          } catch (err) {
            const message = errorMessage(err)
            console.error(`[Broadcast] Failed to send campaign ${campaignId} to ${recipient.email}:`, message)
            const updated = await db.broadcastRecipient.updateMany({
              where: { id: recipient.id, status: 'pending' },
              data: { status: 'failed', error: message },
            })
            if (updated.count === 1) failed++
          }
        })
      )
    }
  }

  const pending = await countPending(campaignId)
  const status: CampaignStatus = pending === 0 ? 'completed' : 'sending'

  await db.broadcastCampaign.update({
    where: { id: campaignId },
    data: {
      sentCount: sent,
      failedCount: failed,
      status,
      completedAt: pending === 0 ? new Date() : null,
    },
  })

  return { status, sent, failed, pending, total: campaign.totalCount }
}

/** Halt a campaign. Already-sent mail can't be recalled, but nothing further
 *  goes out and the pending rows stay resumable via `resumeCampaign`. */
export async function cancelCampaign(campaignId: string) {
  return db.broadcastCampaign.update({
    where: { id: campaignId },
    data: { status: 'cancelled' },
  })
}

export async function resumeCampaign(campaignId: string) {
  return db.broadcastCampaign.update({
    where: { id: campaignId },
    data: { status: 'queued' },
  })
}

/** Recipient counts for the UI's audience preview. */
export async function previewAudience(audience: BroadcastAudience, joinedAfter?: string) {
  const users = await db.user.findMany({
    where: audienceWhere(audience, joinedAfter),
    select: { email: true },
  })
  const seen = new Set<string>()
  let deliverable = 0
  for (const u of users) {
    const email = (u.email || '').trim()
    if (!VALID_EMAIL.test(email)) continue
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deliverable++
  }
  return { matched: users.length, deliverable }
}

export type CampaignRow = {
  id: string
  subject: string
  body: string
  actionUrl: string | null
  actionLabel: string | null
  audience: string
  status: string
  totalCount: number
  sentCount: number
  failedCount: number
  lastError: string | null
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
}

export function serializeCampaign(c: CampaignRow) {
  const pending = Math.max(0, c.totalCount - c.sentCount - c.failedCount)
  return {
    id: c.id,
    subject: c.subject,
    body: c.body,
    actionUrl: c.actionUrl,
    actionLabel: c.actionLabel,
    audience: c.audience,
    audienceLabel: AUDIENCE_LABELS[c.audience as BroadcastAudience] ?? c.audience,
    status: c.status,
    total: c.totalCount,
    sent: c.sentCount,
    failed: c.failedCount,
    pending,
    lastError: c.lastError,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
    createdAt: c.createdAt,
  }
}
