// src/app/api/health/route.ts
// Public health-check endpoint used by the Docker healthcheck and uptime
// monitors. Returns HTTP 200 only when the app is fully booted (DB reachable).
//
// It also reports the SQLite volume's headroom and whether the database accepts
// WRITES. A read-only `SELECT 1` succeeds on a completely full disk, which is
// exactly how the last outage hid: /api/health said "ok" while login, signup and
// the screenshot analyser were all failing with SQLITE_FULL. The write probe
// writes and immediately deletes one row in a table that is already being
// pruned, so it costs nothing and cannot accumulate.

import { db } from '@/lib/db'
import { volumeFreeBytes } from '@/lib/services/db-retention'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Below this, a health check should fail loudly rather than report "ok". */
const MIN_FREE_BYTES = 50 * 1024 * 1024

export async function GET() {
  const started = new Date()
  let dbStatus: 'ok' | 'error' = 'ok'
  let writeStatus: 'ok' | 'full' | 'error' = 'ok'

  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ])
  } catch {
    dbStatus = 'error'
  }

  if (dbStatus === 'ok') {
    try {
      // AppSetting has no foreign keys and is already used for boot-time
      // bookkeeping, so it is the cheapest possible canary for "can the disk
      // take a write at all?". Upsert then delete: nothing accumulates, and it
      // cannot disturb a real setting because the key is unique to the probe.
      await db.appSetting.upsert({
        where: { key: '__health_probe' },
        create: { key: '__health_probe', value: String(Date.now()) },
        update: { value: String(Date.now()) },
      })
      await db.appSetting.deleteMany({ where: { key: '__health_probe' } })
    } catch {
      writeStatus = 'full'
    }
  }

  const freeBytes = volumeFreeBytes()
  const outOfSpace = freeBytes !== null && freeBytes < MIN_FREE_BYTES
  const healthy = dbStatus === 'ok' && writeStatus === 'ok' && !outOfSpace

  return Response.json(
    {
      status: healthy ? 'ok' : 'degraded',
      service: 'toptier',
      db: dbStatus,
      dbWrite: writeStatus,
      disk: {
        freeBytes,
        freeMb: freeBytes === null ? null : Math.round(freeBytes / 1024 / 1024),
        minFreeMb: MIN_FREE_BYTES / 1024 / 1024,
      },
      timestamp: started.toISOString(),
    },
    { status: healthy ? 200 : 503 }
  )
}
