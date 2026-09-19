import type { MetadataRoute } from "next";

// Generated from the same env var that drives the sitemap + metadata so the
// robots.txt URL always matches the live canonical domain.
const base =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://toptier-production.up.railway.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
      {
        userAgent: ["Googlebot", "Bingbot", "Twitterbot", "facebookexternalhit"],
        allow: "/",
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}