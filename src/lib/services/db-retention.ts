/**
 * Retention pruning for the append-only, high-churn tables.
 *
 * The app runs on a single fixed-size SQLite file, and SQLite never shrinks a
 * file on its own - deleting rows frees pages inside the file, not the file
 * itself. Tables that are rewritten on every background refresh (Signal) or
 * appended to without limit (Notification, ActivityLog, ...) therefore grow the
 * database until every write fails with `SQLITE_FULL`, which takes down login,
 * the screenshot analyser and signal generation all at once.
 *
 * `scripts/ensure-space.js` reclaims space at BOOT. This module keeps the
 * database from refilling in between, by running the same age-based cuts on a
 * timer. Both read their cutoffs from the same env vars, so an environment can
 * loosen them without a code change.
 *
 * Money and identity tables are deliberately absent: nothing here may ever
 * delete a wallet entry, a payment, a subscription, or a user.
 */

import fs from "fs";
import path from "path";

import { db } from "@/lib/db";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Table -> max age in days. Kept deliberately generous: this is about bounding
 * growth, not about keeping a minimal database.
 */
export const RETENTION_DAYS = {
  // The signal generator rewrites these on every pass; a few weeks of history
  // is all the feed and the outcome tracking need.
  signal: num(process.env.SIGNAL_RETENTION_DAYS, 30),
  notification: num(process.env.NOTIFICATION_RETENTION_DAYS, 30),
  activityLog: num(process.env.ACTIVITY_LOG_RETENTION_DAYS, 14),
  usageEvent: 60,
  usageSession: 60,
  // analysis-cleanup.ts already purges these after an hour; this is a backstop
  // for records written while that job was failing (e.g. on a full disk).
  screenshotAnalysis: 2,
  newsArticle: 30,
  economicEvent: 90,
  botSnapshot: 30,
  adminAuditLog: 90,
} as const;

export type RetainedModel = keyof typeof RETENTION_DAYS;

export interface PruneResult {
  model: RetainedModel;
  deleted: number;
}

/**
 * Delete rows older than each table's cutoff.
 *
 * Every model is attempted independently and failures are swallowed: a missing
 * table or a locked database must not stop the other cuts, and this runs from a
 * timer where an unhandled rejection would be invisible.
 */
/** The slice of a Prisma model delegate that pruning needs. */
interface Deletable {
  deleteMany(args: { where: { createdAt: { lt: Date } } }): Promise<{ count: number }>;
}

export async function pruneExpiredRows(): Promise<PruneResult[]> {
  const results: PruneResult[] = [];
  for (const [model, days] of Object.entries(RETENTION_DAYS) as [RetainedModel, number][]) {
    try {
      // The delegates have per-model arg types, so a union of them is not
      // callable; every cut uses the same where-clause shape, so narrow to it.
      const delegate = db[model] as unknown as Deletable;
      const { count } = await delegate.deleteMany({ where: { createdAt: { lt: daysAgo(days) } } });
      if (count > 0) results.push({ model, deleted: count });
    } catch {
      // Intentionally ignored - see the note above.
    }
  }
  if (results.length > 0) {
    const total = results.reduce((sum, r) => sum + r.deleted, 0);
    console.info(
      `[retention] pruned ${total} rows: ` +
        results.map((r) => `${r.model}=${r.deleted}`).join(", ")
    );
  }
  return results;
}

/**
 * Fold the write-ahead log back into the main database file. A passive
 * checkpoint never blocks writers, and it is what stops the `-wal` sidecar from
 * growing to tens of MB between restarts.
 */
export async function checkpointWal(): Promise<void> {
  try {
    // $queryRaw, not $executeRaw: PRAGMA wal_checkpoint returns a row, and
    // $executeRawUnsafe rejects any statement that does ("Execute returned
    // results, which is not allowed in SQLite"), so this call would always throw.
    await db.$queryRawUnsafe("PRAGMA wal_checkpoint(PASSIVE)");
  } catch {
    // Not fatal: the WAL is reclaimed on the next successful checkpoint.
  }
}

