"""
Notification queue.

This module does NOT play sounds or vibrate a device — Python running in
your backend has no access to a user's phone hardware. What it does is:
  1. Decide what a notification should say and how it should behave
     (sound name, vibration pattern, priority) based on defaults or a
     user's custom override.
  2. Queue it so your client app can retrieve it (via polling or the
     WebSocket push channel in api.py) and actually trigger the device's
     sound/vibration APIs.

DEFAULT_SOUND / DEFAULT_VIBRATION are the platform-agnostic identifiers
your client app maps to a real asset:
  - 'default'       -> the app's standard alert tone / standard vibration pattern
  - 'silent'        -> no sound / no vibration (still shows a visual notification)
  - anything else   -> a custom sound filename (e.g. 'chime_2.mp3') or a
                        vibration pattern string of milliseconds
                        (e.g. '200,100,200' = buzz 200ms, pause 100ms, buzz 200ms)

Vibration pattern format matches the Web Vibration API / most mobile
frameworks: a comma-separated list of durations in ms, alternating
vibrate/pause. Your client just needs to parse it into an array.
"""

from __future__ import annotations
import json
from . import db

DEFAULT_SOUND = "default"
DEFAULT_VIBRATION = "default"

# Suggested default vibration patterns per priority, for clients that want
# a sane built-in mapping rather than defining their own "default" pattern.
SUGGESTED_VIBRATION_PATTERNS = {
    "normal": "200",            # one short buzz
    "high": "200,100,200,100,200",  # three sharp buzzes — TP/SL/signal urgency
}


def enqueue_notification(
    user_id: str,
    title: str,
    body: str,
    alert_id: int | None = None,
    sound: str = DEFAULT_SOUND,
    vibration: str = DEFAULT_VIBRATION,
    priority: str = "normal",
    payload: dict | None = None,
) -> dict:
    notif_id = db.execute(
        """INSERT INTO notifications (user_id, alert_id, title, body, sound, vibration, priority, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (user_id, alert_id, title, body, sound, vibration, priority, json.dumps(payload or {})),
    )
    return get_notification(notif_id)


def get_notification(notif_id: int) -> dict | None:
    row = db.query_one("SELECT * FROM notifications WHERE id = ?", (notif_id,))
    if row:
        row["payload"] = json.loads(row["payload"] or "{}")
    return row


def get_pending_notifications(user_id: str) -> list[dict]:
    """
    Notifications not yet delivered to the client. Poll this endpoint (or
    use the WebSocket push channel) then call mark_delivered() for each one
    once your app has shown it and triggered sound/vibration.
    """
    rows = db.query_all(
        "SELECT * FROM notifications WHERE user_id = ? AND delivered = 0 ORDER BY created_at", (user_id,)
    )
    for r in rows:
        r["payload"] = json.loads(r["payload"] or "{}")
    return rows


def mark_delivered(notif_id: int) -> dict:
    db.execute(
        "UPDATE notifications SET delivered = 1, delivered_at = datetime('now') WHERE id = ?", (notif_id,)
    )
    return get_notification(notif_id)


def get_notification_history(user_id: str, limit: int = 100) -> list[dict]:
    rows = db.query_all(
        "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", (user_id, limit)
    )
    for r in rows:
        r["payload"] = json.loads(r["payload"] or "{}")
    return rows
