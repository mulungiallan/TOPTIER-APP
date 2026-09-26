"use client";

import { useEffect } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { AppLockProvider } from "@/components/auth/app-lock-provider";
import { useAdsInit, useInterstitialOnPageChange, useInterstitialOnRouteChange } from "@/lib/ads/useAds";
import { useStore } from "@/lib/store";
import { shouldShowAds } from "@/lib/ads";
import { initStatusBar } from "@/lib/native/status-bar";
import { useNotificationsCenter } from "@/hooks/use-notifications-center";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initStatusBar();
  }, []);

  useAdsInit(() => !shouldShowAds(useStore.getState().user));
  useInterstitialOnRouteChange();
  useInterstitialOnPageChange();

  // Poll the notification center + pop instant sonner toasts when new signals,
  // signal results, or system notices arrive while the app is open.
  useNotificationsCenter(true);

  return (
    <ErrorBoundary name="root">
      <AppLockProvider>{children}</AppLockProvider>
    </ErrorBoundary>
  );
}
