/**
 * src/components/ads/NativeAdCard.tsx
 *
 * Renders a native advanced ad inside the signal feed. The installed
 * @admob-plus/capacitor version does not expose native-advanced ads, so
 * this component is a safe no-op placeholder (returns null on all platforms).
 * It can be revisited if a plugin with native-advanced support is added later.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { NativeAdMobClient } from '@/lib/ads/adMobService';

const CARD_HEIGHT_PX = 120;

export function NativeAdCard({ adKey }: { adKey: string }) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !NativeAdMobClient) return;
    let cancelled = false;

    async function loadAndPosition() {
      try {
        await NativeAdMobClient.loadNativeAd?.({
          adId: process.env.NEXT_PUBLIC_ADMOB_NATIVE_ID ?? '',
          adKey,
        });
        if (cancelled) return;
        setLoaded(true);
        syncPosition();
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    function syncPosition() {
      const el = placeholderRef.current;
      if (!el || !NativeAdMobClient) return;
      const rect = el.getBoundingClientRect();
      NativeAdMobClient.setNativeAdPosition?.({
        adKey,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }).catch(() => {});
    }

    loadAndPosition();

    window.addEventListener('scroll', syncPosition, { passive: true, capture: true });
    window.addEventListener('resize', syncPosition);

    return () => {
      cancelled = true;
      window.removeEventListener('scroll', syncPosition, true);
      window.removeEventListener('resize', syncPosition);
      NativeAdMobClient?.destroyNativeAd?.({ adKey }).catch(() => {});
    };
  }, [adKey]);

  if (!Capacitor.isNativePlatform() || !NativeAdMobClient || failed) return null;

  return (
    <div
      ref={placeholderRef}
      style={{ height: CARD_HEIGHT_PX, width: '100%' }}
      className="rounded-lg border border-border/50 bg-muted/20 flex items-center justify-center"
      aria-label="Sponsored"
    >
      {!loaded && <span className="text-xs text-muted-foreground">Loading...</span>}
    </div>
  );
}