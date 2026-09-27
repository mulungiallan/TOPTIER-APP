// Next.js instrumentation hook. Registers Sentry's global error handlers for
// server-side + client-side crash reporting. @sentry/nextjs is a dependency.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
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
        console.warn("[self-heal] admin@toptier.app not found - run scripts/ensure-admin.js");
      }
    } catch (err) {
      console.warn("[self-heal] admin reconciliation skipped:", (err as Error).message);
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
