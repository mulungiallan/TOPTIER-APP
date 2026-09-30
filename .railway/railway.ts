import { defineRailway, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  // 500MB was not enough: the app grew to a ~379MB database plus a ~65MB WAL,
  // which filled the volume and took down every write path. Resizable online.
  const toptierVolume = volume("toptier-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {}, "70": {} } }, allowOnlineResize: true, region: "ams", sizeMB: 2000 });
  // Dedicated backup target, on its OWN volume.
  //
  // Backups must never share the disk that fills up. On 2026-09-30 the data volume
  // hit 100%, and the boot-time file swap installed a compacted copy of a database
  // whose recent writes were still only in the -wal sidecar. Every user, wallet and
  // payment row was gone and there was no second copy anywhere, which turned a
  // recoverable disk-full into a total loss. src/lib/services/db-backup.ts writes
  // verified VACUUM INTO snapshots here, so that failure cannot repeat.
  const toptierBackupVolume = volume("toptier-backups", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "ams", sizeMB: 2000 });
  const toptier = service("toptier", {
    build: "npm install --include=dev --no-audit --no-fund && npx prisma generate && npm run build",
    // ensure-space MUST be first: this IaC file overrides railway.toml, so the
    // reclaim only runs if it is listed here. The SQLite volume fills up over
    // time and a full disk fails every write (login, screenshot analysis,
    // signal generation) while a read-only health check still looks healthy.
    start: "mkdir -p /data/db && node scripts/ensure-space.js && npx prisma db push --skip-generate --accept-data-loss && node scripts/ensure-admin.js && node scripts/ensure-packages.js && node scripts/ensure-tickers.js && node scripts/ensure-ebooks.js && node .next/standalone/server.js",
    healthcheck: "/api/health",
    replicas: { "ams": 1 },
    deploy: { restartPolicyMaxRetries: 5 },
    domains: [],
    volumeMounts: { "/data": toptierVolume, "/backups": toptierBackupVolume },
    env: { ADMIN_PASSWORD: preserve(), ANTHROPIC_API_KEY: preserve(), BINANCE_WITHDRAWALS_ENABLED: preserve(), BOT_CREDENTIALS_SECRET: preserve(), BOT_SERVICE_KEY: preserve(), BOT_SERVICE_URL: preserve(), DATABASE_URL: preserve(), EMAIL_FROM: preserve(), FINNHUB_API_KEY: preserve(), GEMINI_API_KEY: preserve(), GOOGLE_CLIENT_ID: preserve(), APPLE_CLIENT_ID: preserve(), HF_TOKEN: preserve(), HOSTNAME: preserve(), NEXTAUTH_SECRET: preserve(), NEXT_PUBLIC_APP_URL: preserve(), NEXT_PUBLIC_BROKER_REFERRAL_URL: preserve(), NEXT_PUBLIC_PAYMENTS_ENABLED: preserve(), NODE_ENV: preserve(), PESAPAL_CONSUMER_KEY: preserve(), PESAPAL_CONSUMER_SECRET: preserve(), PESAPAL_ENVIRONMENT: preserve(), REFERRAL_LOCK_CODE: preserve(), REFERRAL_LOCK_ENABLED: preserve(), REFERRAL_LOCK_URL: preserve(), TOPTIER_BACKEND_URL: preserve(), VAPID_SUBJECT: preserve() },
  });

  return project("peaceful-contentment", {
    resources: [toptier, toptierVolume, toptierBackupVolume],
  });
});
