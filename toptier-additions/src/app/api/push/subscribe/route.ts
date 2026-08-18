/**
 * POST /api/push/subscribe
 * Body: { endpoint, keys: { p256dh, auth } }
 * Saves subscription for the current user.
 *
 * Drop into: src/app/api/push/subscribe/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { endpoint, keys } = body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json(
        { success: false, error: "endpoint, keys.p256dh, keys.auth are required" },
        { status: 400 }
      );
    }

    // Upsert subscription
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        endpoint,
        userId: user.id,
        keysP256dh: keys.p256dh,
        keysAuth: keys.auth,
        createdAt: new Date(),
      },
      update: {
        userId: user.id,
        keysP256dh: keys.p256dh,
        keysAuth: keys.auth,
      },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[/api/push/subscribe] Error:", e);
    return NextResponse.json(
      { success: false, error: e.message || "Failed to subscribe" },
      { status: 500 }
    );
  }
}
