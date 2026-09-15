/**
 * src/lib/native/status-bar.ts
 *
 * Belt-and-suspenders alongside capacitor.config.ts's declarative
 * StatusBar block — some Capacitor versions only fully apply overlay/color
 * settings via this runtime call, not the config file alone. Safe to call
 * on web too; it no-ops there via the isNativePlatform() check.
 *
 * Call once, early, from your root client component (see
 * client-providers.tsx). The background matches the `ink` design token.
 */

import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';

export async function initStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: '#0a0e14' }); // matches the `ink` design token
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    // Fails harmlessly on platforms/emulators without full StatusBar support
    // (e.g. some web-view debug shells) — never let this block app startup.
  }
}