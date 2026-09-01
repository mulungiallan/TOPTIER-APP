/**
 * Security helpers — security headers, CSRF, rate limiting, sanitization.
 * Consumed by src/middleware.ts. Edge-runtime safe (no Node-only APIs).
 */

import { NextRequest, NextResponse } from "next/server";

// Generate a CSP nonce using the Web Crypto API (edge + node safe).
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ============ SECURITY HEADERS ============
export function applySecurityHeaders(res: NextResponse, nonce?: string): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );

  // HSTS — only set in production over HTTPS
  if (process.env.NODE_ENV === "production") {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  }

  // CSP — nonce-based script-src to defeat XSS.
  // A fresh per-request nonce is generated and:
  //   - injected into script-src for the inline scripts Next.js emits, and
  //   - passed to the layout via the `x-csp-nonce` header, where it is bound
  //     to every <script> that needs 'unsafe-inline' (see src/app/layout.tsx).
  // Keeping 'unsafe-inline' as a fallback still lets any inline script run, so
  // for maximal protection additionally verify your script tags carry nonces.
  const cspNonce = nonce ?? generateNonce();
  res.headers.set(
    "Content-Security-Policy",
    [
      `default-src 'self'`,
      // 'unsafe-inline' is retained as a compatibility fallback for inline
      // event handlers/libs that don't carry the nonce; new code should rely
      // on the nonce.
      `script-src 'self' 'nonce-${cspNonce}' 'unsafe-inline' https://s3.tradingview.com https://js.stripe.com https://cdn.sentry.io`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https: https://*.tradingview.com",
      "connect-src 'self' https: wss://*.toptier.app",
      "frame-src 'self' https://js.stripe.com https://*.tradingview.com",
      "frame-ancestors 'none'",
      "form-action 'self' https:",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ")
  );
  res.headers.set("x-csp-nonce", cspNonce);

  return res;
}

// ============ CSRF PROTECTION ============
const CSRF_SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

export function isCSRFSafe(req: NextRequest): boolean {
  if (CSRF_SAFE_METHODS.includes(req.method)) return true;

  // Same-origin check: browser fetch/form POSTs send an Origin header.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return true;
    } catch {
      // malformed origin — treat as unsafe
    }
  }

  // Header + cookie token pairing (used by any non-browser clients)
  const csrfToken = req.headers.get("x-csrf-token");
  if (csrfToken) {
    const cookieToken = req.cookies.get("csrf-token")?.value;
    if (csrfToken === cookieToken) return true;
  }

  return false;
}

// ============ RATE LIMITING (in-memory, per-IP) ============
interface RateLimitEntry {
  count: number;
  resetAt: number;
  blocked: boolean;
}

const rateLimits = new Map<string, RateLimitEntry>();

interface RateLimitConfig {
  windowMs: number;
  max: number;
  blockDurationMs?: number;
}

const ROUTE_LIMITS: Record<string, RateLimitConfig> = {
  // Auth (single /api/auth route handles login + register via `action`)
  "/api/auth": { windowMs: 15 * 60 * 1000, max: 10, blockDurationMs: 30 * 60 * 1000 },
  "/api/auth/forgot-password": { windowMs: 15 * 60 * 1000, max: 5, blockDurationMs: 30 * 60 * 1000 },
  "/api/auth/reset-password": { windowMs: 15 * 60 * 1000, max: 5, blockDurationMs: 30 * 60 * 1000 },
  // Paid / sensitive operations
  "/api/payments/init": { windowMs: 60 * 1000, max: 10 },
  "/api/chart/analyze": { windowMs: 60 * 1000, max: 10 },
  "/api/trading/backtest": { windowMs: 60 * 1000, max: 5 },
  "/api/interest": { windowMs: 60 * 1000, max: 30 },
  "/api/admin": { windowMs: 60 * 1000, max: 60 },
  "/api/admin-actions": { windowMs: 60 * 1000, max: 60 },
  "/api/notifications/subscribe": { windowMs: 60 * 1000, max: 20 },
  "/api/messages": { windowMs: 60 * 1000, max: 30 },
  "/api/support": { windowMs: 60 * 1000, max: 10 },
  "/api/signals": { windowMs: 60 * 1000, max: 20 },
  "/api/social/feed": { windowMs: 60 * 1000, max: 20 },
  "/api/tracking/event": { windowMs: 60 * 1000, max: 30 },
};

