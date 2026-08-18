/**
 * Client-side push notification hook
 * Drop into: src/hooks/use-push-notifications.ts
 *
 * Usage in components:
 *   const { isSupported, isSubscribed, subscribe, unsubscribe } = usePushNotifications();
 */

"use client";

import { useState, useEffect, useCallback } from "react";

interface PushState {
  isSupported: boolean;
  isSubscribed: boolean;
  isLoading: boolean;
  error: string | null;
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>({
    isSupported: false,
    isSubscribed: false,
    isLoading: false,
    error: null,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported = "serviceWorker" in navigator && "PushManager" in window;
    setState((s) => ({ ...s, isSupported: supported }));
    if (supported) {
      checkSubscription();
    }
  }, []);

  const checkSubscription = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState((s) => ({ ...s, isSubscribed: !!sub }));
    } catch (e) {
      console.error("Failed to check push subscription:", e);
    }
  }, []);

  const subscribe = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      // Request permission first
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission denied");
      }

      // Register service worker
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Subscribe with VAPID public key
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) throw new Error("VAPID public key not configured");

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      // Save subscription to backend
      const subJson = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
        }),
      });

      if (!res.ok) throw new Error("Failed to save subscription on server");

      setState((s) => ({ ...s, isSubscribed: true, isLoading: false }));
      return true;
    } catch (e: any) {
      setState((s) => ({ ...s, isLoading: false, error: e.message || "Subscribe failed" }));
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
      }
      setState((s) => ({ ...s, isSubscribed: false, isLoading: false }));
      return true;
    } catch (e: any) {
      setState((s) => ({ ...s, isLoading: false, error: e.message || "Unsubscribe failed" }));
      return false;
    }
  }, []);

  const sendTestNotification = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification("TOPTIER Test", {
        body: "Push notifications are working! 🔔",
        icon: "/icon-192.png",
        badge: "/badge-72.png",
        tag: "test",
      });
    } catch (e) {
      console.error("Test notification failed:", e);
    }
  }, []);

  return {
    ...state,
    subscribe,
    unsubscribe,
    sendTestNotification,
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
