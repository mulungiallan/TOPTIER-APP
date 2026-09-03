import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, CacheFirst, NetworkOnly, Serwist } from "serwist";
import { defaultCache } from "@serwist/next/worker";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  // When offline, opening the app falls back to the cached app shell so the
  // PWA still launches (data simply isn't refreshed until back online).
  precacheOptions: {
    navigateFallback: "/",
  },
  runtimeCaching: [
    // HTML document navigations MUST always hit the network. The app is loaded
    // from the live backend, so serving a cached/navigateFallback app shell
    // makes installed devices show stale UI after a redeploy ("no changes").
    // Keeping this as the FIRST rule (NetworkOnly) guarantees fresh builds.
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" && url.href.startsWith(location.origin),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
    // PUBLIC market-data endpoints only. Auth-protected endpoints are NEVER
    // cached: their responses depend on the Authorization header, which is not
    // part of the cache key — caching them would leak one user's data to
    // another when offline.
    {
      matcher: /^\/api\/(?:ticker|news)(?:\?|$)/i,
      handler: new NetworkFirst({
        cacheName: "public-data-cache",
        networkTimeoutSeconds: 10,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 64,
            maxAgeSeconds: 24 * 60 * 60, // 24 hours
          }),
        ],
      }),
    },
    // Static assets - CacheFirst
    {
      matcher: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
      handler: new CacheFirst({
        cacheName: "static-images",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 64,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
          }),
        ],
      }),
    },
    // Fonts - CacheFirst
    {
      matcher: /\.(?:woff2?|ttf|otf|eot)$/i,
      handler: new CacheFirst({
        cacheName: "font-cache",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 16,
            maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
          }),
        ],
      }),
    },
  ],
});

serwist.addEventListeners();

// ─── Web Push ────────────────────────────────────────────────────────────────
// Show a notification when a push payload arrives, and route clicks back into
// the app. Payload shape is produced by src/lib/services/push-sender.ts.
const sw = self as unknown as {
  addEventListener(type: string, listener: (event: any) => void): void;
  clients: ServiceWorkerClients;
  registration: ServiceWorkerRegistration;
};
interface ServiceWorkerClients {
  matchAll(opts?: { type?: string; includeUncontrolled?: boolean }): Promise<Array<{ focus(): void }>>;
  openWindow(url: string): Promise<unknown>;
}

sw.addEventListener("push", (event: any) => {
  if (!event.data) return;
  let data: { title?: string; body?: string; url?: string } = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: event.data.text() };
  }
  const title = data.title || "TOPTIER";
  const options: NotificationOptions = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-72.png",
    data: { url: data.url || "/notifications" },
  };
  event.waitUntil(sw.registration.showNotification(title, options));
});

sw.addEventListener("notificationclick", (event: any) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url || "/notifications";
  event.waitUntil(
    sw.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          return;
        }
      }
      return sw.clients.openWindow(url);
    })
  );
});

export default serwist;
