/**
 * Session Management API
 * GET  /api/auth/session/devices  — list active sessions/devices
 * POST /api/auth/session/revoke   — revoke specific session
 * POST /api/auth/session/revoke-all — revoke all other sessions (force logout)
 *
 * Drop into: src/app/api/auth/session/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

function parseUserAgent(ua: string): { device: string; browser: string; os: string } {
  let browser = "Unknown";
  let os = "Unknown";
  let device = "Desktop";

  if (/chrome|chromium|crios/i.test(ua)) browser = "Chrome";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";
  else if (/edg/i.test(ua)) browser = "Edge";

  if (/windows/i.test(ua)) os = "Windows";
  else if (/macintosh|mac os x/i.test(ua)) os = "macOS";
  else if (/linux/i.test(ua)) os = "Linux";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";

  if (/mobile|android|iphone/i.test(ua)) device = "Mobile";
  else if (/ipad|tablet/i.test(ua)) device = "Tablet";

  return { device, browser, os };
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const sessions = await prisma.session.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
    });

    const currentSessionToken = req.headers.get("authorization")?.replace("Bearer ", "");

    const devices = sessions.map((s) => {
      const parsed = parseUserAgent(s.userAgent || "");
      return {
        id: s.id,
        device: parsed.device,
        browser: parsed.browser,
        os: parsed.os,
        ip: s.ip || "Unknown",
        location: s.location || "Unknown",
        lastUsedAt: s.lastUsedAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
        current: s.token === currentSessionToken,
      };
    });

    return NextResponse.json({ success: true, data: devices });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action, sessionId } = body;

    if (action === "revoke" && sessionId) {
      await prisma.session.deleteMany({ where: { id: sessionId, userId: user.id } });
      return NextResponse.json({ success: true });
    }

    if (action === "revoke-all") {
      // Revoke all sessions EXCEPT the current one
      const currentToken = req.headers.get("authorization")?.replace("Bearer ", "");
      await prisma.session.deleteMany({
        where: {
          userId: user.id,
          NOT: { token: currentToken || "none" },
        },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
