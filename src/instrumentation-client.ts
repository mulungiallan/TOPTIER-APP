// Next.js client-side instrumentation hook.
// Initializes Sentry for browser crash/error tracking during app boot.
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { initClientSentry } = await import("./sentry.client.config");
  initClientSentry();
}
