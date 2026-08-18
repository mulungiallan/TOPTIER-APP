/**
 * Sentry instrumentation files
 * Place these files at the exact paths shown below in your project.
 *
 * 1. src/instrumentation.ts (root)
 * 2. src/sentry.client.config.ts
 * 3. src/sentry.server.config.ts
 * 4. src/sentry.edge.config.ts
 */

// ---------- src/instrumentation.ts ----------
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// ---------- src/sentry.client.config.ts ----------
export function registerClientSentry() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  // Lazy import to avoid breaking dev environments without @sentry/nextjs
  import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
      ],
    });
  }).catch(() => {
    console.warn("[Sentry] @sentry/nextjs not installed — skipping");
  });
}

// ---------- src/sentry.server.config.ts ----------
export function registerServerSentry() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || "development",
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    });
  }).catch(() => {
    console.warn("[Sentry] @sentry/nextjs not installed — skipping");
  });
}

// ---------- src/sentry.edge.config.ts ----------
export function registerEdgeSentry() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    });
  }).catch(() => {
    console.warn("[Sentry] @sentry/nextjs not installed — skipping");
  });
}
