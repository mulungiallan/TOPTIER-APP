// Boot-time disk-space reclaim for the SQLite volume.
//
// WHY THIS EXISTS
// ---------------
// The database lives on a fixed-size Railway volume (`file:/data/db/custom.db`)
// and SQLite NEVER gives space back on its own: deleting rows frees pages
// *inside* the file, but the file keeps its size. Meanwhile the background
// signal generator rewrites rows on every refresh and several tables (Signal,
// Notification, ActivityLog, ...) have no retention policy, so the file grows
// until every write fails with `SQLITE_FULL` ("database or disk is full").
//
// When that happened EVERY write path died at once - login and signup (the
// ActivityLog row at the end of /api/auth), the screenshot analyser, and the
// signal generator - so the whole app looked broken while /api/health still
// answered "ok", because a read-only `SELECT 1` works fine on a full disk.
//
// WHAT IT DOES
// ------------
//   1. Prunes unbounded tables by age. Money/user tables are never touched.
//   2. If that is not enough, prunes again with a much tighter window, so a
//      runaway table cannot keep the service down between deploys.
//   3. Checkpoints the WAL, which is often tens of MB on its own.
//   4. Reclaims free pages: deleting shrinks the *content* but not the *file*,
//      so we VACUUM into the container's ephemeral disk (always plenty of room,
//      unlike the volume) and swap the compacted file back in - but only after
//      verifying the copy, and only when it actually fits.
//
// Every step is guarded: on any error it logs and continues, because a space
// problem must never stop the app from booting.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { PrismaClient } = require('../src/generated/prisma')

const DATABASE_URL = process.env.DATABASE_URL || ''
const DB_PATH = DATABASE_URL.startsWith('file:')
  ? path.resolve(process.cwd(), DATABASE_URL.replace(/^file:/, ''))
  : null
