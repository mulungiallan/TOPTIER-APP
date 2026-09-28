import type { BotInstance } from '@/generated/prisma'

/**
 * A bot instance is only genuinely alive if the bot service has checked in
 * recently. The `status` column is written when the instance starts/stops and
 * is never revised if the process dies, so a crashed (or unreachable) bot
 * keeps reporting "running" forever. Heartbeat age is the honest signal.
 */
export const HEARTBEAT_STALE_MS = 5 * 60 * 1000

export type InstanceLiveness = {
  /** Status flag claims running/starting. */
  claimsRunning: boolean
  /** Status flag AND a recent heartbeat: the bot is actually reporting. */
  live: boolean
  /** Claims running but no heartbeat within the window: dead or unreachable. */
  stale: boolean
  /** Age of the last heartbeat in ms, null if never seen. */
  heartbeatAgeMs: number | null
  lastHeartbeatAt: Date | null
}

export function instanceLiveness(
  instance: Pick<BotInstance, 'status' | 'lastHeartbeatAt'> | null | undefined,
  now: Date = new Date(),
  staleMs: number = HEARTBEAT_STALE_MS,
): InstanceLiveness {
  const claimsRunning = !!instance && (instance.status === 'running' || instance.status === 'starting')
  const lastHeartbeatAt = instance?.lastHeartbeatAt ?? null
  const heartbeatAgeMs = lastHeartbeatAt ? now.getTime() - lastHeartbeatAt.getTime() : null
  const fresh = heartbeatAgeMs !== null && heartbeatAgeMs <= staleMs

  return {
    claimsRunning,
    live: claimsRunning && fresh,
    stale: claimsRunning && !fresh,
    heartbeatAgeMs,
    lastHeartbeatAt,
  }
}

/** Human-readable age, e.g. "47h", "12m", "just now". */
export function formatHeartbeatAge(ageMs: number | null): string {
  if (ageMs === null) return 'never'
  if (ageMs < 60_000) return 'just now'
  const mins = Math.floor(ageMs / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
