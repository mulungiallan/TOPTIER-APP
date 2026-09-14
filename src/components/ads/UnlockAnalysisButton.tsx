/**
 * src/components/ads/UnlockAnalysisButton.tsx
 *
 * Free users get N analyses/day without ads; beyond that each extra analysis
 * costs one rewarded ad watch. Premium users bypass this entirely
 * (handled inside useRewardedUnlock -> adMobService, which no-ops for premium).
 *
 * useDailyAnalysisCount uses localStorage as a client-side placeholder;
 * production should also enforce the limit server-side.
 */

'use client';

import { useState, useCallback } from 'react';
import { useRewardedUnlock } from '@/lib/ads/useAds';

const FREE_DAILY_LIMIT = 4;
const COUNT_STORAGE_KEY = 'toptier_daily_analysis_count_v1';

function useDailyAnalysisCount() {
  const today = new Date().toISOString().slice(0, 10);

  const read = (): number => {
    if (typeof window === 'undefined') return 0;
    try {
      const raw = JSON.parse(window.localStorage.getItem(COUNT_STORAGE_KEY) ?? '{}');
      return raw.day === today ? raw.count : 0;
    } catch {
      return 0;
    }
  };

  const increment = () => {
    if (typeof window === 'undefined') return;
    const current = read();
    window.localStorage.setItem(COUNT_STORAGE_KEY, JSON.stringify({ day: today, count: current + 1 }));
  };

  return { count: read(), increment };
}

interface UnlockAnalysisButtonProps {
  onUnlocked: () => void;
}

export function UnlockAnalysisButton({ onUnlocked }: UnlockAnalysisButtonProps) {
  const { unlock } = useRewardedUnlock();
  const { count, increment } = useDailyAnalysisCount();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsAd = count >= FREE_DAILY_LIMIT;

  const handleClick = useCallback(async () => {
    setError(null);

    if (!needsAd) {
      increment();
      onUnlocked();
      return;
    }

    setLoading(true);
    try {
      const rewarded = await unlock();
      if (rewarded) {
        increment();
        onUnlocked();
      } else {
        setError("Ad wasn't completed — watch the full ad to unlock this analysis.");
      }
    } finally {
      setLoading(false);
    }
  }, [needsAd, unlock, increment, onUnlocked]);

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={handleClick}
        disabled={loading}
        className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
      >
        {loading
          ? 'Loading ad...'
          : needsAd
            ? 'Watch ad to unlock full AI analysis'
            : `Get AI analysis (${FREE_DAILY_LIMIT - count} free left today)`}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}