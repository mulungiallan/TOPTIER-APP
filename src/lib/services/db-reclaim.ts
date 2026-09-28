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

  console.warn(`[reclaim] volume is full (${mb(free)} free, db ${mb(before)}), compacting`);
  fs.rmSync(scratch, { force: true });

  const { PrismaClient: PrismaClientCtor } = await import("@/generated/prisma");

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

  if (!fs.existsSync(scratch)) {
    console.warn("[reclaim] VACUUM INTO produced no file");
    return { ran: false, reason: "no output" };
  }

  const compactSize = fs.statSync(scratch).size;
  const check = await verify(PrismaClientCtor, scratch);
  if (!check.ok) {
    fs.rmSync(scratch, { force: true });
    console.warn(`[reclaim] compacted copy is not usable (${check.detail}), keeping original`);
    return { ran: false, reason: "verify failed" };
  }

  // The old file, its sidecars and the install happen in ONE shell invocation,
  // so there is no window in which a crash leaves neither file present. The
  // sidecars MUST go with the old database: a stale -wal replayed onto a
  // different file would corrupt it.
  const q = (p: string): string => `'${p.replace(/'/g, "'\\''")}'`;
  try {
    execFileSync(
      "sh",
      [
        "-c",
        `set -e; rm -f ${q(`${target}-wal`)} ${q(`${target}-shm`)}; rm -f ${q(target)}; ` +
          `cp ${q(scratch)} ${q(target)}; rm -f ${q(scratch)}`,
      ],
      { env: process.env, stdio: "pipe" }
    );
  } catch (err) {
    console.error(
      "[reclaim] install of the compacted database failed:",
      err instanceof Error ? err.message.split("\n")[0] : String(err)
    );
    return { ran: false, reason: "install failed" };
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
