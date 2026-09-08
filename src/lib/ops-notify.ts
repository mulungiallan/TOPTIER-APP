// src/lib/ops-notify.ts
// Fire-and-forget ops webhook. Set OPS_WEBHOOK_URL in env to stream critical
// admin events to an ops channel (Slack/Discord/Telegram bot incoming webhook).
// Never throws; failures are logged only.

export async function notifyOps(event: string, payload: Record<string, unknown>): Promise<void> {
  const url = process.env.OPS_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[${process.env.NODE_ENV === 'production' ? 'PROD' : 'DEV'}] ${event}\n${JSON.stringify(payload, null, 2)}`,
        event,
        ...payload,
      }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (e) {
    console.error('[ops-notify] failed to notify ops webhook:', e)
  }
}

export async function notifyOpsCritical(
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  await notifyOps(`⚠️ ${event}`, payload)
}

// Guaranteed to resolve (used in non-awaited fire-and-forget chains).
export function fireOps(event: string, payload: Record<string, unknown>): void {
  void notifyOps(event, payload)
}