/**
 * Next.js Middleware — applies security headers, CSRF, rate limiting to all routes
 * Drop into: src/middleware.ts (root of src/)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  applySecurityHeaders,
  isCSRFSafe,
  checkRateLimit,
  getClientIP,
  logSecurityEvent,
} from "@/lib/security";

const PUBLIC_PATHS = ["/", "/login", "/register", "/api/health", "/api/docs", "/manifest.json", "/sw.js", "/icon-", "/offline.html"];
const STATIC_PATHS = ["/_next/", "/favicon.ico", "/robots.txt", "/sitemap.xml"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const res = NextResponse.next();

  // 1. Apply security headers
  applySecurityHeaders(res);

  // 2. Skip security checks for static assets
  if (STATIC_PATHS.some((p) => pathname.startsWith(p))) {
    return res;
  }

  // 3. Rate limiting
  const rateLimit = checkRateLimit(req);
  res.headers.set("X-RateLimit-Limit", rateLimit.remaining.toString());
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
  if (!isCSRFSafe(req) && !pathname.startsWith("/api/stripe/webhook")) {
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

  return res;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/stripe/webhook (Stripe signs its own requests)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    "/((?!api/stripe/webhook|_next/static|_next/image|favicon.ico).*)",
  ],
};
