/**
 * GET /api/signals-generate
 * Query params: ?symbol=EURUSD&timeframe=1H
 *               ?symbols=EURUSD,GBPUSD,USDJPY  (batch mode)
 *
 * Drop into: src/app/api/signals-generate/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { signalGenerator } from "@/lib/signal-generator";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    const symbols = searchParams.get("symbols");
    const timeframe = searchParams.get("timeframe") || "1H";

    if (symbols) {
      const list = symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      const signals = await signalGenerator.generateBatch(list);
      return NextResponse.json({ success: true, data: signals, count: signals.length });
    }

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: "symbol or symbols parameter required" },
        { status: 400 }
      );
    }

    const signal = await signalGenerator.generate(symbol.toUpperCase(), timeframe);
    return NextResponse.json({ success: true, data: signal });
  } catch (e: any) {
    console.error("[/api/signals-generate] Error:", e);
    return NextResponse.json(
      { success: false, error: e.message || "Failed to generate signal" },
      { status: 500 }
    );
  }
}
