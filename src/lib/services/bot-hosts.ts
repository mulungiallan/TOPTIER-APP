// src/lib/services/bot-hosts.ts
// Resolves which execution host (a user's paired machine, or the legacy owner
// host from BOT_SERVICE_URL) a bot request should be routed to.
//
// Routing rules:
//   • An instance that is pinned to a BotHost always talks to that host, even
//     if it has gone offline — we never silently move a running bot to another
//     machine, which could double-trade the same account.
//   • A new instance runs on the user's most-recently-seen online host.
//   • When no self-hosted host exists we fall back to the owner host, which is
//     what single-tenant deployments (and the developer's own box) use.

import { db } from '@/lib/db'
import { decryptSecret } from '@/lib/bot-crypto'
import type { BotHostTarget } from '@/lib/services/bot-service'

interface HostRow {
  id: string
  url: string | null
  keyEnc: string
  status: string
}

/** The legacy owner host from env, or null when it is not configured. */
export function ownerHostTarget(): BotHostTarget | null {
  const url = process.env.BOT_SERVICE_URL
  const key = process.env.BOT_SERVICE_KEY
  if (!url || !key) return null
  return { url: url.replace(/\/+$/, ''), key }
}

/** Convert a BotHost row into a routing target, or null if it is unusable. */
export function hostToTarget(host: HostRow): BotHostTarget | null {
  if (!host.url) return null
  if (host.status === 'disabled') return null
  const key = decryptSecret(host.keyEnc)
  if (!key) return null
  return { hostId: host.id, url: host.url.replace(/\/+$/, ''), key }
}

/**
 * Resolve the host that should run a specific instance right now. Honors the
 * instance's pinned host when set; otherwise falls back to the owner host.
 */
export async function resolveInstanceHost(instanceId: string): Promise<BotHostTarget | null> {
  const inst = await db.botInstance.findUnique({
    where: { id: instanceId },
    select: { host: true },
  })
  if (inst?.host) {
    const target = hostToTarget(inst.host)
    if (target) return target
  }
  return ownerHostTarget()
}

/**
 * Resolve the host a user's new bot should run on: the user's best available
 * self-hosted host, else the owner host. `preferredHostId` forces a specific
 * host when the user picks one.
 */
export async function resolveUserHost(userId: string, preferredHostId?: string | null): Promise<BotHostTarget | null> {
  const hosts = await db.botHost.findMany({
    where: { userId, status: { not: 'disabled' } },
    orderBy: [{ lastSeenAt: 'desc' }, { createdAt: 'desc' }],
  })
  const chosen = preferredHostId
    ? hosts.find((h) => h.id === preferredHostId) ?? hosts[0]
    : hosts[0]
  if (chosen) {
    const target = hostToTarget(chosen)
    if (target) return target
  }
  return ownerHostTarget()
}

/**
 * Resolve the host to start an instance on. A pinned instance keeps its host;
 * an unpinned one is placed on the user's best host and returned so the caller
 * can persist the assignment.
 */
export async function resolveStartHost(instanceId: string, userId: string): Promise<BotHostTarget | null> {
  const inst = await db.botInstance.findUnique({
    where: { id: instanceId },
    select: { host: true },
  })
  if (inst?.host) {
    const target = hostToTarget(inst.host)
    if (target) return target
  }
  return resolveUserHost(userId)
}

/** Constant-time comparison of two secrets. */
export function keysMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
