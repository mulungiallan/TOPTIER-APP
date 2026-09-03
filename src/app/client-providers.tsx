"use client";

import { ErrorBoundary } from "@/components/error-boundary";
import { AppLockProvider } from "@/components/auth/app-lock-provider";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary name="root">
      <AppLockProvider>{children}</AppLockProvider>
    </ErrorBoundary>
  );
}
