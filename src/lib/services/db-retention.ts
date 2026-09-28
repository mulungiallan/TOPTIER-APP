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

/** Filesystem headroom for the database file, in bytes (null if not a file URL). */
export function volumeFreeBytes(): number | null {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) return null;
  try {
    const stat = fs.statfsSync(path.dirname(path.resolve(url.replace(/^file:/, ""))));
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

/**
 * Run {@link pruneExpiredRows} and {@link checkpointWal} now, then on a timer.
 *
 * The interval is unref'd so it never holds the process open, and the work is
 * serialised with a re-entrancy guard because a slow prune must not stack up.
 */
export function startRetentionMonitor(intervalMs = 6 * 60 * 60 * 1000): void {
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await pruneExpiredRows();
      await checkpointWal();
    } catch {
      // Never let a maintenance failure surface as an unhandled rejection.
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}
