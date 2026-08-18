/**
 * Push Notification Service (Web Push API + VAPID)
 * Drop into: src/lib/push-service.ts
 *
 * Server-side: send push notifications to subscribed browsers/devices
 * Client-side: register service worker, subscribe, save subscription to DB
 *
 * Requires: npm install web-push
 */

import webpush from "web-push";

// ---------- Initialize VAPID ----------
let initialized = false;
function init() {
  if (initialized) return;
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn("VAPID keys not set — push notifications disabled");
    return;
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@toptier.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  initialized = true;
}

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userId: string;
  createdAt: string;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
  tag?: string;
  requireInteraction?: boolean;
  actions?: { action: string; title: string; icon?: string }[];
}

// ---------- Send to single subscription ----------
export async function sendPush(subscription: PushSubscription, payload: PushPayload): Promise<boolean> {
  try {
    init();
    if (!initialized) return false;
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload)
    );
    return true;
  } catch (e: any) {
    console.error("Push send failed:", e?.statusCode, e?.message);
    // 410 = subscription gone, should remove from DB
    if (e?.statusCode === 410 || e?.statusCode === 404) {
      return false; // caller should delete subscription
    }
    return false;
  }
}

// ---------- Broadcast to many subscriptions ----------
export async function broadcastPush(subscriptions: PushSubscription[], payload: PushPayload): Promise<{ sent: number; failed: number; }> {
  let sent = 0;
  let failed = 0;
  const failedSubs: PushSubscription[] = [];

  // Send in batches of 10 to avoid overwhelming
  const batches = [];
  for (let i = 0; i < subscriptions.length; i += 10) {
    batches.push(subscriptions.slice(i, i + 10));
  }

  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map((sub) => sendPush(sub, payload))
    );
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) sent++;
      else {
        failed++;
        failedSubs.push(batch[i]);
      }
    });
  }

  return { sent, failed };
}

// ---------- Notification templates ----------
export const notificationTemplates = {
  newSignal: (signal: { pair: string; direction: string; entryPrice: number; stopLoss: number; takeProfit: number }) => ({
    title: `New ${signal.direction.toUpperCase()} Signal: ${signal.pair}`,
    body: `Entry: ${signal.entryPrice} | SL: ${signal.stopLoss} | TP: ${signal.takeProfit}`,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    tag: "new-signal",
    requireInteraction: true,
    actions: [
      { action: "view", title: "View Signal" },
      { action: "dismiss", title: "Dismiss" },
    ],
    data: { url: "/signals", type: "new_signal", pair: signal.pair },
  }),

  signalHit: (signal: { pair: string; direction: string; type: "TP" | "SL"; price: number }) => ({
    title: `${signal.type === "TP" ? "✅ Take Profit Hit" : "🛑 Stop Loss Hit"}: ${signal.pair}`,
    body: `${signal.direction.toUpperCase()} ${signal.pair} reached ${signal.type} at ${signal.price}`,
    icon: "/icon-192.png",
    tag: `signal-${signal.pair}`,
    data: { url: "/signals", type: "signal_update" },
  }),

  economicEvent: (event: { title: string; country: string; time: string }) => ({
    title: `📅 Upcoming: ${event.title}`,
    body: `${event.country} — releases at ${event.time} UTC`,
    icon: "/icon-192.png",
    tag: "economic-event",
    data: { url: "/calendar", type: "economic_event" },
  }),

  newsAlert: (news: { title: string; source: string }) => ({
    title: "📰 Breaking News",
    body: `${news.title} — ${news.source}`,
    icon: "/icon-192.png",
    tag: "news",
    data: { url: "/news", type: "news" },
  }),

  priceAlert: (alert: { symbol: string; price: number; condition: "above" | "below"; target: number }) => ({
    title: `🔔 ${alert.symbol} ${alert.condition} ${alert.target}`,
    body: `${alert.symbol} is now at ${alert.price}`,
    icon: "/icon-192.png",
    tag: `price-alert-${alert.symbol}`,
    requireInteraction: true,
    data: { url: "/markets", type: "price_alert" },
  }),
};
