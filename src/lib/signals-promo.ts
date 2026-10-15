// ─── Free-signals promotion ─────────────────────────────────────────────
// During this window EVERY signed-in user sees the full signal feed — no
// paywall and no 2/day cap — exactly like admins/owner. When the window ends
// the normal rules resume automatically (paywall + the 2 best signals/day).
//
// The window is controlled by the FREE_SIGNALS_UNTIL env var (ISO 8601). When
// unset it falls back to FREE_SIGNALS_UNTIL_DEFAULT below. Set it to a past
// date (or an invalid value) to turn the promotion off immediately — no code
// change needed.

const DAY_MS = 24 * 60 * 60 * 1000

// One month from launch: 2026-10-15 → 2026-11-15.
const FREE_SIGNALS_UNTIL_DEFAULT = '2026-11-15T23:59:59.000Z'

/** The instant the free-signals window closes, or null when disabled. */
export function signalsPromoEnd(): Date | null {
  const raw = process.env.FREE_SIGNALS_UNTIL?.trim()
  const candidate = raw && raw.length > 0 ? raw : FREE_SIGNALS_UNTIL_DEFAULT
  const end = new Date(candidate)
  if (Number.isNaN(end.getTime())) return null
  return end
}

/** True while all users should receive the full, uncapped signal feed. */
export function isSignalsPromoActive(now: Date = new Date()): boolean {
  const end = signalsPromoEnd()
  return end != null && now.getTime() < end.getTime()
}

/** Whole days left in the promotion (0 when inactive/expired). */
export function signalsPromoDaysLeft(now: Date = new Date()): number {
  const end = signalsPromoEnd()
  if (!end) return 0
  const ms = end.getTime() - now.getTime()
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS)
}
