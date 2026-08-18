// src/app/api/socket/health/route.ts
// Simple health-check endpoint for the Socket.IO service.

import { NextRequest } from 'next/server'
import { getIO } from '@/lib/socket-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const io = getIO()

  if (!io) {
    return Response.json({
      status: 'not-running',
      message: 'Socket.IO server not initialized. In production, run scripts/socket-server.ts. In dev, use the useSocket() hook which gracefully degrades.',
      timestamp: new Date().toISOString(),
    })
  }

  // @ts-ignore - engine is internal but stable
  const connectedClients = io.engine?.clientsCount || 0

  return Response.json({
    status: 'running',
    connectedClients,
    path: '/api/socket/io',
    timestamp: new Date().toISOString(),
  })
}
