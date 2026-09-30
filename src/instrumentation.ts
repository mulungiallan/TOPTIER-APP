// Next.js instrumentation hook. Registers Sentry's global error handlers for
// server-side + client-side crash reporting. @sentry/nextjs is a dependency.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // ORDER MATTERS: delete rows FIRST, compact the file SECOND.
    //
    // A full volume breaks every write in the app (login, signup, screenshot
    // analysis, signals). Deleting rows frees pages inside the file but never
    // filesystem space, so it is only half a fix - only replacing the file with
    // a compacted copy gives bytes back, and that compaction is useless unless
    // the rows are gone first. That is how a single oversized table
    // (Notification reached 287MB of a 500MB volume) kept the volume full
    // forever: every boot compacted a database that still held every row, and
    // the resulting full-size copy could not be installed. Prune first, and the
    // compacted copy becomes small enough to land.
    //
    // The file swap still has to happen before the first Prisma query in this
    // process, because that is what makes deleting the original file safe.
    // No-op unless the volume is full.
    try {
      const { reclaimRowsNow } = await import("./lib/services/db-retention");
      const deleted = await reclaimRowsNow();
      if (deleted > 0) console.info(`[retention] boot reclaim deleted ${deleted} rows`);
    } catch (err) {
      console.warn("[retention] boot reclaim failed (continuing):", (err as Error).message);
    }

    try {
      const { reclaimDatabaseFile } = await import("./lib/services/db-reclaim");
      await reclaimDatabaseFile();
    } catch (err) {
      console.warn("[reclaim] skipped:", (err as Error).message);
    }

    const { initServerSentry } = await import("./sentry.server.config");
    initServerSentry();

    // Wire graceful shutdown for SIGTERM/SIGINT (deploy restarts, Ctrl-C):
    // stop accepting work, close the socket server, disconnect Prisma, and
    // only then exit. A hard timeout prevents hung shutdowns.
    const { db } = await import("./lib/db");
    const { closeSocketServer } = await import("./lib/socket-server");
    const { rehashPassword, verifyPassword } = await import("./lib/auth");

    // Self-heal: keep the app admin account elevated. Railway's start command
    // can drift from repo config, so this runs inside the server process at
    // every boot to guarantee admin@toptier.app holds the super_admin role.
    //
    // It also syncs the PASSWORD from ADMIN_PASSWORD. Previously this block
    // only fixed the role, so the admin account kept whatever password it was
    // last given locally while the env var sat unused - which meant
    // scripts/ensure-admin.js (the only thing that read ADMIN_PASSWORD) never
    // had any effect in production, because Railway's deployed start command
    // omits the ensure-*.js chain entirely. Result: admin logins returned 403.
    try {
      const adminUser = await db.user.findUnique({ where: { email: "admin@toptier.app" } });
      if (adminUser) {
        const data: { role?: string; isEmailVerified?: boolean; password?: string; tokenVersion?: number } = {};
        if (adminUser.role !== "super_admin") {
          data.role = "super_admin";
          data.isEmailVerified = true;
        }
        if (process.env.ADMIN_PASSWORD) {
          // Only rewrite the hash when it genuinely differs, so a healthy boot
          // does not mutate the row (and re-salting) on every restart.
          const matches = await verifyPassword(process.env.ADMIN_PASSWORD, adminUser.password);
          if (!matches) {
            data.password = rehashPassword(process.env.ADMIN_PASSWORD);
            // Existing sessions were minted against the old credential; force
            // re-issue so a rotated password cannot leave stale tokens valid.
            data.tokenVersion = (adminUser.tokenVersion ?? 0) + 1;
          }
        }

        if (Object.keys(data).length > 0) {
          const updated = await db.user.update({ where: { id: adminUser.id }, data });
          console.log(
            `[self-heal] admin@toptier.app updated (role=${updated.role}, passwordSync=${Boolean(data.password)})`
          );
        }
      } else {
        // Create it. This block used to only warn and point at
        // scripts/ensure-admin.js, which made the account's existence depend on
        // that script running - and the deployed start command does not reliably
        // include it. When a reclaim or a restore dropped the row, every admin
        // login then failed with "invalid email" and the only fix was a manual
        // script run.
        //
        // The password is the same scrypt hash scripts/ensure-admin.js writes, so
        // the credentials are identical whichever path creates the account.
        const password = process.env.ADMIN_PASSWORD;
        if (!password) {
          console.warn("[self-heal] admin@toptier.app not found and ADMIN_PASSWORD is unset");
        } else {
          const { randomBytes } = await import("crypto");
          let referralCode = "";
          for (let i = 0; i < 10; i++) {
            const candidate = randomBytes(4).toString("hex").toUpperCase();
            if (!(await db.user.findUnique({ where: { referralCode: candidate } }))) {
              referralCode = candidate;
              break;
            }
          }

          const created = await db.user.create({
            data: {
              email: "admin@toptier.app",
              password: rehashPassword(password),
              name: "TOPTIER Admin",
              role: "super_admin",
              subscriptionTier: "premium",
              onboardingCompleted: true,
              onboardingStep: 7,
              referralCode,
              isEmailVerified: true,
              country: "Kenya",
            },
            select: { id: true, role: true },
          });
          console.log(`[self-heal] admin@toptier.app created (role=${created.role})`);
        }
      }
    } catch (err) {
      console.warn("[self-heal] admin reconciliation skipped:", (err as Error).message);
    }

    // Seed the content catalogs at boot.
    //
    // Railway's deployed start command omits the whole ensure-*.js chain (the
    // service dashboard overrides railway.toml), so Package, TickerSymbol and
    // EBook stayed empty in production - the subscriptions catalog and the
    // e-books section both rendered nothing.
    //
    // Each script is idempotent, receives the app's existing `db` (so no
    // second connection pool and no bundled duplicate of the generated
    // Prisma client), and any failure is logged and swallowed so seeding can
    // never take the server down.
    const seeds: Array<[string, () => Promise<unknown>]> = [
      ["ensure-packages", () => import("@scripts/ensure-packages")],
      ["ensure-tickers", () => import("@scripts/ensure-tickers")],
      ["ensure-ebooks", () => import("@scripts/ensure-ebooks")],
    ];
    for (const [name, load] of seeds) {
      try {
        const mod = (await load()) as {
          main?: (client: unknown) => Promise<void>;
          default?: { main: (client: unknown) => Promise<void> };
        };
        const run = mod.main ?? mod.default?.main;
        if (!run) throw new Error("module did not export main()");
        await run(db);
      } catch (err) {
        console.warn(`[boot] ${name} failed:`, (err as Error).message);
      }
    }

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[shutdown] Received ${signal}, draining...`);

      const forceExit = setTimeout(() => {
        console.error("[shutdown] Timed out waiting for graceful shutdown, forcing exit.");
        process.exit(1);
      }, 15_000);
      forceExit.unref();

      try {
        closeSocketServer();
        await db.$disconnect();
        console.log("[shutdown] Closed sockets and DB connection. Exiting.");
        process.exit(0);
      } catch (err) {
        console.error("[shutdown] Error during graceful shutdown:", err);
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));

    // The app runs on one fixed-size SQLite file, and deleting rows does not
    // shrink the file. Without an age-based cut the Signal/Notification tables
    // grow until every write fails with SQLITE_FULL, which breaks login and the
    // screenshot analyser at the same time. This runs FIRST, before any
    // background writer starts, and it is the safety net for the case where the
    // boot script (scripts/ensure-space.js) is not part of the deployed start
    // command: deleting rows frees pages SQLite can reuse in place, which is
    // enough to make writes work again on a full volume.
    const { startRetentionMonitor } = await import("./lib/services/db-retention");
    startRetentionMonitor();

    // Start the background signal generator so the Signals feed stays populated
    // without blocking API requests. It refreshes every few minutes and is
    // internally throttled + guarded against overlapping runs.
    const { signalGenerator } = await import("./lib/services/signal-generator");
    signalGenerator.startBackgroundRefresh();

    // Mark signals hit_tp / hit_sl / expired against the LIVE market as soon as
    // those levels are traded through, and notify admins of each outcome so
    // they can monitor signal performance without opening the DB.
    const { signalOutcomes } = await import("./lib/services/signal-outcomes");
    signalOutcomes.startBackgroundMonitor();

    // Chart/screenshot analyses are kept for 1 hour then deleted automatically.
    // Purge on a schedule (not just on API access) so expired records never
    // linger.
    const { purgeExpiredAnalyses } = await import("./lib/services/analysis-cleanup");
    purgeExpiredAnalyses().catch(() => {});
    const cleanupTimer = setInterval(() => {
      purgeExpiredAnalyses().catch(() => {});
    }, 10 * 60 * 1000);
    if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();

    // Keep the Competitions & Events hub populated with a rolling schedule of
    // tournaments and trading events (also seeded on first API visit).
    const { ensureHubContent } = await import("./lib/services/event-hub");
    ensureHubContent().catch(() => {});
    const hubTimer = setInterval(() => {
      ensureHubContent().catch(() => {});
    }, 30 * 60 * 1000);
    if (typeof hubTimer.unref === "function") hubTimer.unref();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const { initEdgeSentry } = await import("./sentry.edge.config");
    initEdgeSentry();
  }
}
