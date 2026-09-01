// Sentry client-side initialization (bundled into the browser).
// Loaded via the Next.js `instrumentation-client.ts` hook when available, or
// through a dynamic import in the error boundary. Initializes only in
// production and only when a DSN is configured.
import * as Sentry from "@sentry/nextjs";

export function initClientSentry() {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    replaysSessionSampleRate: parseFloat(process.env.SENTRY_REPLAYS_SESSION_SAMPLE_RATE || "0.0"),
    replaysOnErrorSampleRate: parseFloat(process.env.SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE || "0.0"),
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    enabled: process.env.NODE_ENV === "production",
  });
}
