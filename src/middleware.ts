/**
 * Next.js Middleware — applies security headers, CSRF protection, rate
 * limiting, and JWT authentication to all routes.
 *
 * Runs on the Edge runtime. Full JWT signature verification happens in
 * individual route handlers via verifyToken(); this middleware performs
 * a lightweight format check and forwards the userId header so routes
 * don't have to re-decode.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  applySecurityHeaders,
  isCSRFSafe,
  checkRateLimit,
  getClientIP,
  logSecurityEvent,
} from "@/lib/security";

// Provider callbacks are excluded from CSRF — they POST from provider servers
// (no browser Origin) and are protected by their own signature verification.
const PROVIDER_CALLBACKS = [
  "/api/webhooks/stripe",
  "/api/payments/stripe/webhook",
  "/api/payments/mpesa/callback",
  "/api/payments/paypal/callback",
  "/api/payments/paystack/callback",
  "/api/payments/flutterwave/callback",
];

// Routes that are publicly accessible without authentication.
const PUBLIC_ROUTES = [
  "/api/auth",                          // login / register
  "/api/auth/reset-password",           // password reset
  "/api/auth/forgot-password",          // password reset request
  "/api/webhooks",                      // Stripe, payment webhooks
  "/api/tracking/event",               // anonymous usage tracking
  "/api/health",                        // health check
  "/",                                  // root
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(route + "/"));
}

/**
 * Lightweight JWT payload extraction (Edge-safe).
 * Does NOT verify the signature — that's done in route handlers via
 * verifyToken(). This only checks structural validity and extracts
 * the userId so route handlers don't re-decode.
 */
function extractUserId(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload || typeof payload.userId !== "string") return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const res = NextResponse.next();

  // 1. Apply security headers to every response
  applySecurityHeaders(res);

  // 2. Skip security checks for static assets and files with extensions
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return res;
  }

  // 3. Rate limiting
  const rateLimit = checkRateLimit(req);
  res.headers.set("X-RateLimit-Limit", rateLimit.limit.toString());
  res.headers.set("X-RateLimit-Remaining", rateLimit.remaining.toString());
  res.headers.set("X-RateLimit-Reset", rateLimit.resetAt.toString());

  if (!rateLimit.allowed) {
    logSecurityEvent({
      type: "rate_limit",
      ip: getClientIP(req),
      userAgent: req.headers.get("user-agent") || "",
      path: pathname,
      method: req.method,
      severity: "warn",
      details: { resetAt: rateLimit.resetAt },
    });

    return NextResponse.json(
      { success: false, error: "Rate limit exceeded. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  // 4. CSRF protection for state-changing requests
  const isProviderCallback = PROVIDER_CALLBACKS.some((p) => pathname.startsWith(p));
  const isSocketTransport = pathname.startsWith("/api/socket");

  if (!isCSRFSafe(req) && !isProviderCallback && !isSocketTransport) {
    logSecurityEvent({
      type: "csrf",
      ip: getClientIP(req),
      userAgent: req.headers.get("user-agent") || "",
      path: pathname,
      method: req.method,
      severity: "warn",
    });
    return NextResponse.json(
      { success: false, error: "CSRF verification failed" },
      { status: 403 }
    );
  }

  // 5. JWT authentication for protected API routes
  if (pathname.startsWith("/api/")) {
    if (!isPublicRoute(pathname)) {
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return NextResponse.json(
          { success: false, error: "Authentication required" },
          { status: 401 }
        );
      }

      const token = authHeader.substring(7).trim();
      const userId = extractUserId(token);

      if (!userId) {
        return NextResponse.json(
          { success: false, error: "Invalid or expired token" },
          { status: 401 }
        );
      }

      // Forward userId so route handlers don't re-decode
      const authedHeaders = new Headers(req.headers);
      authedHeaders.set("x-auth-user-id", userId);
      return NextResponse.next({ request: { headers: authedHeaders } });
    }
  }

  return res;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except provider callbacks (they sign their own
     * requests), the Socket.IO transport, and static assets.
     */
    "/((?!api/webhooks/stripe|api/payments/stripe/webhook|api/payments/mpesa/callback|api/payments/paypal/callback|api/payments/paystack/callback|api/payments/flutterwave/callback|api/socket|_next/static|_next/image|favicon.ico).*)",
  ],
};
