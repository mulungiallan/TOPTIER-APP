/**
 * src/lib/ads/analysis-gate.ts
 *
 * Client-side gate for the Screenshot Analyzer.
 *
 * Free users get FREE_DAILY_ANALYSES charts/day without an ad. Beyond that,
 * every further analysis costs one rewarded-ad watch. Premium / remove-ads
 * users (and admins) bypass the gate entirely.
 *
 * The rewarded ad is an AdMob (native) capability, so the gate only engages on
 * the Capacitor app. On the web build there is no rewarded network wired up, so
 * the analyzer stays free/unlimited there and the app-wide web ad layer
 * (banner / interstitial) remains the monetization surface.
 *
 * The daily count is tracked client-side (localStorage), matching the ad
 * service's other device-scoped caps. Server-side quota is intentionally not
 * enforced here so the ad-gated experience stays a single decision point.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useStore } from '@/lib/store';
import { shouldShowAds } from '@/lib/ads';

export const FREE_DAILY_ANALYSES = 4;

const COUNT_STORAGE_KEY = 'toptier_daily_analysis_count_v1';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = JSON.parse(window.localStorage.getItem(COUNT_STORAGE_KEY) ?? '{}');
    return raw.day === today() ? (raw.count ?? 0) : 0;
  } catch {
    return 0;
  }
}

function writeCount(count: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      COUNT_STORAGE_KEY,
      JSON.stringify({ day: today(), count })
    );
  } catch {
    /* storage may be unavailable (private mode) — fail open */
  }
}

export interface AnalysisAdGate {
  /** Whether the rewarded gate can engage at all (free user on native). */
  gated: boolean;
  /** Free analyses left today (0 once the rewarded gate takes over). */
  remaining: number;
  /** True when the next analysis must be paid for with a rewarded ad. */
  needsAd: boolean;
  /** Record a consumed analysis (call once per successful analysis). */
  consume: () => void;
}

export function useAnalysisAdGate(): AnalysisAdGate {
  const user = useStore((s) => s.user);
  const [count, setCount] = useState(0);

  // Hydrate from localStorage after mount so SSR and the first client render
  // agree (no hydration mismatch).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCount(readCount());
  }, []);

  const gated = Capacitor.isNativePlatform() && shouldShowAds(user);
  const remaining = Math.max(0, FREE_DAILY_ANALYSES - count);
  const needsAd = gated && count >= FREE_DAILY_ANALYSES;

  const consume = useCallback(() => {
    if (!gated) return;
    const next = readCount() + 1;
    writeCount(next);
    setCount(next);
  }, [gated]);

  return { gated, remaining, needsAd, consume };
}
