/**
 * POST /api/push/unsubscribe
 * Body: { endpoint }
 *
 * Drop into: src/app/api/push/unsubscribe/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { endpoint } = body;

    if (!endpoint) {
      return NextResponse.json(
        { success: false, error: "endpoint is required" },
        { status: 400 }
      );
    }

    await prisma.pushSubscription.deleteMany({ where: { endpoint } });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[/api/push/unsubscribe] Error:", e);
    return NextResponse.json(
      { success: false, error: e.message || "Failed to unsubscribe" },
      { status: 500 }
    );
  }
}
