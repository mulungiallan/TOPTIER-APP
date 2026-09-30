/**
 * Automatic, off-volume backups of the SQLite database.
 *
 * WHY THIS EXISTS
 * ---------------
 * The database is a single file on a fixed-size volume. On 2026-09-30 that volume
 * filled up, and the automatic file-swap reclaim that used to run at boot
 * replaced the database with a compacted copy - destroying every user, wallet and
 * payment row, because the writes that had not yet been checkpointed lived only in
 * the -wal sidecar and the swap copied the main file alone.
 *
 * The lesson is not "be careful with the swap" (that swap is now disabled by
 * default). The lesson is that we had NO BACKUP, so a single bad automatic
 * operation was indistinguishable from a fatal incident. This is that backup.
 *
 * HOW IT WORKS
 * ------------
 * `VACUUM INTO` writes a consistent, defragmented copy of the whole database to a
 * path we choose. Two properties make it the right tool here:
 *
 *   1. It READS the source. A completely full live volume does not prevent a
 *      backup - only writing to the source would.
 *   2. The destination can be a DIFFERENT filesystem. Backups go to a dedicated
 *      volume mounted at /backups, never to the volume that fills up, because a
 *      backup on the same disk protects against nothing that matters.
 *
 * Every snapshot is verified by opening it and counting users before it is
 * trusted, and rotation is bounded by both a file count and a total size so the
 * backup volume cannot fill up either.
 */

import fs from "fs";
import path from "path";

import type { PrismaClient } from "@/generated/prisma";

/** How often to snapshot. */
const intervalMs = (): number => Number(process.env.DB_BACKUP_INTERVAL_HOURS ?? 6) * 60 * 60 * 1000;
/** How many snapshots to keep. Deliberately small: Railway permits one volume per
 *  service, so snapshots live on the same disk as the database and must stay a
 *  rounding error against it. */
const keep = (): number => Number(process.env.DB_BACKUP_KEEP ?? 5);
/** Hard ceiling on total snapshot bytes, so backups can never be what fills the
 *  volume. Overridden downward by a fraction of the volume in budgetBytes(). */
const maxTotalBytes = (): number => Number(process.env.DB_BACKUP_MAX_MB ?? 400) * 1024 * 1024;
/** Refuse to write a snapshot when the volume is this close to full. */
const MIN_FREE_BYTES = Number(process.env.DB_BACKUP_MIN_FREE_MB ?? 100) * 1024 * 1024;

