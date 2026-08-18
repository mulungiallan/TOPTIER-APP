"use client";

import { ErrorBoundary } from "@/components/error-boundary";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary name="root">{children}</ErrorBoundary>;
}
