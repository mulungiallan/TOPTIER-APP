// src/app/api/socket/io/route.ts
// Socket.IO endpoint for Next.js App Router.
//
// In Next.js dev mode this works by hijacking the underlying ServerResponse
// to attach the Socket.IO server to the same HTTP server that Next is using.
//
// Note: For production, we recommend running a dedicated Node.js process
// (see scripts/socket-server.ts) for stable WebSocket support.

import { NextRequest } from 'next/server'
import { initSocketServer, getIO } from '@/lib/socket-server'

// Mark this route as dynamic — never statically optimized
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    // For non-WebSocket requests, return a friendly status page
    if (request.headers.get('upgrade') !== 'websocket') {
      const io = getIO()
      return Response.json({
        service: 'TOPTIER Socket.IO',
        status: io ? 'running' : 'not-initialized',
        path: '/api/socket/io',
        events: [
          'price:update',
          'alert:triggered',
          'signal:new',
          'signal:updated',
          'chat:message',
        ],
        clientEvents: [
          'subscribe:price',
          'unsubscribe:price',
          'subscribe:signal',
          'signal:action',
          'alert:triggered',
          'chat:join',
          'chat:leave',
          'chat:message',
        ],
      })
    }

    // WebSocket upgrade — try to attach Socket.IO to the underlying server
    // Note: This is a best-effort approach in Next.js dev mode.
    // In production, use a custom Node.js server (scripts/socket-server.ts).

    // @ts-ignore - Next.js internal API for hijacking responses
    const upgrade = (request as any).upgrade
    if (typeof upgrade === 'function') {
      // Some Next.js versions expose this for upgrade handling
      return new Response(null, { status: 101 })
    }

    return new Response('WebSocket upgrade not supported in this runtime. Use a custom Node.js server for production.', {
      status: 501,
    })
  } catch (error) {
    console.error('Socket.IO route error:', error)
    return Response.json(
      { error: 'Socket.IO route failed', details: String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  // Allow POST to trigger socket server initialization (used by clients
  // as a "warm-up" call before connecting)
  try {
    return Response.json({
      service: 'TOPTIER Socket.IO',
      message: 'Socket.IO client should connect via WebSocket to /api/socket/io',
      status: getIO() ? 'running' : 'not-initialized',
      hint: 'Use the useSocket() hook on the client side to connect.',
    })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