const PREFIX = "toptier-";
const mb = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)}MB`;

function liveDbPath(): string | null {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) return null;
  return path.resolve(process.cwd(), url.replace(/^file:/, ""));
}

/**
 * Where snapshots go: a sibling of the live database, so it is on the data volume
 * without needing to be told where the volume is mounted.
 */
function backupDir(live: string): string {
  return process.env.DB_BACKUP_DIR ?? path.join(path.dirname(live), "backups");
}

/**
 * True when the directory sits on the container's own filesystem rather than the
 * mounted volume.
 *
 * This guard exists because the failure mode is silent. Writing to an unmounted
 * /backups succeeds, logs a healthy snapshot, and is erased by the next deploy -
 * so the app would look like it was backing up while holding nothing durable. A
 * different st_dev than the root filesystem means a real mount.
 */
function isEphemeral(dir: string): boolean {
  if (process.env.DB_BACKUP_ALLOW_EPHEMERAL === "1") return false;
  try {
    return fs.statSync(dir).dev === fs.statSync(path.parse(dir).root).dev;
  } catch {
    return false;
  }
}

function freeBytes(dir: string): number | null {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/** Snapshot budget: the smaller of the byte cap and a share of the volume. */
function budgetBytes(dir: string): number {
  const free = freeBytes(dir);
  if (free === null) return maxTotalBytes();
  return Math.min(maxTotalBytes(), Math.floor(free * 0.25));
}

function stamp(): string {
  // Lexicographically sortable, so rotation can sort by filename.
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function snapshots(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(PREFIX) && f.endsWith(".db"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Delete the oldest snapshots until both the count and the byte budget are met.
 *
 * Newest-last ordering means the tail is always the most recent, so trimming from
 * the front keeps the snapshots you would actually want.
 */
function rotate(dir: string): void {
  const files = snapshots(dir);
  const max = budgetBytes(dir);
  let total = files.reduce((sum, f) => sum + (fs.statSync(path.join(dir, f)).size || 0), 0);

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const survivors = files.length - i;
    if (survivors <= keep() && total <= max) break;
    const p = path.join(dir, f);
    try {
      total -= fs.statSync(p).size;
      fs.rmSync(p, { force: true });
      console.info(`[backup] rotated out ${f}`);
    } catch {
      /* a snapshot we cannot delete is not worth failing the backup over */
    }
  }
  console.info(`[backup] ${files.length} snapshots, ${mb(total)} total`);
}

export interface BackupResult {
  ok: boolean;
  reason: string;
  file?: string;
  bytes?: number;
  users?: number;
}

/**
 * Take one verified snapshot.
 *
 * Never throws: a backup failing must not disturb a running app.
 */
export async function runBackup(): Promise<BackupResult> {
  const live = liveDbPath();
  if (!live) return { ok: false, reason: "DATABASE_URL is not a file: URL" };
  if (!fs.existsSync(live)) return { ok: false, reason: `live database ${live} does not exist` };

  const dir = backupDir(live);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      reason: `backup dir ${dir} unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (isEphemeral(dir)) {
    return {
      ok: false,
      reason: `${dir} is on the container filesystem, not the data volume - snapshots there are erased on every deploy`,
    };
  }

  // The snapshot lands on the same volume as the database, so it must not be the
  // thing that fills it. Estimated from the live file, since SQLite cannot report
  // the compacted size before writing.
  const estimate = fs.statSync(live).size;
  const free = freeBytes(dir);
  if (free !== null && free - estimate < MIN_FREE_BYTES) {
    return { ok: false, reason: `only ${mb(free - estimate)} free, need ${mb(MIN_FREE_BYTES)}` };
  }

  const file = path.join(dir, `${PREFIX}${stamp()}.db`);
  const { PrismaClient: PrismaClientCtor } = await import("@/generated/prisma");

  let client: PrismaClient | undefined;
  try {
    client = new PrismaClientCtor();
    // VACUUM returns no rows, so $executeRawUnsafe is the correct call.
    await client.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  } catch (err) {
    fs.rmSync(file, { force: true });
    return {
      ok: false,
      reason: err instanceof Error ? err.message.split("\n")[0] : String(err),
    };
  } finally {
    await client?.$disconnect().catch(() => {});
  }

  // Trust nothing: prove the snapshot opens and contains the rows we care about
  // before counting it as a backup. A snapshot that cannot be read is worthless
  // precisely when it is needed.
  let users = 0;
  let checker: PrismaClient | undefined;
  try {
    checker = new PrismaClientCtor({ datasources: { db: { url: `file:${file}` } } });
    users = await checker.user.count();
  } catch (err) {
    fs.rmSync(file, { force: true });
    return {
      ok: false,
      reason: `snapshot unreadable: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
    };
  } finally {
    await checker?.$disconnect().catch(() => {});
  }

  const bytes = fs.statSync(file).size;
  console.warn(`[backup] wrote ${path.basename(file)} (${mb(bytes)}, ${users} users) to ${dir}`);
  rotate(dir);
  return { ok: true, reason: "ok", file, bytes, users };
}

/**
 * Snapshot now, then keep doing it on a timer.
 *
 * The first run is immediate: a backup service that has never run is not a
 * backup service, and the moment you most want a snapshot is the moment right
 * after you deploy one.
 */
export function startBackupMonitor(ms = intervalMs()): void {
  let running = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await runBackup();
      if (!result.ok) console.warn(`[backup] skipped: ${result.reason}`);
    } catch (err) {
      console.warn("[backup] failed:", err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), Math.max(ms, 60 * 1000));
  if (typeof timer.unref === "function") timer.unref();
}
