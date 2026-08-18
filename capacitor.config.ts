import type { CapacitorConfig } from '@capacitor/cli';

// Production backend the native shell loads. MUST be a public HTTPS domain
// before store submission (stores reject cleartext / LAN addresses).
// Override locally for testing: TOPTIER_BACKEND_URL=http://<lan-ip>:3000 npx cap sync android
const backendUrl = process.env.TOPTIER_BACKEND_URL || 'https://app.toptier.app';

const config: CapacitorConfig = {
  appId: 'com.toptier.app',
  appName: 'TOPTIER',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    // The app is a full-stack Next.js app; the native shell loads the
    // deployed backend and talks to its /api/* routes.
    url: backendUrl,
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0a0a0a',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0a',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_signal',
      iconColor: '#6366f1',
    },
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
