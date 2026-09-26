// src/lib/screen-security.ts
//
// Anti-screenshot guard for the in-app e-book reader (Android native builds).
// Uses a custom Capacitor plugin that sets FLAG_SECURE on the WebView so the
// OS refuses to capture / record the screen while a book is open. Safe no-op
// on web / PWA.
import { Capacitor, registerPlugin } from '@capacitor/core'

interface ScreenSecurityPlugin {
  enable(): Promise<void>
  disable(): Promise<void>
}

const ScreenSecurity = registerPlugin<ScreenSecurityPlugin>('ScreenSecurity')

export async function enableScreenSecurity(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await ScreenSecurity.enable()
  } catch (e) {
    console.warn('ScreenSecurity enable failed:', e)
  }
}

export async function disableScreenSecurity(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await ScreenSecurity.disable()
  } catch (e) {
    console.warn('ScreenSecurity disable failed:', e)
  }
}