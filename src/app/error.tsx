"use client";

import { useEffect } from "react";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

// Client-side error boundary for a route segment. Next.js recommends at least
// one of these; errors here don't crash the whole app shell.
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Report to Sentry when configured.
    try {
      if (typeof window !== "undefined" && (window as any).__SENTRY__?.captureException) {
        (window as any).__SENTRY__.captureException(error);
      }
    } catch {
      // no-op — Sentry may not be available
    }
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <h1 className="text-3xl font-bold mb-3">Something went wrong</h1>
      <p className="text-sm text-zinc-400 mb-6 max-w-md">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      <button
        onClick={reset}
        className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
      >
        Try again
      </button>
    </div>
  );
}