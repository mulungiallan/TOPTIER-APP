// Sentry edge-runtime initialization.
// When @sentry/nextjs is installed, Sentry is enabled automatically if
// SENTRY_DSN is set. When the package is absent, this file is a safe no-op.

if (process.env.SENTRY_DSN) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/nextjs")

    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
      enabled: process.env.NODE_ENV === "production",
    })
  } catch {
    // @sentry/nextjs is not installed — continue without error tracking.
  }
}
