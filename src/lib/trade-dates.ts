/**
 * Trade timestamps arrive from the Python reporter as ISO-8601 strings
 * (e.g. "2026-09-25T10:00:52.803582+00:00"), but older/other callers send
 * Unix seconds. Coercing an ISO string with Number() yields NaN, and
 * `new Date(NaN)` is an Invalid Date that Prisma rejects - which turned every
 * single bot trade report into an HTTP 500 and silently lost the history.
 *
 * Accepts ISO strings, Unix seconds and Unix milliseconds, and returns null for
 * anything unusable so callers can decide on a fallback.
 */
export function parseTradeDate(value: unknown): Date | null {
  if (value == null) return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null
    // Anything past ~year 5138 in seconds is really milliseconds.
    return new Date(value > 1e11 ? value : value * 1000)
  }

  const raw = String(value).trim()
  if (!raw) return null

  // Bare numeric string: Unix seconds or milliseconds.
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) return null
    return new Date(n > 1e11 ? n : n * 1000)
  }

  // ISO-8601 and anything else Date understands.
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** parseTradeDate with an explicit fallback (e.g. "now") for missing values. */
export function parseTradeDateOr(value: unknown, fallback: Date): Date {
  return parseTradeDate(value) ?? fallback
}
