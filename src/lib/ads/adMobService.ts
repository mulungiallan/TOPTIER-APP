/**
 * src/lib/ads/adMobService.ts
 *
 * Central AdMob service for the Toptier Android app (Capacitor wrapper).
 * Uses @admob-plus/capacitor v2 class API (BannerAd / InterstitialAd / RewardedAd).
 * Native-advanced and app-open ads are not supported by the installed plugin
 * version; those surfaces are intentionally no-ops.
 *
 * On web builds every method is a safe no-op (Capacitor.isNativePlatform() === false).
 */

import { AdMobPlus, BannerAd, InterstitialAd, RewardedAd } from '@admob-plus/capacitor';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';

// ---------------------------------------------------------------------------
// Ad unit IDs
// ---------------------------------------------------------------------------

const IS_PROD = process.env.NEXT_PUBLIC_ADS_ENV === 'production';

const TEST_IDS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
};

const PROD_IDS = {
  banner: process.env.NEXT_PUBLIC_ADMOB_BANNER_ID ?? '',
  interstitial: process.env.NEXT_PUBLIC_ADMOB_INTERSTITIAL_ID ?? '',
  rewarded: process.env.NEXT_PUBLIC_ADMOB_REWARDED_ID ?? '',
};

export const AD_UNIT_IDS = IS_PROD ? PROD_IDS : TEST_IDS;

// Master switch: when NEXT_PUBLIC_ADMOB_DISABLED=true, the native AdMob
// plugin is NEVER touched (no AdMobPlus.start(), no banner/interstitial/
// rewarded calls). Used to ship a crash-free build while the alpha plugin
// (@admob-plus/capacitor 2.0.0-alpha.4) is incompatible with this runtime.
const ADMOB_DISABLED = process.env.NEXT_PUBLIC_ADMOB_DISABLED === 'true';

// ---------------------------------------------------------------------------
// Distribution rules — in-app gating layered on top of AdMob's caps.
// Persisted to localStorage so limits survive app restarts.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'toptier_ad_timing_v1';

interface AdTiming {
  lastInterstitialAt: number;
  lastRewardedAt: number;
}

function loadTiming(): AdTiming {
  if (typeof window === 'undefined') {
    return { lastInterstitialAt: 0, lastRewardedAt: 0 };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { lastInterstitialAt: 0, lastRewardedAt: 0 };
  } catch {
    return { lastInterstitialAt: 0, lastRewardedAt: 0 };
  }
}

function saveTiming(timing: AdTiming) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(timing));
}

const MIN_INTERSTITIAL_GAP_MS = 3 * 60 * 1000;
const MIN_REWARDED_TO_INTERSTITIAL_GAP_MS = 60 * 1000;
const INTERSTITIAL_BLOCKED_ROUTES = ['/trade/execute', '/trade/confirm', '/positions/'];

// ---------------------------------------------------------------------------
// Premium check
// ---------------------------------------------------------------------------

export type PremiumStatusGetter = () => boolean;
let getIsPremium: PremiumStatusGetter = () => false;

export function registerPremiumStatusGetter(fn: PremiumStatusGetter) {
  getIsPremium = fn;
}

// ---------------------------------------------------------------------------
// Ad instances (lazily created singletons)
// ---------------------------------------------------------------------------

let bannerAd: BannerAd | null = null;

function getBannerAd(): BannerAd {
  if (!bannerAd) bannerAd = new BannerAd({ adUnitId: AD_UNIT_IDS.banner, position: 'bottom' });
  return bannerAd;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

let initialized = false;

export async function initAds(): Promise<void> {
  if (!Capacitor.isNativePlatform() || initialized || ADMOB_DISABLED) return;

  try {
    await AdMobPlus.start();
    if (!IS_PROD) {
      // Expose test device IDs so taps never count as invalid traffic.
      await AdMobPlus.configRequest({ testDeviceIds: [] }).catch(() => {});
    }
    initialized = true;
  } catch {
    // A native ad SDK failure must NEVER take down the app.
  }
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

export async function showBanner(): Promise<void> {
  if (!Capacitor.isNativePlatform() || ADMOB_DISABLED || getIsPremium()) return;
  try {
    await getBannerAd().show();
  } catch {
    /* no-op */
  }
}

export async function hideBanner(): Promise<void> {
  if (!Capacitor.isNativePlatform() || ADMOB_DISABLED) return;
  try {
    await bannerAd?.hide();
  } catch {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Interstitial — at natural screen transitions only
// ---------------------------------------------------------------------------

export async function maybeShowInterstitialOnTransition(currentPath: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || ADMOB_DISABLED || getIsPremium()) return false;
  if (INTERSTITIAL_BLOCKED_ROUTES.some((p) => currentPath.startsWith(p))) return false;

  const timing = loadTiming();
  const now = Date.now();
  if (now - timing.lastInterstitialAt < MIN_INTERSTITIAL_GAP_MS) return false;
  if (now - timing.lastRewardedAt < MIN_REWARDED_TO_INTERSTITIAL_GAP_MS) return false;

  try {
    const ad = new InterstitialAd({ adUnitId: AD_UNIT_IDS.interstitial });
    await ad.load();
    await ad.show();
    timing.lastInterstitialAt = now;
    saveTiming(timing);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rewarded — opt-in gate for unlocking a full AI analysis
// ---------------------------------------------------------------------------

export interface RewardedResult {
  watched: boolean;
  rewarded: boolean;
}

export async function showRewardedForAnalysisUnlock(): Promise<RewardedResult> {
  if (getIsPremium()) return { watched: false, rewarded: true };
  if (!Capacitor.isNativePlatform() || ADMOB_DISABLED) return { watched: false, rewarded: false };

  try {
    const ad = new RewardedAd({ adUnitId: AD_UNIT_IDS.rewarded });

    const rewarded = await new Promise<boolean>((resolve) => {
      const handles: Array<Promise<PluginListenerHandle> & PluginListenerHandle> = [];
      let cleaned = false;
      const finish = (val: boolean) => {
        if (cleaned) return;
        cleaned = true;
        handles.forEach((h) => h.remove().catch(() => {}));
        resolve(val);
      };

      const matches = (event: any) => event?.id === ad.id || event?.adUnitId === AD_UNIT_IDS.rewarded;

      handles.push(AdMobPlus.addListener('rewarded.reward', (event: any) => {
        if (matches(event)) finish(true);
      }));
      handles.push(AdMobPlus.addListener('rewarded.dismiss', () => finish(false)));
      handles.push(AdMobPlus.addListener('rewarded.showfail', () => finish(false)));
      handles.push(AdMobPlus.addListener('rewarded.loadfail', () => finish(false)));

      ad
        .load()
        .then(() => ad.show())
        .catch(() => finish(false));
    });

    if (rewarded) {
      const timing = loadTiming();
      timing.lastRewardedAt = Date.now();
      saveTiming(timing);
    }

    return { watched: true, rewarded };
  } catch {
    return { watched: false, rewarded: false };
  }
}

// ---------------------------------------------------------------------------
// App open — not supported by @admob-plus/capacitor v2; kept as a no-op
// ---------------------------------------------------------------------------

export async function maybeShowAppOpenAd(): Promise<boolean> {
  return false;
}

// ---------------------------------------------------------------------------
// Native advanced — not supported by @admob-plus/capacitor v2
// ---------------------------------------------------------------------------

export const NativeAdMobClient = null as any;
