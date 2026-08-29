import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

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
  typescript: { ignoreBuildErrors: false },
  distDir: ".next",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.tradingview.com" },
      { protocol: "https", hostname: "**.sentry.io" },
    ],
  },
  // Serwist injects webpack plugins; provide an empty turbopack config
  // so Next.js 16 doesn't error when it detects the mismatch.
  turbopack: {},
};

export default withSerwist(nextConfig);
