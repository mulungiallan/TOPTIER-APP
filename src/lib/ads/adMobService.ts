/**
 * src/lib/ads/adMobService.ts
 *
 * Central AdMob service for the Toptier Android/iOS app (Capacitor wrapper).
 * Uses @capacitor-community/admob v8 (Banner / Interstitial / Rewarded / App Open).
 * Replaced @admob-plus/capacitor (2.0.0-alpha) which was incompatible with the
 * Capacitor 8 runtime and crashed the native app.
 *
 * On web builds every method is a safe no-op (Capacitor.isNativePlatform()
 * is false), so the web app and the desktop browser build are unaffected.
 *
 * Safety contract: no AdMob call may ever throw into the app. Every native
 * call is wrapped so an SDK failure degrades to "no ad shown", never a crash.
 * NEXT_PUBLIC_ADMOB_DISABLED=true keeps the SDK completely untouched.
 */

import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
  AdMob,
  AdmobConsentStatus,
  BannerAdPosition,
  BannerAdSize,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';

// ---------------------------------------------------------------------------
// Ad unit IDs
// ---------------------------------------------------------------------------

const IS_PROD = process.env.NEXT_PUBLIC_ADS_ENV === 'production';

const TEST_IDS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
  appOpen: 'ca-app-pub-3940256099942544/9257395921',
};

const PROD_IDS = {
  banner: process.env.NEXT_PUBLIC_ADMOB_BANNER_ID ?? '',
  interstitial: process.env.NEXT_PUBLIC_ADMOB_INTERSTITIAL_ID ?? '',
  rewarded: process.env.NEXT_PUBLIC_ADMOB_REWARDED_ID ?? '',
  appOpen: process.env.NEXT_PUBLIC_ADMOB_APP_OPEN_ID ?? '',
};

export const AD_UNIT_IDS = IS_PROD ? PROD_IDS : TEST_IDS;

// Master switch: when NEXT_PUBLIC_ADMOB_DISABLED=true the native AdMob plugin
// is NEVER touched. Used to ship a crash-free build if the SDK ever misbehaves.
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

const usable = () => Capacitor.isNativePlatform() && !ADMOB_DISABLED && !getIsPremium();

// ---------------------------------------------------------------------------
// Init (SDK + consent)
// ---------------------------------------------------------------------------

let initialized = false;

export async function initAds(): Promise<void> {
  if (!Capacitor.isNativePlatform() || initialized || ADMOB_DISABLED) return;

  try {
    await AdMob.initialize({ initializeForTesting: !IS_PROD });

    // UMP consent. If the user is in a region that requires a form, show it.
    // Never blocks the app if consent fails — we just skip ads for this launch.
    try {
      let consent = await AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
        consent = await AdMob.showConsentForm();
      }
    } catch {
      /* consent is best-effort */
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
  if (!usable()) return;
  try {
    await AdMob.showBanner({
      adId: AD_UNIT_IDS.banner,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: !IS_PROD,
    });
  } catch {
    /* no-op */
  }
}

export async function hideBanner(): Promise<void> {
  if (!Capacitor.isNativePlatform() || ADMOB_DISABLED) return;
  try {
    await AdMob.hideBanner();
  } catch {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Interstitial — at natural screen transitions only
// ---------------------------------------------------------------------------

export async function maybeShowInterstitialOnTransition(currentPath: string): Promise<boolean> {
  if (!usable()) return false;
  if (INTERSTITIAL_BLOCKED_ROUTES.some((p) => currentPath.startsWith(p))) return false;

  const timing = loadTiming();
  const now = Date.now();
  if (now - timing.lastInterstitialAt < MIN_INTERSTITIAL_GAP_MS) return false;
  if (now - timing.lastRewardedAt < MIN_REWARDED_TO_INTERSTITIAL_GAP_MS) return false;

  try {
    await AdMob.prepareInterstitial({ adId: AD_UNIT_IDS.interstitial, isTesting: !IS_PROD });
    await AdMob.showInterstitial();
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

  const handles: PluginListenerHandle[] = [];
  try {
    await AdMob.prepareRewardVideoAd({ adId: AD_UNIT_IDS.rewarded, isTesting: !IS_PROD });

    const rewarded = await new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (val: boolean) => {
        if (done) return;
        done = true;
        resolve(val);
      };

      // Reward earned → true. Dismissed without earning → false.
      AdMob.addListener(RewardAdPluginEvents.Rewarded, () => finish(true)).then((h) =>
        handles.push(h)
      );
      AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish(false)).then((h) =>
        handles.push(h)
      );

      AdMob.showRewardVideoAd()
        .then(() => finish(true))
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
  } finally {
    handles.forEach((h) => h.remove().catch(() => {}));
  }
}

// ---------------------------------------------------------------------------
// App open — shown on cold start by the caller
// ---------------------------------------------------------------------------

export async function maybeShowAppOpenAd(): Promise<boolean> {
  if (!usable()) return false;
  try {
    const loaded = await AdMob.isAppOpenLoaded();
    if (!loaded.value) {
      await AdMob.loadAppOpen({ adId: AD_UNIT_IDS.appOpen });
    }
    await AdMob.showAppOpen();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Native advanced — available in @capacitor-community/admob (Preview); the app
// uses the web HTML NativeAd component instead, so this stays a null stub.
// ---------------------------------------------------------------------------

export const NativeAdMobClient = null as any;
