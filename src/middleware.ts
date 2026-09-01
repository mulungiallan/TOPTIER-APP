/**
 * Next.js Middleware — applies security headers, CSRF protection, rate
 * limiting, and lightweight JWT gating to all routes.
 *
 * Runs on the Edge runtime. Note: middleware does NOT verify JWT signatures
 * (that requires a DB lookup for token revocation and is done in route
 * handlers via authenticateRequest()/verifyToken()). This middleware only
 * performs a structural check so obviously-invalid requests fail fast.
 * Route handlers are ALWAYS the source of truth for authentication.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  applySecurityHeaders,
  isCSRFSafe,
  checkRateLimit,
  getClientIP,
  logSecurityEvent,
  generateNonce,
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
  "/api/account/deletion-request",      // public data-deletion request
  "/api/webhooks",                      // Stripe, payment webhooks
  "/api/tracking/event",               // anonymous usage tracking
  "/api/health",                        // health check
  "/api/news",                          // public market news feed
  "/api/calendar",                      // public economic calendar
  "/api/ticker",                        // public ticker quotes
  "/api/leaderboards",                  // public leaderboards
  "/api/currency/convert",              // public currency conversion
  "/api/market",                        // public market overview
  "/api/platform/stats",                // public platform statistics
  "/api/pricing/localize",              // localized pricing display
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

  // Forward the CSP nonce to the layout via a request header so inline
  // <script> tags can bind it (read via headers() in src/app/layout.tsx).
  const forwarded = new Headers(req.headers);
  const nonce = generateNonce();
  forwarded.set("x-csp-nonce", nonce);

  const res = NextResponse.next({ request: { headers: forwarded } });

  // 1. Apply security headers to every response
  applySecurityHeaders(res, nonce);

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

  // 5. Lightweight JWT gating for protected API routes.
  //    This ONLY checks that a well-formed token is present so bad requests
  //    fail fast. It does NOT verify the signature or revocation status —
  //    every route handler MUST call verifyToken()/authenticateRequest() for
  //    the real check. We deliberately do NOT forward a userId header derived
  //    from an unverified token into route handlers.
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