/** Target: leave this much headroom so this cannot recur tomorrow. */
export const TARGET_FREE_BYTES = 100 * 1024 * 1024

/**
 * Emergency windows, used when the volume is (nearly) full. Deliberately brutal:
 * reaching a write-capable database matters more than keeping a month of signal
 * history, and the normal pass keeps the last 30 days of everything.
 */
const EMERGENCY_DAYS = {
  signal: 3,
  notification: 2,
  activityLog: 1,
  usageEvent: 7,
  usageSession: 7,
  screenshotAnalysis: 1,
  newsArticle: 3,
  economicEvent: 30,
  botSnapshot: 3,
  adminAuditLog: 30,
};

export function freeBytes(): number | null {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) return null;
  try {
    const stat = fs.statfsSync(path.dirname(path.resolve(url.replace(/^file:/, ""))));
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

/** Filesystem headroom for the database file, in bytes (null if not a file URL). */
export function volumeFreeBytes(): number | null {
  return freeBytes();
}

/**
 * Reclaim space right now, as hard as needed, without touching the database
 * FILE itself.
 *
 * This is the emergency path, and it deliberately avoids VACUUM: swapping the
 * database file is only safe from a boot script, never from inside a running
 * server that already has the file open. Deleting rows is enough to unbreak
 * writes, because SQLite reuses the freed pages in place - the file keeps its
 * size but stops needing to grow, which is the only thing failing on a full
 * volume.
 */
export async function reclaimNow(): Promise<{ deleted: number; free: number | null }> {
  let deleted = 0;

  const free = freeBytes();
  if (free !== null && free < TARGET_FREE_BYTES) {
    console.warn(
      `[retention] volume is short of target (${Math.round(free / 1024 / 1024)}MB free), ` +
        "running emergency prune"
    );
    for (const [model, days] of Object.entries(EMERGENCY_DAYS) as [RetainedModel, number][]) {
      deleted += await deleteOlderThan(model, days);
    }
  } else {
    deleted = await pruneExpiredRows().then((r) => r.reduce((s, x) => s + x.deleted, 0));
  }

  await checkpointWal();
  const after = freeBytes();
  console.info(
    `[retention] reclaimed ${deleted} rows, ` +
      `${after === null ? "?" : Math.round(after / 1024 / 1024)}MB free`
  );
  return { deleted, free: after };
}

async function deleteOlderThan(model: RetainedModel, days: number): Promise<number> {
  try {
    const delegate = db[model] as unknown as Deletable;
    const { count } = await delegate.deleteMany({
      where: { createdAt: { lt: daysAgo(days) } },
    });
    if (count > 0) console.info(`[retention] emergency: deleted ${count} ${model} older than ${days}d`);
    return count;
  } catch {
    return 0;
  }
}

/**
 * Reclaim space at boot, then keep it bounded.
 *
 * Runs {@link reclaimNow} immediately - the volume is often already full when
 * the process starts, and every background writer that starts before the reclaim
 * will fail. After that it re-checks on a timer, retrying sooner than the normal
 * interval while the volume is still short, since that is the state where the
 * app is broken.
 */
export function startRetentionMonitor(intervalMs = 6 * 60 * 60 * 1000): void {
  let running = false;
  let retryMs = intervalMs;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await reclaimNow();
      const free = freeBytes();
      retryMs = free !== null && free < TARGET_FREE_BYTES ? 15 * 60 * 1000 : intervalMs;
    } catch {
      retryMs = 15 * 60 * 1000;
    } finally {
      running = false;
      schedule();
    }
  };

  // Declared as a function so the first run can reschedule itself immediately.
  let timer: ReturnType<typeof setInterval> | undefined;
  const schedule = (): void => {
    if (timer) clearInterval(timer);
    timer = setTimeout(() => void run(), retryMs);
    if (typeof timer.unref === "function") timer.unref();
  };

  void run();
}
