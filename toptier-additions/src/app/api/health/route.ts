/**
 * Health Check + Monitoring endpoints
 * GET /api/health         — basic health (for Docker/k8s)
 * GET /api/health/detailed — detailed metrics (for Grafana/Prometheus)
 *
 * Drop into: src/app/api/health/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const detailed = searchParams.get("detailed") === "true";

  const checks: Record<string, any> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  };

  if (detailed) {
    // Database check
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { status: "ok", latencyMs: Date.now() - start };
    } catch (e: any) {
      checks.database = { status: "error", error: e.message };
      checks.status = "degraded";
    }

    // Memory
    const mem = process.memoryUsage();
    checks.memory = {
      rss: Math.round(mem.rss / 1024 / 1024) + " MB",
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + " MB",
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + " MB",
      external: Math.round(mem.external / 1024 / 1024) + " MB",
    };

    // CPU
    checks.cpu = {
      loadAverage: (process as any).loadavg?.() || "n/a",
    };

    // User count (cached for performance)
    try {
      checks.users = await prisma.user.count();
      checks.activeSessions = await prisma.session.count({
        where: { expiresAt: { gt: new Date() } },
      }).catch(() => -1);
    } catch {}

    // Version
    checks.version = process.env.npm_package_version || "1.0.0";
  }

  const status = checks.status === "ok" ? 200 : checks.status === "degraded" ? 200 : 503;
  return NextResponse.json(checks, { status });
}
