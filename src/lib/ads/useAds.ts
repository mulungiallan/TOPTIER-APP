/**
 * src/lib/ads/useAds.ts
 *
 * React hooks that connect adMobService.ts to the Next.js App Router app.
 * Uses `usePathname` (App Router) to detect screen transitions.
 */

'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import {
  initAds,
  showBanner,
  hideBanner,
  maybeShowInterstitialOnTransition,
  showRewardedForAnalysisUnlock,
  maybeShowAppOpenAd,
  registerPremiumStatusGetter,
  type RewardedResult,
} from './adMobService';

/**
 * Call this once near the root of the app (e.g. in client-providers.tsx),
 * passing a function that reads your actual premium/subscription state
 * (Zustand store, React Query cache, whatever you use).
 */
export function useAdsInit(isPremiumGetter: () => boolean) {
  useEffect(() => {
    registerPremiumStatusGetter(isPremiumGetter);
    initAds();
    maybeShowAppOpenAd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Mount this in layout components for screens where a persistent banner
 * should show (dashboard, watchlist, feed). Automatically hides on unmount.
 */
export function useBannerAd(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    showBanner();
    return () => {
      hideBanner();
    };
  }, [enabled]);
}

/**
 * Mount once near the root (e.g. client-providers.tsx). Fires an interstitial
 * attempt on every route change; adMobService's own gating (min gap, blocked
 * routes, premium check) decides whether it actually shows.
 */
export function useInterstitialOnRouteChange() {
  const pathname = usePathname();
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    if (previousPath.current !== null && previousPath.current !== pathname) {
      maybeShowInterstitialOnTransition(pathname);
    }
    previousPath.current = pathname;
  }, [pathname]);
}

/**
 * Use inside your "Unlock full AI analysis" button. Handles the rewarded-ad
 * flow and returns whether the unlock should proceed.
 */
export function useRewardedUnlock() {
  const unlock = async (): Promise<boolean> => {
    const result: RewardedResult = await showRewardedForAnalysisUnlock();
    return result.rewarded;
  };
  return { unlock };
}