const SCRATCH = path.join(os.tmpdir(), `compact-${process.pid}.db`)

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n) => new Date(Date.now() - n * DAY)
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`

/** Target: leave this much headroom so this cannot recur tomorrow. */
const TARGET_FREE_BYTES = 100 * 1024 * 1024
/** Below this main-file size a VACUUM rewrite costs more than it saves. */
const COMPACT_MIN_BYTES = Number(process.env.DB_COMPACT_MIN_BYTES || 64 * 1024 * 1024)

/**
 * Normal retention: table -> max age in days. Only append-only, high-churn
 * tables belong here - anything holding money, entitlements or user identity is
 * intentionally absent. Overridable per environment.
 */
const RETENTION = {
  signal: Number(process.env.SIGNAL_RETENTION_DAYS || 30),
  notification: Number(process.env.NOTIFICATION_RETENTION_DAYS || 30),
  activityLog: Number(process.env.ACTIVITY_LOG_RETENTION_DAYS || 14),
  usageEvent: 60,
  usageSession: 60,
  screenshotAnalysis: 2, // analysis-cleanup.ts already purges these hourly
  newsArticle: 30,
  economicEvent: 90,
  botSnapshot: 30,
  adminAuditLog: 90,
}

/**
 * Last-resort pass, used only when the normal one leaves the volume short.
 * These windows are short enough to bound the table hard while still leaving
 * the app usable (the Signals feed keeps a week, notifications a few days).
 */
const AGGRESSIVE = {
  signal: 7,
  notification: 5,
  activityLog: 2,
  usageEvent: 14,
  usageSession: 14,
  newsArticle: 7,
  economicEvent: 30,
  botSnapshot: 7,
  screenshotAnalysis: 1,
}

function diskInfo() {
  try {
    const stat = fs.statfsSync(path.dirname(DB_PATH))
    return {
      total: Number(stat.blocks) * Number(stat.bsize),
      free: Number(stat.bavail) * Number(stat.bsize),
    }
  } catch {
    return null
  }
}

function fileSizes() {
  try {
    const main = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0
    const wal = fs.existsSync(`${DB_PATH}-wal`) ? fs.statSync(`${DB_PATH}-wal`).size : 0
    return { main, wal, total: main + wal }
  } catch {
    return null
  }
}

/**
 * Delete rows older than each cutoff, logging a row count per table first.
 *
 * The counts go to the log on purpose: when the disk fills, the size of the
 * table that did it is the only way to find the actual leak, and this is the
 * one place that sees every table's row count at once.
 */
async function prune(prisma, windows, label) {
  let total = 0
  for (const [model, days] of Object.entries(windows)) {
    try {
      const delegate = prisma[model]
      const rows = await delegate.count()
      const { count } = await delegate.deleteMany({
        where: { createdAt: { lt: daysAgo(days) } },
      })
      if (rows > 0) console.log(`[ensure-space] ${label} ${model}: ${rows} rows total`)
      if (count > 0) {
        total += count
        console.log(`[ensure-space] ${label} deleted ${count} ${model} rows older than ${days}d`)
      }
    } catch (err) {
      // A missing model or column must not abort the rest of the reclaim.
      console.warn(`[ensure-space] skip ${model}:`, err?.message?.split('\n')[0])
    }
  }
  return total
}

/**
 * Move the free pages out of the file.
 *
 * `VACUUM` in place would need room for a full second copy of the database,
 * which is exactly what we do not have. `VACUUM INTO` writes the compacted copy
 * to the container's ephemeral disk instead, so only the FINAL compacted file
 * has to fit on the volume - and it always does, because the original is moved
 * aside (a free, space-freeing rename) before the copy lands. The installed file
 * is verified as a working database before the backup is dropped, and every
 * failure path restores the original untouched.
 */
async function compact() {
  const before = fileSizes()
  if (!before) return false

  // Already small enough: a VACUUM rewrite would cost more than it saves.
  if (before.main < COMPACT_MIN_BYTES) {
    console.log(`[ensure-space] db ${mb(before.main)} (wal ${mb(before.wal)}), no compact needed`)
    return false
  }

  try {
    fs.rmSync(SCRATCH, { force: true })
    // Own connection, disconnected immediately: the swap below replaces the file
    // this handle is open on, and the script must not hold it open afterwards.
    const vacuumer = new PrismaClient()
    try {
      await vacuumer.$executeRawUnsafe(`VACUUM INTO '${SCRATCH.replace(/'/g, "''")}'`)
    } finally {
      await vacuumer.$disconnect().catch(() => {})
    }
  } catch (err) {
    console.warn('[ensure-space] compact skipped:', err?.message?.split('\n')[0])
    fs.rmSync(SCRATCH, { force: true })
    return false
  }

  const compactSize = fs.statSync(SCRATCH).size

  // A compaction that did not shrink the file frees nothing, and installing it
  // would be pure risk. A volume that is full of live rows (not free pages)
  // needs a bigger volume, not another VACUUM.
  if (compactSize >= before.main) {
    console.warn(
      `[ensure-space] compacted copy is not smaller (${mb(compactSize)} vs ${mb(before.main)}) - ` +
        'the database holds live data, not free pages; skipping and telling the operator'
    )
    fs.rmSync(SCRATCH, { force: true })
    return false
  }

  // ─── Step 1: park the original (same-fs rename: frees space, copies nothing) ──
  // ORDER IS THE WHOLE POINT. The compacted copy has to land on a volume with no
  // free bytes left, so the old file must be moved aside FIRST: a rename inside
  // one filesystem consumes no space and instantly releases the old file's
  // bytes, which is what makes room for the copy. Copying first - as this used
  // to - required compactSize free bytes before it had freed anything, so on a
  // full volume it could never run, the volume stayed full across every boot,
  // and every write in the app kept failing with SQLITE_FULL.
  const aside = `${DB_PATH}.reclaim-old`
  try {
    fs.rmSync(aside, { force: true })
    fs.renameSync(DB_PATH, aside)
    // The sidecars belong to the old inode. A stale -wal replayed onto the new,
    // differently-shaped file would corrupt it, so they go with it.
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${DB_PATH}${suffix}`, { force: true })
  } catch (err) {
    console.warn('[ensure-space] could not set the old database aside:', err?.message?.split('\n')[0])
    fs.rmSync(SCRATCH, { force: true })
    return false
  }

  const restore = (why) => {
    console.warn(`[ensure-space] ${why} - restoring the original database`)
    try {
      fs.rmSync(DB_PATH, { force: true })
      fs.renameSync(aside, DB_PATH)
    } catch (err) {
      console.error(
        `[ensure-space] RESTORE FAILED - the original is parked at ${aside}:`,
        err?.message?.split('\n')[0]
      )
    }
    fs.rmSync(SCRATCH, { force: true })
    return false
  }

  // ─── Step 2: install the compacted copy into the space we just freed ──────
  try {
    fs.copyFileSync(SCRATCH, DB_PATH)
  } catch (err) {
    return restore(`install failed (${err?.message?.split('\n')[0]})`)
  }

  // ─── Step 3: prove the INSTALLED file works, then drop the backup ────────
  // Verify what actually landed, not what we intended to land.
  try {
    const check = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } })
    try {
      await check.$queryRawUnsafe('SELECT COUNT(*) FROM "User"')
    } finally {
      await check.$disconnect().catch(() => {})
    }
  } catch (err) {
    return restore(`installed database failed verification (${err?.message?.split('\n')[0]})`)
  }

  fs.rmSync(aside, { force: true })
  fs.rmSync(SCRATCH, { force: true })
  console.log(`[ensure-space] compacted db ${mb(before.main)} -> ${mb(compactSize)}`)
  return true
}

async function main() {
  if (!DB_PATH) {
    console.log('[ensure-space] DATABASE_URL is not a file: URL, skipping')
    return
  }
  const disk = diskInfo()
  const sizes = fileSizes()
  console.log(
    `[ensure-space] volume ${disk ? `${mb(disk.free)} free of ${mb(disk.total)}` : 'unknown'}, ` +
      `db ${sizes ? `${mb(sizes.main)} + wal ${mb(sizes.wal)}` : 'unknown'}`
  )

  const prisma = new PrismaClient()
  try {
    const pruned = await prune(prisma, RETENTION, 'pass1')
    if (pruned > 0) console.log(`[ensure-space] pass1 pruned ${pruned} rows total`)

    // Fold the WAL back into the database and truncate it. This alone usually
    // returns tens of MB, because the -wal file grows until a checkpoint runs.
    try {
      await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch (err) {
      console.warn('[ensure-space] wal checkpoint:', err?.message?.split('\n')[0])
    }

    // Still short? Cut much harder. Without this a single runaway table can keep
    // the service down for everyone, and the normal window is sized for
    // convenience rather than for emergencies.
    const afterPrune = diskInfo()?.free ?? 0
    if (afterPrune < TARGET_FREE_BYTES) {
      console.log('[ensure-space] still short after pass1, running aggressive prune')
      const hard = await prune(prisma, AGGRESSIVE, 'pass2')
      if (hard > 0) console.log(`[ensure-space] pass2 pruned ${hard} rows total`)
      try {
        await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)')
      } catch {
        /* already logged above if it fails */
      }
    }
  } catch (err) {
    console.warn('[ensure-space] reclaim failed (continuing):', err?.message?.split('\n')[0])
  } finally {
    // Disconnect BEFORE compacting: the swap replaces the file this connection
    // has open, and a stale handle would write to the unlinked inode.
    await prisma.$disconnect().catch(() => {})
  }

  try {
    await compact()
  } catch (err) {
    console.warn('[ensure-space] compact failed (continuing):', err?.message?.split('\n')[0])
  }

  const after = fileSizes()
  const afterDisk = diskInfo()
  console.log(
    `[ensure-space] done: db ${after ? mb(after.main) : '?'} + wal ${after ? mb(after.wal) : '?'}, ` +
      `volume ${afterDisk ? mb(afterDisk.free) : '?'} free`
  )
  if (afterDisk && afterDisk.free < TARGET_FREE_BYTES) {
    console.warn(
      '[ensure-space] WARNING: volume is still short of target - raise the volume size ' +
        'or find the table growing fastest (counts above)'
    )
  }
}

main().catch((err) => console.warn('[ensure-space] unexpected:', err?.message))
