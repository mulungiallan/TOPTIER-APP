/**
 * Paper Trading API
 * GET    /api/paper-trade              — get account info
 * POST   /api/paper-trade/open         — open position
 * POST   /api/paper-trade/close        — close position
 * POST   /api/paper-trade/reset        — reset account
 * POST   /api/paper-trade/update-prices — update current prices (cron)
 *
 * Drop into: src/app/api/paper-trade/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { paperTrading } from "@/lib/paper-trading";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const account = await paperTrading.getAccount(user.id);
    return NextResponse.json({ success: true, data: account });
  } catch (e: any) {
    console.error("[/api/paper-trade GET] Error:", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    if (action === "open") {
      const { pair, direction, size, entryPrice, stopLoss, takeProfit } = body;
      if (!pair || !direction || !size || !entryPrice) {
        return NextResponse.json({ success: false, error: "pair, direction, size, entryPrice required" }, { status: 400 });
      }
      const position = await paperTrading.openPosition({
        userId: user.id, pair, direction, size, entryPrice, stopLoss, takeProfit,
      });
      return NextResponse.json({ success: true, data: position });
    }

    if (action === "close") {
      const { positionId, exitPrice } = body;
      if (!positionId) {
        return NextResponse.json({ success: false, error: "positionId required" }, { status: 400 });
      }
      const trade = await paperTrading.closePosition(positionId, exitPrice);
      return NextResponse.json({ success: true, data: trade });
    }

    if (action === "reset") {
      await paperTrading.resetAccount(user.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("[/api/paper-trade POST] Error:", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
