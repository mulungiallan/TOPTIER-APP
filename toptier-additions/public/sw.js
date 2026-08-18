/**
 * Service Worker for TOPTIER
 * Drop into: public/sw.js
 *
 * Handles:
 *  - Push notification display
 *  - Notification click → opens app / navigates to URL
 *  - Background sync (future)
 *  - Offline cache (PWA)
 */

const CACHE_NAME = "toptier-v1";
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  "/",
  "/dashboard",
  "/offline.html",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.json",
];

// ---------- Install: precache app shell ----------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ---------- Activate: clean old caches ----------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ---------- Push event ----------
self.addEventListener("push", (event) => {
  let payload = { title: "TOPTIER", body: "New notification", data: {} };
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (e) {
    if (event.data) payload.body = event.data.text();
  }

  const options = {
    body: payload.body,
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/badge-72.png",
    tag: payload.tag || "default",
    requireInteraction: payload.requireInteraction || false,
    data: payload.data || { url: "/" },
    actions: payload.actions || [],
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// ---------- Notification click ----------
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  if (event.action === "dismiss") return;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if found
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ---------- Fetch: offline-first for app shell, network-first for API ----------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET
  if (req.method !== "GET") return;

  // Skip cross-origin
  if (url.origin !== location.origin) return;

  // Skip API calls (always network)
  if (url.pathname.startsWith("/api/")) return;

  // App shell: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Cache successful responses
        if (res.ok && res.type === "basic") {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      }).catch(() => {
        // Offline fallback
        if (req.mode === "navigate") {
          return caches.match(OFFLINE_URL);
        }
      });
    })
  );
});

// ---------- Background sync (future: queue offline actions) ----------
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-signals") {
    event.waitUntil(syncSignals());
  }
});

async function syncSignals() {
  // Future: replay any queued signal actions
  console.log("[SW] Background sync triggered");
}
