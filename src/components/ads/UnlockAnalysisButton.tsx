/**
 * src/components/ads/UnlockAnalysisButton.tsx
 *
 * Free users get N analyses/day without ads; beyond that each extra analysis
 * costs one rewarded ad watch. Premium users bypass this entirely (handled
 * inside useRewardedUnlock -> adMobService, which no-ops for premium).
 *
 * The daily count + gating live in useAnalysisAdGate so the Screenshot Analyzer
 * and this button share one source of truth.
 */

'use client';

import { useState, useCallback } from 'react';
import { useRewardedUnlock } from '@/lib/ads/useAds';
import { useAnalysisAdGate } from '@/lib/ads/analysis-gate';

interface UnlockAnalysisButtonProps {
  onUnlocked: () => void;
}

export function UnlockAnalysisButton({ onUnlocked }: UnlockAnalysisButtonProps) {
  const { unlock } = useRewardedUnlock();
  const { remaining, needsAd, consume } = useAnalysisAdGate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setError(null);

    if (!needsAd) {
      consume();
      onUnlocked();
      return;
    }

    setLoading(true);
    try {
      const rewarded = await unlock();
      if (rewarded) {
        consume();
        onUnlocked();
      } else {
        setError("Ad wasn't completed — watch the full ad to unlock this analysis.");
      }
    } finally {
      setLoading(false);
    }
  }, [needsAd, unlock, consume, onUnlocked]);

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
            : `Get AI analysis (${remaining} free left today)`}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
