/**
 * SSE Stream Endpoint
 * GET /api/stream?topics=prices,signals,news
 *
 * Drop into: src/app/api/stream/route.ts
 *
 * Client usage:
 *   const es = new EventSource('/api/stream?topics=prices,signals');
 *   es.addEventListener('price', (e) => console.log(JSON.parse(e.data)));
 *   es.addEventListener('signal', (e) => console.log(JSON.parse(e.data)));
 */

import { NextRequest } from "next/server";
import { initSSE, broadcast } from "@/lib/streaming";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const stream = initSSE(req);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}

// Helper route to broadcast (for testing)
export async function POST(req: NextRequest) {
  const body = await req.json();
  broadcast(body.event || "message", body.data || {});
  return Response.json({ success: true });
}
