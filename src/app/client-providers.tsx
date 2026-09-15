"use client";

import { useEffect } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { AppLockProvider } from "@/components/auth/app-lock-provider";
import { useAdsInit, useInterstitialOnRouteChange } from "@/lib/ads/useAds";
import { useStore } from "@/lib/store";
import { shouldShowAds } from "@/lib/ads";
import { initStatusBar } from "@/lib/native/status-bar";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initStatusBar();
  }, []);

  useAdsInit(() => !shouldShowAds(useStore.getState().user));
  useInterstitialOnRouteChange();

  return (
    <ErrorBoundary name="root">
      <AppLockProvider>{children}</AppLockProvider>
    </ErrorBoundary>
  );
}
