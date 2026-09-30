/**
 * Boot-time file reclaim for the SQLite database.
 *
 * Why this exists
 * ---------------
 * The database is one file on a fixed-size volume. Deleting rows frees pages
 * INSIDE the file but never frees filesystem space, so on a completely full
 * volume every write fails with `SQLITE_FULL` and nothing in the app can save
 * itself: login, signup, the screenshot analyser and signal generation all die
 * on their first write. Deleting the -wal sidecar is not safe either - it holds
 * transactions that were committed but not yet checkpointed.
 *
 * The only thing that actually gives bytes back is replacing the file with a
 * compacted copy: `VACUUM INTO` writes a fresh, defragmented database to the
 * container's ephemeral disk, and only the final compacted file has to fit on
 * the volume.
 *
 * Why it is safe here
 * -------------------
 * This runs as the FIRST thing in instrumentation, before any Prisma query has
 * been issued in this process, so nothing holds the old file open. Deleting the
 * original and installing the copy happens in ONE shell invocation, so the
 * window in which neither file is present is a single batch of syscalls, and
 * the compacted copy is verified as a working database BEFORE the original is
 * touched. Every failure path leaves the original file exactly as it was.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import type { PrismaClient } from "@/generated/prisma";

/** Only reclaim when the volume is at or below this. */
const TRIGGER_FREE_BYTES = 60 * 1024 * 1024;
/** Headroom we would like to end up with. */
const TARGET_FREE_BYTES = 120 * 1024 * 1024;

const mb = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)}MB`;

function dbPath(): string | null {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) return null;
  return path.resolve(process.cwd(), url.replace(/^file:/, ""));
}

function freeBytes(target: string): number | null {
  try {
    const stat = fs.statfsSync(path.dirname(target));
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

/** Opens `file` with a throwaway client to prove it is a usable database. */
async function verify(
  PrismaClientCtor: typeof PrismaClient,
  file: string
): Promise<{ ok: boolean; detail: string }> {
  let client: PrismaClient | undefined;
  try {
    client = new PrismaClientCtor({ datasources: { db: { url: `file:${file}` } } });
    const users = await client.user.count();
    return { ok: true, detail: `${users} users` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  } finally {
    await client?.$disconnect().catch(() => {});
  }
}

/**
 * Log what is actually occupying the database file.
 *
 * Row counts are not enough to explain a full volume: a table can hold three
 * rows and still cost 300MB if each row carries a large JSON blob, and a
 * delete-and-reinsert loop leaves a huge file full of free pages with almost no
 * live data. `dbstat` exposes per-table page usage, which separates those two
 * cases immediately. This runs only when the volume is already in trouble, so
 * the cost is irrelevant and the answer is in the boot log.
 */
async function logPageUsage(PrismaClientCtor: typeof PrismaClient, target: string): Promise<void> {
  try {
    const client = new PrismaClientCtor({ datasources: { db: { url: `file:${target}` } } });
    try {
      const rows = await client.$queryRawUnsafe<Array<{ name: string; bytes: number | bigint }>>(
        "SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 12"
      );
      const freelist = await client.$queryRawUnsafe<Array<{ n: number | bigint }>>(
        "PRAGMA freelist_count"
      );
      const free = Number(freelist?.[0]?.n ?? 0);
      const shown = rows
        .map((r) => `${r.name}=${mb(Number(r.bytes))}`)
        .join(" ");
      console.warn(`[reclaim] page usage: ${shown || "(unavailable)"}`);
      console.warn(`[reclaim] free pages: ${free} (${mb(free * 4096)} reclaimable by VACUUM)`);
    } finally {
      await client.$disconnect().catch(() => {});
    }
  } catch (err) {
    console.warn(
      "[reclaim] page usage unavailable:",
      err instanceof Error ? err.message.split("\n")[0] : String(err)
    );
  }
}

/**
 * Prune a COPY of the database on the container's ephemeral disk, then compact
 * that copy.
 *
 * Why the prune cannot happen in place
 * ------------------------------------
 * Deleting rows in place on a 100% full volume is impossible: SQLite has to
 * journal the delete transaction, and there is nowhere to put those journal
 * pages. Observed exactly that - the boot retention pass reported
 * "notification trim skipped" and "reclaimed 0 rows" against a volume with 20KB
 * free, then VACUUM faithfully reproduced a 423MB copy that could not be
 * installed, so the volume stayed full across every deploy.
 *
 * So when the volume is full the whole job moves to `/tmp`, which is not the
 * full volume: copy the file out, prune the copy, VACUUM the copy. Only the
 * final compacted copy - small, because the prune already removed the bulk -
 * ever has to fit on the volume.
 */
async function pruneAndCompactOffVolume(
  PrismaClientCtor: typeof PrismaClient,
  target: string,
  scratch: string
): Promise<boolean> {
  const working = path.join(os.tmpdir(), `toptier-prune-${process.pid}.db`);
  fs.rmSync(working, { force: true });

  console.warn("[reclaim] volume is completely full: pruning a copy in ephemeral storage");
  try {
    fs.copyFileSync(target, working);
  } catch (err) {
    console.warn(
      "[reclaim] could not copy the database out for pruning:",
      err instanceof Error ? err.message.split("\n")[0] : String(err)
    );
    return false;
  }

  let client: PrismaClient | undefined;
  try {
    client = new PrismaClientCtor({ datasources: { db: { url: `file:${working}` } } });

    // Best effort: fold any committed-but-uncheckpointed WAL frames into the
    // copy so recent rows are not lost when the -wal sidecar is dropped.
    await client.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)").catch(() => {});

    const { pruneNotificationsWith } = await import("./db-retention");
    const deleted = await pruneNotificationsWith(client);
    console.warn(`[reclaim] pruned ${deleted} notification rows off-volume`);

    await client.$executeRawUnsafe(`VACUUM INTO '${scratch.replace(/'/g, "''")}'`);
  } catch (err) {
    console.warn(
      "[reclaim] off-volume prune/compact failed:",
      err instanceof Error ? err.message.split("\n")[0] : String(err)
    );
    return false;
  } finally {
    await client?.$disconnect().catch(() => {});
    fs.rmSync(working, { force: true });
  }

  return fs.existsSync(scratch);
}

