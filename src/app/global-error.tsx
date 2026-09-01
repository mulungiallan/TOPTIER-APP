"use client";

// Global error boundary. Catches errors that escape the root layout — used
// only when the whole app fails to render. Must include its own <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <h1 className="text-3xl font-bold mb-3">Unexpected error</h1>
          <p className="text-sm text-zinc-400 mb-6 max-w-md">
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            onClick={() => reset()}
            className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}