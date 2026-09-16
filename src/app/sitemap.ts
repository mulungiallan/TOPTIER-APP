import type { MetadataRoute } from "next";

// Public (crawlable) pages only. Everything behind the login state-machine is
// excluded — Google can't reach authed content and we don't want to leak
// placeholder pages into the index. The domain is the live production URL so
// the sitemap stays correct on any deployment environment.
const base =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://toptier.in";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const lastModified = now.toISOString();
  return [
    { url: `${base}/`, lastModified },
    { url: `${base}/privacy`, lastModified },
    { url: `${base}/terms`, lastModified },
    { url: `${base}/ugc`, lastModified },
    { url: `${base}/account-deletion`, lastModified },
  ];
}