/**
 * Log the raw volume numbers, not just a derived "MB free".
 *
 * `cp` failing with ENOSPC after the original 423MB database was parked aside
 * cannot be explained by bytes alone - parking it should have left ~423MB free.
 * `ENOSPC` is also what a filesystem returns when it has run out of INODES, and
 * a volume with a small inode table reports plenty of free bytes while refusing
 * to create a single new file. `statfs` exposes both (`blocks`/`bavail` and
 * `files`/`ffree`), so print all of them plus the directory listing and let the
 * log settle which one it is.
 */
function logVolumeDetail(target: string): void {
  try {
    const stat = fs.statfsSync(path.dirname(target));
    const total = Number(stat.blocks) * Number(stat.bsize);
    const avail = Number(stat.bavail) * Number(stat.bsize);
    const inodes = Number(stat.files);
    const inodesFree = Number(stat.ffree);
    console.warn(
      `[reclaim] volume raw: ${mb(total)} total, ${mb(avail)} avail, ` +
        `bsize ${stat.bsize}, inodes ${inodes} total / ${inodesFree} free`
    );
  } catch (err) {
    console.warn("[reclaim] volume raw unavailable:", err instanceof Error ? err.message : String(err));
  }

  try {
    const dir = path.dirname(target);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const listing = entries
      .map((e) => {
        if (!e.isFile()) return `${e.name}/`;
        try {
          return `${e.name}=${mb(fs.statSync(path.join(dir, e.name)).size)}`;
        } catch {
          return `${e.name}=?`;
        }
      })
      .join(" ");
    console.warn(`[reclaim] ${dir}: ${entries.length} entries | ${listing}`);
  } catch (err) {
    console.warn("[reclaim] directory listing unavailable:", err instanceof Error ? err.message : String(err));
  }
}

export interface ReclaimResult {
  ran: boolean;
  reason: string;
  beforeBytes?: number;
  afterBytes?: number;
}

