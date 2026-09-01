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
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const { initEdgeSentry } = await import("./sentry.edge.config");
    initEdgeSentry();
  }
}
