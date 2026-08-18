// src/app/api/health/route.ts
// Public health-check endpoint used by the Docker healthcheck and uptime
// monitors. Returns HTTP 200 only when the app is fully booted (DB reachable).

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const started = new Date()
  let dbStatus: 'ok' | 'error' = 'ok'
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ])
  } catch {
    dbStatus = 'error'
  }

  return Response.json(
    {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      service: 'toptier',
      db: dbStatus,
      timestamp: started.toISOString(),
    },
    { status: dbStatus === 'ok' ? 200 : 503 }
  )
}