/**
 * Replace the database file with a compacted copy when the volume is full.
 *
 * A no-op when the database is on a non-file URL, when there is already enough
 * free space, or when any step cannot be completed safely.
 */
export async function reclaimDatabaseFile(): Promise<ReclaimResult> {
  const target = dbPath();
  if (!target || !fs.existsSync(target)) return { ran: false, reason: "no database file" };

  const free = freeBytes(target);
  if (free === null) return { ran: false, reason: "cannot stat volume" };
  if (free >= TRIGGER_FREE_BYTES) return { ran: false, reason: `${mb(free)} free, above trigger` };

  const before = fs.statSync(target).size;
  const scratch = path.join(os.tmpdir(), `toptier-reclaim-${process.pid}.db`);

  const { PrismaClient: PrismaClientCtor } = await import("@/generated/prisma");

  console.warn(`[reclaim] volume is full (${mb(free)} free, db ${mb(before)}), compacting`);
  logVolumeDetail(target);
  await logPageUsage(PrismaClientCtor, target);
  fs.rmSync(scratch, { force: true });

  const completelyFull = free < 8 * 1024 * 1024;
  let produced = false;

  if (completelyFull) {
    // Nothing can be journalled in place at 0 free, so prune and compact on the
    // container's ephemeral disk instead.
    produced = await pruneAndCompactOffVolume(PrismaClientCtor, target, scratch);
    if (!produced) {
      console.warn("[reclaim] off-volume route produced nothing, trying an in-place VACUUM");
    }
  }

  if (!produced) {
    // VACUUM returns no rows, so this is the correct raw call. The output goes to
    // the container's ephemeral disk, which is not the full volume, so this can
    // succeed when the volume cannot fit a second copy of the database.
    let vacuumer: PrismaClient | undefined;
    try {
      vacuumer = new PrismaClientCtor({ datasources: { db: { url: `file:${target}` } } });
      await vacuumer.$executeRawUnsafe(`VACUUM INTO '${scratch.replace(/'/g, "''")}'`);
    } catch (err) {
      fs.rmSync(scratch, { force: true });
      console.warn(
        "[reclaim] VACUUM INTO failed:",
        err instanceof Error ? err.message.split("\n")[0] : String(err)
      );
      return { ran: false, reason: "vacuum failed" };
    } finally {
      await vacuumer?.$disconnect().catch(() => {});
    }
  }

  if (!fs.existsSync(scratch)) {
    console.warn("[reclaim] VACUUM INTO produced no file");
    return { ran: false, reason: "no output" };
  }

  const compactSize = fs.statSync(scratch).size;
  console.warn(`[reclaim] compacted copy is ${mb(compactSize)} (from ${mb(before)})`);
  const check = await verify(PrismaClientCtor, scratch);
  if (!check.ok) {
    fs.rmSync(scratch, { force: true });
    console.warn(`[reclaim] compacted copy is not usable (${check.detail}), keeping original`);
    return { ran: false, reason: "verify failed" };
  }

  // Install the compacted copy. The original is RENAMED aside first: a rename
  // inside one filesystem costs no space and immediately releases the old file's
  // bytes, which is the only way this can work on a volume with no free space.
  // It used to `rm -f` the original and then copy, which needed room for the copy
  // before it had freed anything - so on a full volume the copy failed and left
  // no database at all. Parking the original first means a failed copy restores
  // it intact.
  const q = (p: string): string => `'${p.replace(/'/g, "'\\''")}'`;
  const aside = `${target}.reclaim-old`;
  try {
    execFileSync(
      "sh",
      [
        "-c",
        // 1. park the original (frees its bytes, costs nothing) and drop its
        //    sidecars - a stale -wal replayed onto the new file would corrupt it
        `set -e; rm -f ${q(aside)}; mv ${q(target)} ${q(aside)}; ` +
          `rm -f ${q(`${target}-wal`)} ${q(`${target}-shm`)}; ` +
          // 2. land the compacted copy in the space that freed
          `cp ${q(scratch)} ${q(target)}`,
      ],
      { env: process.env, stdio: "pipe" }
    );
  } catch (err) {
    // The stderr from `sh` is where "No space left on device" lives; without
    // printing it, a failed reclaim is completely opaque.
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr ?? "").trim()
        : "";
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.error("[reclaim] install of the compacted database failed:", detail);
    if (stderr) console.error("[reclaim] install stderr:", stderr.slice(0, 500));

    // Retry once after purging every other file in the database directory.
    // ENOSPC on `cp` after the 423MB original was parked aside does not add up
    // on bytes alone, and ENOSPC is also what a filesystem with an exhausted
    // inode table returns. Purging strays is free - they are all regenerable
    // sidecars - and it frees inodes if that is what ran out. The original stays
    // parked in `aside` throughout, so this cannot lose the database.
    try {
      const dir = path.dirname(target);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const p = path.join(dir, entry.name);
        if (p === aside || p === target || p === scratch) continue;
        fs.rmSync(p, { force: true });
      }
      logVolumeDetail(target);
      execFileSync(
        "sh",
        [
          "-c",
          `set -e; rm -f ${q(target)} ${q(`${target}-wal`)} ${q(`${target}-shm`)}; ` +
            `cp ${q(scratch)} ${q(target)}`,
        ],
        { env: process.env, stdio: "pipe" }
      );
      console.warn("[reclaim] install succeeded after purging stray files");
    } catch (retryErr) {
      const retryStderr =
        typeof retryErr === "object" && retryErr !== null && "stderr" in retryErr
          ? String((retryErr as { stderr?: unknown }).stderr ?? "").trim()
          : "";
      console.error(
        "[reclaim] install retry failed:",
        retryErr instanceof Error ? retryErr.message.split("\n")[0] : String(retryErr)
      );
      if (retryStderr) console.error("[reclaim] install retry stderr:", retryStderr.slice(0, 500));
      // Put the original back: it is still sitting there, intact.
      try {
        execFileSync("sh", ["-c", `set -e; rm -f ${q(target)}; mv ${q(aside)} ${q(target)}`], {
          env: process.env,
          stdio: "pipe",
        });
        fs.rmSync(scratch, { force: true });
        return { ran: false, reason: "install failed, original restored" };
      } catch (restoreErr) {
        console.error(
          `[reclaim] RESTORE FAILED - the original is parked at ${aside}:`,
          restoreErr instanceof Error ? restoreErr.message.split("\n")[0] : String(restoreErr)
        );
        return { ran: false, reason: "install failed AND restore failed" };
      }
    }
  }

  // Only now that the copy is in place and the original is parked: prove the
  // installed file is a working database before the backup is discarded.
  const installed = await verify(PrismaClientCtor, target);
  if (!installed.ok) {
    console.error("[reclaim] installed database is not usable:", installed.detail);
    try {
      execFileSync("sh", ["-c", `set -e; rm -f ${q(target)}; mv ${q(aside)} ${q(target)}`], {
        env: process.env,
        stdio: "pipe",
      });
      fs.rmSync(scratch, { force: true });
      return { ran: false, reason: "verify failed, original restored" };
    } catch {
      return { ran: false, reason: "verify failed AND restore failed" };
    }
  }

  // The copy is installed and verified: the backup and the scratch are now dead
  // weight on a volume we are trying to empty.
  try {
    fs.rmSync(aside, { force: true });
    fs.rmSync(scratch, { force: true });
  } catch {
    /* the reclaim itself already succeeded; stale files are not worth failing on */
  }

  const after = fs.statSync(target).size;
  const nowFree = freeBytes(target) ?? 0;
  console.warn(
    `[reclaim] compacted ${mb(before)} -> ${mb(after)} (${check.detail}), ${mb(nowFree)} free`
  );
  if (nowFree < TARGET_FREE_BYTES) {
    console.warn(`[reclaim] WARNING: still short of ${mb(TARGET_FREE_BYTES)} free`);
  }
  return {
    ran: true,
    reason: check.detail,
    beforeBytes: before,
    afterBytes: compactSize,
  };
}
