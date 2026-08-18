"use client";

/**
 * Push Notification Settings Component
 * Drop into any settings page or dashboard.
 *
 * Usage:
 *   import { PushNotificationSettings } from "@/components/push-notification-settings";
 *   <PushNotificationSettings />
 */

import { usePushNotifications } from "@/hooks/use-push-notifications";

export function PushNotificationSettings() {
  const { isSupported, isSubscribed, isLoading, error, subscribe, unsubscribe, sendTestNotification } = usePushNotifications();

  if (!isSupported) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
        <h3 className="font-semibold mb-1">🔔 Push Notifications</h3>
        <p className="text-sm text-muted-foreground">
          Push notifications aren't supported in this browser. Try Chrome, Firefox, or Edge.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold mb-1">🔔 Push Notifications</h3>
          <p className="text-sm text-muted-foreground">
            Receive instant alerts for new signals, price levels, and news.
          </p>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full ${isSubscribed ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-500/15 text-slate-400"}`}>
          {isSubscribed ? "Active" : "Inactive"}
        </span>
      </div>

      {error && (
        <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!isSubscribed ? (
          <button
            onClick={subscribe}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
          >
            {isLoading ? "Subscribing..." : "Enable Notifications"}
          </button>
        ) : (
          <>
            <button
              onClick={sendTestNotification}
              disabled={isLoading}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10"
            >
              Send Test
            </button>
            <button
              onClick={unsubscribe}
              disabled={isLoading}
              className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/20"
            >
              {isLoading ? "Disabling..." : "Disable"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
