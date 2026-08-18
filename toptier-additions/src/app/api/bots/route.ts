/**
 * Bots API
 * GET    /api/bots         — list user's bots
 * POST   /api/bots         — create bot
 * POST   /api/bots/run     — manually trigger bot run
 * POST   /api/bots/toggle  — enable/disable bot
 * DELETE /api/bots         — delete bot
 *
 * Drop into: src/app/api/bots/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { bots } from "@/lib/bots";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const userBots = await bots.list(user.id);
    return NextResponse.json({ success: true, data: userBots });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    if (action === "create") {
      const bot = await bots.create(user.id, {
        name: body.name,
        strategy: body.strategy,
        symbols: body.symbols,
        timeframe: body.timeframe,
        riskPerTrade: body.riskPerTrade,
        maxPositions: body.maxPositions,
        autoExecute: body.autoExecute,
      });
      return NextResponse.json({ success: true, data: bot });
    }

    if (action === "run") {
      await bots.runBot(body.botId);
      return NextResponse.json({ success: true });
    }

    if (action === "toggle") {
      await bots.toggle(body.botId, body.active);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const botId = searchParams.get("id");
    if (!botId) return NextResponse.json({ success: false, error: "Bot ID required" }, { status: 400 });

    await bots.delete(botId);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
