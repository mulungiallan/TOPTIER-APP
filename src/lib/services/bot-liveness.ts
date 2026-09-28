import type { BotInstance } from '@/generated/prisma'

/**
 * Staleness window for bot liveness.
 *
 * The engine's main loop scans every SCAN_INTERVAL_SECONDS (60s) and pushes a
 * status snapshot every DASHBOARD_REFRESH_EVERY_N_SCANS (5) scans, so a healthy
 * bot reports roughly every 5 minutes. Allow three missed cycles before calling
 * it dead: that tolerates one or two dropped posts (brief network loss, an app
 * redeploy) while still catching a genuinely dead bot within ~15 minutes.
 *
 * Note: a freshly started engine stays silent while it backtests strategies
 * during warm-up, so the banner can appear briefly right after a start.
 */
export const HEARTBEAT_STALE_MS = 15 * 60 * 1000

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
