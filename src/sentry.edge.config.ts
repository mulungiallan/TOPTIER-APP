// Sentry edge-runtime initialization.
// Called from src/instrumentation.ts during app bootstrap.
import * as Sentry from "@sentry/nextjs";

export function initEdgeSentry() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    enabled: process.env.NODE_ENV === "production",
  });
}
