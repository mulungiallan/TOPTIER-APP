// Sentry wrapper helpers.
// When @sentry/nextjs is installed, withSentry wraps handlers with Sentry
// tracing. When the package is absent, handlers run unmodified.

export function withSentry<T extends (...args: unknown[]) => unknown>(handler: T): T {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SentryNextjs = require("@sentry/nextjs")
    if (SentryNextjs.withSentry) {
      return SentryNextjs.withSentry(handler) as T
    }
  } catch {
    // @sentry/nextjs not installed — return handler unmodified
  }
  return handler
}
