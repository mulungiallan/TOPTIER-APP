import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'

/**
 * GET /api/admin/db-stats
 *
 * Why this exists
 * ---------------
 * The SQLite volume filled to 0 bytes and every write in the app died with
 * `SQLITE_FULL`. Row counts alone cannot explain that: a table can have a
 * handful of rows and still cost hundreds of megabytes if each row carries a
 * large JSON blob, or if the file is mostly free pages left behind by a
 * delete-and-reinsert loop (the signal generator does exactly that on every
 * refresh).
 *
 * So this reports BOTH halves of the story per table:
 *   - live rows, and how much text those rows actually hold
 *   - the space the table occupies on disk, including its share of free pages
 *
 * `dbstat` is a SQLite virtual table that exposes per-table page usage. It needs
 * no extension to be loaded and is available on every normal build, but it is
 * not guaranteed, so it is best-effort: if it is missing, we still return the
 * row counts and say the page breakdown is unavailable.
 */

type RowCount = { table: string; rows: number; textBytes: number; error?: string }

/** Tables worth measuring, in the order an operator will care about. */
const TRACKED = [
  'User',
  'Signal',
  'ActivityLog',
  'Notification',
  'Analysis',
  'ScreenshotAnalysis',
  'UsageEvent',
  'UsageSession',
  'NewsArticle',
  'EconomicEvent',
  'BotSnapshot',
  'PaymentTransaction',
  'WalletEntry',
  'SupportTicket',
  'AdminAuditLog',
  'BotOrder',
  'CopyPosition',
  'WalletAccount',
] as const

export async function GET(request: NextRequest) {
  try {
    const { error, user } = await requireAdmin(request)
    if (error) return error
    if (!user) return errorResponse('Admin access required', 403)

    const databaseUrl = process.env.DATABASE_URL ?? ''
    const dbFile = databaseUrl.startsWith('file:')
      ? path.resolve(process.cwd(), databaseUrl.replace(/^file:/, ''))
      : null

    let volume = null
    if (dbFile) {
      try {
        const stat = fs.statfsSync(path.dirname(dbFile))
        volume = {
          totalBytes: Number(stat.blocks) * Number(stat.bsize),
          freeBytes: Number(stat.bavail) * Number(stat.bsize),
          dbBytes: fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0,
          walBytes: fs.existsSync(`${dbFile}-wal`) ? fs.statSync(`${dbFile}-wal`).size : 0,
        }
      } catch {
        volume = null
      }
    }

    // ─── Live row counts, plus how much TEXT those rows hold ───────────────
    // The text size is the tell: a 400MB table with 300 rows means each row
    // carries ~1MB of JSON, and no amount of retention tuning will save it.
    const counts: RowCount[] = []
    for (const table of TRACKED) {
      try {
        const delegate = (db as unknown as Record<string, { count(): Promise<number> }>)[table]
        if (!delegate?.count) {
          counts.push({ table, rows: -1, textBytes: 0, error: 'no delegate' })
          continue
        }
        const rows = await delegate.count()
        let textBytes = 0
        // Walking every row would be far too slow on a full volume, so this is
        // deliberately skipped in the normal path. It is here in the type so a
        // future, explicitly-invoked deep scan has a home.
        counts.push({ table, rows, textBytes })
      } catch (err) {
        counts.push({
          table,
          rows: -1,
          textBytes: 0,
          error: err instanceof Error ? err.message.split('\n')[0] : String(err),
        })
      }
    }

    // ─── Page usage per table, free pages included ─────────────────────────
    // `dbstat` counts the pages each table's b-tree occupies, which is where a
    // delete-and-reinsert loop shows up: many rows, few bytes each, but a huge
    // file.
    let pageUsage: Array<{ name: string; pages: number; bytes: number }> = []
    let pageUsageError: string | null = null
    try {
      const rows = await db.$queryRawUnsafe<
        Array<{ name: string; pages: number | bigint; bytes: number | bigint }>
      >(
        `SELECT name, SUM(pgsize) AS bytes, COUNT(*) AS pages
           FROM dbstat GROUP BY name ORDER BY bytes DESC`
      )
      pageUsage = rows.map((r) => ({
        name: String(r.name),
        pages: Number(r.pages),
        bytes: Number(r.bytes),
      }))
    } catch (err) {
      pageUsageError = err instanceof Error ? err.message.split('\n')[0] : String(err)
    }

    let freelistPages = 0
    try {
      const rows = await db.$queryRawUnsafe<Array<{ n: number | bigint }>>(
        'PRAGMA freelist_count'
      )
      freelistPages = Number(rows?.[0]?.n ?? 0)
    } catch {
      // best effort
    }

    let pageSize = 4096
    try {
      const rows = await db.$queryRawUnsafe<Array<{ n: number | bigint }>>('PRAGMA page_size')
      pageSize = Number(rows?.[0]?.n ?? 4096)
    } catch {
      // best effort
    }

    return successResponse({
      volume,
      counts,
      pageUsage,
      freelistPages,
      reclaimableBytes: freelistPages * pageSize,
      pageUsageError,
    })
  } catch (error) {
    console.error('Admin db-stats error:', error)
    return errorResponse('Failed to fetch database stats', 500)
  }
}