const DEFAULT_LIMIT: RateLimitConfig = { windowMs: 60 * 1000, max: 120 };

export function checkRateLimit(
  req: NextRequest
): { allowed: boolean; remaining: number; resetAt: number; limit: number } {
  const ip = getClientIP(req);
  const path = new URL(req.url).pathname;
  const config = ROUTE_LIMITS[path] || DEFAULT_LIMIT;
  const key = `${ip}:${path}`;
  const now = Date.now();

  // Lazy cleanup of expired entries (avoids timers in Edge runtime)
  if (rateLimits.size > 5000) {
    for (const [k, e] of rateLimits.entries()) {
      if (e.resetAt < now) rateLimits.delete(k);
    }
  }

  const entry = rateLimits.get(key);
  if (entry) {
    if (entry.blocked && entry.resetAt > now) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt, limit: config.max };
    }
    if (entry.resetAt < now) {
      rateLimits.set(key, { count: 1, resetAt: now + config.windowMs, blocked: false });
      return { allowed: true, remaining: config.max - 1, resetAt: now + config.windowMs, limit: config.max };
    }
    entry.count++;
    if (entry.count > config.max) {
      if (config.blockDurationMs) {
        rateLimits.set(key, {
          count: entry.count,
          resetAt: now + config.blockDurationMs,
          blocked: true,
        });
      }
      return { allowed: false, remaining: 0, resetAt: entry.resetAt, limit: config.max };
    }
    return { allowed: true, remaining: config.max - entry.count, resetAt: entry.resetAt, limit: config.max };
  }

  rateLimits.set(key, { count: 1, resetAt: now + config.windowMs, blocked: false });
  return { allowed: true, remaining: config.max - 1, resetAt: now + config.windowMs, limit: config.max };
}

export function getClientIP(req: NextRequest): string {
  // Only trust forwarded headers when behind a verified reverse proxy.
  // Use x-real-ip first (set by Caddy/nginx), then x-forwarded-for as fallback.
  const real = req.headers.get("x-real-ip")
  if (real) return real
  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  return "unknown"
}

// ============ INPUT SANITIZATION ============

/** Escape HTML special characters to prevent XSS when interpolating into HTML. */
export function escapeHtml(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function sanitizeString(input: string, maxLength = 1000): string {
  if (typeof input !== 'string') return '';
  // Strip HTML tags entirely, then escape remaining special chars.
  // This is a defense-in-depth layer; React already escapes by default.
  return input
    .slice(0, maxLength)
    .replace(/<[^>]*>/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

export function sanitizeEmail(email: string): string {
  const cleaned = sanitizeString(email, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) ? cleaned : "";
}

export function assertSafeIdentifier(input: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
    throw new Error("Invalid identifier");
  }
}

// ============ AUDIT LOGGING ============
export async function logSecurityEvent(event: {
  type: "auth" | "rate_limit" | "csrf" | "suspicious" | "data_access";
  userId?: string;
  ip: string;
  userAgent?: string;
  path: string;
  method: string;
  details?: Record<string, any>;
  severity: "info" | "warn" | "critical";
}): Promise<void> {
  const log = { timestamp: new Date().toISOString(), ...event };
  // Log at appropriate level based on severity (structured format for log aggregators)
  if (event.severity === "critical") {
    console.error("[SECURITY:CRITICAL]", JSON.stringify(log));
  } else if (event.severity === "warn") {
    console.warn("[SECURITY:WARN]", JSON.stringify(log));
  } else {
    console.info("[SECURITY:INFO]", JSON.stringify(log));
  }
}
