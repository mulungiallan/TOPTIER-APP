/**
 * Risk Engine API
 * POST /api/risk/report  — generate comprehensive risk report
 * POST /api/risk/var     — compute VaR
 * POST /api/risk/stress  — stress test
 * POST /api/risk/size    — optimal position size
 *
 * Drop into: src/app/api/risk/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  generateRiskReport, historicalVaR, parametricVaR, monteCarloVaR,
  stressTest, positionSizeByRisk, kellyCriterion, SCENARIOS,
} from "@/lib/risk-engine";

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      endpoints: ["/report", "/var", "/stress", "/size"],
      scenarios: SCENARIOS,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    if (action === "report") {
      const report = generateRiskReport({
        returns: body.returns,
        equityCurve: body.equityCurve,
        benchmarkReturns: body.benchmarkReturns,
        positions: body.positions,
        portfolioValue: body.portfolioValue,
        riskTolerance: body.riskTolerance,
      });
      return NextResponse.json({ success: true, data: report });
    }

    if (action === "var") {
      const { returns, portfolioValue, confidence = 0.95, method = "all" } = body;
      const result: any = {};
      if (method === "all" || method === "historical") result.historical = historicalVaR(returns, confidence, portfolioValue);
      if (method === "all" || method === "parametric") result.parametric = parametricVaR(returns, confidence, portfolioValue);
      if (method === "all" || method === "montecarlo") {
        const mc = monteCarloVaR(returns, confidence, portfolioValue);
        result.monteCarlo = { var: mc.var, cvar: mc.cvar };
      }
      return NextResponse.json({ success: true, data: result });
    }

    if (action === "stress") {
      const result = stressTest(body.positions, body.scenario);
      return NextResponse.json({ success: true, data: result });
    }

    if (action === "size") {
      const result = positionSizeByRisk(body);
      return NextResponse.json({ success: true, data: result });
    }

    if (action === "kelly") {
      const f = kellyCriterion(body.winRate, body.winLossRatio);
      return NextResponse.json({ success: true, data: { kellyFraction: f, recommendedFraction: f * 0.5 } });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
