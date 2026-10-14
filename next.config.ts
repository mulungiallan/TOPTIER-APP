import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { withSentryConfig } from "@sentry/nextjs";

// Serwist adds webpack plugins that are incompatible with Turbopack.
// Build with: next build --webpack  (serwist only works with webpack).
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
});

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  trailingSlash: false,
  typescript: { ignoreBuildErrors: false },
  distDir: ".next",
  async redirects() {
    return [
      // Legacy /index URL → canonical root (permanent 301, no chain)
      { source: "/index", destination: "/", permanent: true },
      // Vanity subdomain: bot.toptier.click always lands on the in-app
      // Trading Bot page. Host-matched so it never affects app.toptier.click.
      {
        source: "/:path*",
        has: [{ type: "host", value: "bot.toptier.click" }],
        destination: "https://app.toptier.click/?page=trading-bot",
        permanent: true,
      },
      // www collapses to the canonical root domain.
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.toptier.click" }],
        destination: "https://toptier.click/:path*",
        permanent: true,
      },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "**.tradingview.com" },
      { protocol: "https", hostname: "**.sentry.io" },
    ],
  },
  // Serwist injects webpack plugins; provide an empty turbopack config
  // so Next.js 16 doesn't error when it detects the mismatch.
  turbopack: {},
};

// Sentry build plugin: injects the SDK's tracing/replay bundling and source
// maps. Only enabled when a DSN is configured so local/dev builds with no
// Sentry project never fail.
const sentryEnabled = Boolean(
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
);

const baseExport = withSerwist(nextConfig);

export default sentryEnabled
  ? withSentryConfig(baseExport, {
      org: process.env.SENTRY_ORG || "",
      project: process.env.SENTRY_PROJECT || "",
      silent: !process.env.CI,
      sourcemaps: { hideSourceMaps: true } as never,
      widenClientFileUpload: true,
      telemetry: false,
    })
  : baseExport;
