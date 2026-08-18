/**
 * Security Middleware — security headers, CSRF, rate limiting, sanitization
 * Drop into: src/lib/security.ts
 *
 * Apply in: middleware.ts at project root
 */

import { NextRequest, NextResponse } from "next/server";

// ============ SECURITY HEADERS ============
export function applySecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-XSS-Protection", "1; mode=block");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");

  // HSTS — only set in production over HTTPS
  if (process.env.NODE_ENV === "production") {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  // CSP
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://s3.tradingview.com https://js.stripe.com https://cdn.sentry.io",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https: https://*.tradingview.com",
      "connect-src 'self' https: wss: ws:",
      "frame-src 'self' https://js.stripe.com https://*.tradingview.com",
      "frame-ancestors 'none'",
      "form-action 'self' https:",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ")
  );

  return res;
}

// ============ CSRF PROTECTION ============
const CSRF_SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

export function isCSRFSafe(req: NextRequest): boolean {
  if (CSRF_SAFE_METHODS.includes(req.method)) return true;

  // Check Origin header
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return true;
    } catch {}
  }

  // Check for CSRF token in header
  const csrfToken = req.headers.get("x-csrf-token");
  if (csrfToken) {
    // Verify against cookie
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
const RATE_LIMIT_CLEANUP_INTERVAL = 60 * 1000;

// Cleanup expired entries periodically
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimits.entries()) {
      if (entry.resetAt < now) rateLimits.delete(key);
    }
  }, RATE_LIMIT_CLEANUP_INTERVAL).unref();
}

interface RateLimitConfig {
  windowMs: number;
  max: number;
  blockDurationMs?: number;
}

const ROUTE_LIMITS: Record<string, RateLimitConfig> = {
  "/api/auth/login": { windowMs: 15 * 60 * 1000, max: 5, blockDurationMs: 30 * 60 * 1000 },
  "/api/auth/register": { windowMs: 60 * 60 * 1000, max: 3 },
  "/api/auth/2fa": { windowMs: 5 * 60 * 1000, max: 5, blockDurationMs: 15 * 60 * 1000 },
  "/api/auth/email": { windowMs: 60 * 60 * 1000, max: 3 },
  "/api/stripe": { windowMs: 60 * 1000, max: 10 },
  "/api/signals-generate": { windowMs: 60 * 1000, max: 30 },
  "/api/screenshot-analyze": { windowMs: 60 * 1000, max: 10 },
  "/api/backtest": { windowMs: 60 * 1000, max: 5 },
  "/api/paper-trade": { windowMs: 60 * 1000, max: 30 },
  "/api/push/subscribe": { windowMs: 60 * 1000, max: 10 },
  "/api/push/unsubscribe": { windowMs: 60 * 1000, max: 10 },
  "/api/news": { windowMs: 60 * 1000, max: 20 },
  "/api/calendar": { windowMs: 60 * 1000, max: 20 },
};

const DEFAULT_LIMIT: RateLimitConfig = { windowMs: 60 * 1000, max: 60 };

export function checkRateLimit(req: NextRequest): { allowed: boolean; remaining: number; resetAt: number } {
  const ip = getClientIP(req);
  const path = new URL(req.url).pathname;
  const config = ROUTE_LIMITS[path] || DEFAULT_LIMIT;
  const key = `${ip}:${path}`;
  const now = Date.now();

  const entry = rateLimits.get(key);
  if (entry) {
    if (entry.blocked && entry.resetAt > now) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }
    if (entry.resetAt < now) {
      // Reset window
      rateLimits.set(key, { count: 1, resetAt: now + config.windowMs, blocked: false });
      return { allowed: true, remaining: config.max - 1, resetAt: now + config.windowMs };
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
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }
    return { allowed: true, remaining: config.max - entry.count, resetAt: entry.resetAt };
  }

  rateLimits.set(key, { count: 1, resetAt: now + config.windowMs, blocked: false });
  return { allowed: true, remaining: config.max - 1, resetAt: now + config.windowMs };
}

export function getClientIP(req: NextRequest): string {
  // Only trust forwarded headers when behind a verified reverse proxy.
  // Use x-real-ip first (set by Caddy/nginx), then x-forwarded-for as fallback.
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

// ============ INPUT SANITIZATION ============
export function sanitizeString(input: string, maxLength = 1000): string {
  if (typeof input !== "string") return "";
  return input
    .slice(0, maxLength)
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .trim();
}

export function sanitizeEmail(email: string): string {
  const cleaned = sanitizeString(email, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) ? cleaned : "";
}

// SQL injection prevention: Prisma already parameterizes queries,
// but for raw queries, always use tagged templates:
// prisma.$queryRaw`SELECT * FROM User WHERE email = ${email}`
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
  const log = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  // Log at appropriate level based on severity (structured format for log aggregators)
  if (event.severity === "critical") {
    console.error("[SECURITY:CRITICAL]", JSON.stringify(log));
  } else if (event.severity === "warn") {
    console.warn("[SECURITY:WARN]", JSON.stringify(log));
  } else {
    console.info("[SECURITY:INFO]", JSON.stringify(log));
  }
}
