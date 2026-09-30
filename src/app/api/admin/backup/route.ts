import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { errorResponse } from '@/lib/auth'
import { runBackup } from '@/lib/services/db-backup'

export const dynamic = 'force-dynamic'
// SQLite cannot VACUUM INTO a path that already exists, and the snapshot is read
// straight back to the client, so this must not be cached or prefetched.
export const revalidate = 0

/**
 * GET /api/admin/backup
 *
 * Downloads a verified snapshot of the whole database.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-30 a full volume triggered an automatic file swap that installed a
 * compacted copy of the database whose recent writes were still only in the -wal
 * sidecar. Every user, wallet and payment row was destroyed, and because the
 * snapshot lived on the same volume as the database and Railway allows only one
 * volume per service, there was nowhere else to look. Recovery became impossible.
 *
 * Retention and automatic snapshots keep writes alive and bound disk growth, but
 * neither moves a byte off the machine. This does: it is the difference between
 * "we lost the database" and "we download it".
 *
 * Safety properties:
 *   - Admin-only (requireAdmin), so the user table cannot be bulk-exported.
 *   - The snapshot is produced by runBackup(), which reopens the file and counts
 *     users before trusting it. A corrupt file is deleted rather than served.
 *   - GET has no side effect on the live database: VACUUM INTO only reads it.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request)
  if (error) return error

  const result = await runBackup()
  if (!result.ok || !result.file) {
    return errorResponse(`Backup failed: ${result.reason}`, 500)
  }

  try {
    const { readFile } = await import('node:fs/promises')
    const data = await readFile(result.file)

    const stamp = result.file.split('/').pop()?.replace(/\.db$/, '') ?? 'toptier'
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${stamp}.db"`,
        'Content-Length': String(data.byteLength),
        // The snapshot contains password hashes, wallet balances and transaction
        // history. It must not sit in a shared cache or be sniffed.
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
        'X-Backup-Users': String(result.users ?? ''),
      },
    })
  } catch (err) {
    return errorResponse(`Failed to read snapshot: ${(err as Error).message}`, 500)
  }
}
