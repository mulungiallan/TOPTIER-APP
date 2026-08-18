/**
 * POST /api/backtest
 * Body: {
 *   symbol: string,
 *   strategy: "emaCross" | "rsiReversion" | "breakout" | "signalGenerator",
 *   startingCapital?: number,
 *   positionSizePercent?: number,
 *   allowShort?: boolean,
 *   maxConcurrentPositions?: number,
 *   stopLossPct?: number,
 *   takeProfitPct?: number,
 *   timeframe?: string
 * }
 *
 * Drop into: src/app/api/backtest/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { backtester, strategies, BacktestParams } from "@/lib/backtester";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      symbol,
      strategy,
      startingCapital = 10000,
      positionSizePercent = 10,
      allowShort = true,
      maxConcurrentPositions = 1,
      stopLossPct,
      takeProfitPct,
      timeframe = "1D",
    } = body;

    if (!symbol || !strategy) {
      return NextResponse.json(
        { success: false, error: "symbol and strategy are required" },
        { status: 400 }
      );
    }

    const strategyFn = (strategies as any)[strategy];
    if (!strategyFn) {
      return NextResponse.json(
        { success: false, error: `Unknown strategy: ${strategy}. Available: ${Object.keys(strategies).join(", ")}` },
        { status: 400 }
      );
    }

    const candles = await backtester.fetchHistory(symbol);
    if (candles.length < 50) {
      return NextResponse.json(
        { success: false, error: "Insufficient historical data (need 50+ candles)" },
        { status: 400 }
      );
    }

    const params: BacktestParams = {
      symbol,
      startingCapital,
      positionSizePercent,
      allowShort,
      maxConcurrentPositions,
      stopLossPct,
      takeProfitPct,
      timeframe,
    };

    const result = await backtester.run(params, strategyFn, candles);

    return NextResponse.json({ success: true, data: result });
  } catch (e: any) {
    console.error("[/api/backtest] Error:", e);
    return NextResponse.json(
      { success: false, error: e.message || "Backtest failed" },
      { status: 500 }
    );
  }
}
