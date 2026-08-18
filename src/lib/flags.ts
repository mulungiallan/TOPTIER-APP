// Feature flags. Read from NEXT_PUBLIC_* env vars so they work on both
// client and server (Next.js only inlines NEXT_PUBLIC_* into the browser).
import { Capacitor } from '@capacitor/core'

// When false, all checkout/payment routes return 503 and the UI shows
// "Coming Soon" buttons instead of live checkout. Flip to true (and configure
// real provider keys) to enable payments — no other code changes needed.
//
// Store policy: Google Play and the Apple App Store require their own in-app
// billing for digital goods/subscriptions. External web checkouts (Stripe,
// PayPal, etc.) are rejected in native builds, so payments are forced off when
// the app runs inside the Capacitor shell (isNativePlatform() is false on the
// server and in the browser, so it only disables the native store build).
export const PAYMENTS_ENABLED =
  process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === 'true' && !Capacitor.isNativePlatform()
