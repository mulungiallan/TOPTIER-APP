/**
 * Sentry initialization
 * Drop into: src/lib/sentry.ts
 *
 * Requires: npm install @sentry/nextjs
 * Docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from "@sentry/nextjs";

export function initSentry() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    console.warn("[Sentry] DSN not set — error tracking disabled");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || "development",
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    profilesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    // Filter out noisy errors
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "Network request failed",
      "Failed to fetch",
      "Loading chunk",
      "Non-Error promise rejection captured",
    ],
    // Don't send errors in development unless explicitly enabled
    beforeSend(event) {
      if (process.env.NODE_ENV === "development" && !process.env.SENTRY_DEV_ENABLED) {
        return null;
      }
      return event;
    },
  });
}

export { Sentry };

// Helper to wrap API route handlers with error tracking
export function withSentry<T extends (...args: any[]) => any>(handler: T): T {
  return (async (...args: any[]) => {
    try {
      return await handler(...args);
    } catch (e) {
      Sentry.captureException(e);
      throw e;
    }
  }) as T;
}
