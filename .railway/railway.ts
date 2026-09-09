import { defineRailway, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const toptierVolume = volume("toptier-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "ams", sizeMB: 500 });
  const toptier = service("toptier", {
    build: "npm install --include=dev --no-audit --no-fund && npx prisma generate && npm run build",
    start: "mkdir -p /data/db && npx prisma db push --skip-generate && node scripts/ensure-admin.js && node .next/standalone/server.js",
    healthcheck: "/api/health",
    replicas: { "ams": 1 },
    deploy: { restartPolicyMaxRetries: 5 },
    domains: ["app.toptier.app"],
    volumeMounts: { "/data": toptierVolume },
    env: { ADMIN_PASSWORD: preserve(), ANTHROPIC_API_KEY: preserve(), BINANCE_WITHDRAWALS_ENABLED: preserve(), BOT_CREDENTIALS_SECRET: preserve(), BOT_SERVICE_KEY: preserve(), BOT_SERVICE_URL: preserve(), DATABASE_URL: preserve(), EMAIL_FROM: preserve(), FINNHUB_API_KEY: preserve(), GEMINI_API_KEY: preserve(), HF_TOKEN: preserve(), HOSTNAME: preserve(), NEXTAUTH_SECRET: preserve(), NEXT_PUBLIC_APP_URL: preserve(), NEXT_PUBLIC_BROKER_REFERRAL_URL: preserve(), NEXT_PUBLIC_PAYMENTS_ENABLED: preserve(), NODE_ENV: preserve(), REFERRAL_LOCK_CODE: preserve(), REFERRAL_LOCK_ENABLED: preserve(), REFERRAL_LOCK_URL: preserve(), TOPTIER_BACKEND_URL: preserve(), VAPID_SUBJECT: preserve() },
  });

  return project("peaceful-contentment", {
    resources: [toptier, toptierVolume],
  });
});
