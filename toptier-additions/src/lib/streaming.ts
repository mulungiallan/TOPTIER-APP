/**
 * Real-time Streaming — Server-Sent Events for price updates & signals
 * Drop into: src/lib/streaming.ts
 *
 * Uses SSE (no extra deps needed) for one-way streaming.
 * For bidirectional, use socket.io (separate file: src/lib/socket-server.ts)
 */

import { NextRequest } from "next/server";
import { signalGenerator } from "./signal-generator";

export interface StreamClient {
  id: string;
  controller: ReadableStreamDefaultController;
  userId?: string;
  subscriptions: Set<string>; // symbol subscriptions
}

const clients = new Map<string, StreamClient>();

// ============ SSE helper ============
export function initSSE(req: NextRequest): ReadableStream {
  const clientId = Math.random().toString(36).slice(2);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const client: StreamClient = {
        id: clientId,
        controller,
        subscriptions: new Set(),
      };
      clients.set(clientId, client);

      // Send initial connection event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`)
      );

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Clean up on abort
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        clients.delete(clientId);
        try { controller.close(); } catch {}
      });
    },
  });

  return stream;
}

// ============ Broadcast helpers ============
export function broadcast(event: string, data: any, filter?: (client: StreamClient) => boolean) {
  const encoder = new TextEncoder();
  const payload = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  for (const client of clients.values()) {
    if (filter && !filter(client)) continue;
    try {
      client.controller.enqueue(payload);
    } catch {
      clients.delete(client.id);
    }
  }
}

export function sendToClient(clientId: string, event: string, data: any) {
  const client = clients.get(clientId);
  if (!client) return;
  const encoder = new TextEncoder();
  try {
    client.controller.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    );
  } catch {
    clients.delete(clientId);
  }
}

// ============ Price stream ============
// Periodically fetch and broadcast prices for subscribed symbols
let priceStreamInterval: NodeJS.Timeout | null = null;
const subscribedSymbols = new Set<string>();

export function startPriceStream() {
  if (priceStreamInterval) return;

  priceStreamInterval = setInterval(async () => {
    // Collect all subscribed symbols
    for (const client of clients.values()) {
      client.subscriptions.forEach((s) => subscribedSymbols.add(s));
    }

    if (subscribedSymbols.size === 0) return;

    // Fetch prices in parallel
    const prices: Record<string, number> = {};
    await Promise.allSettled(
      Array.from(subscribedSymbols).map(async (symbol) => {
        try {
          // Use signal-generator's fetch logic
          const signal = await signalGenerator.generate(symbol);
          prices[symbol] = signal.entryPrice;
        } catch {}
      })
    );

    // Broadcast to subscribed clients
    for (const client of clients.values()) {
      const clientPrices: Record<string, number> = {};
      client.subscriptions.forEach((s) => {
        if (prices[s]) clientPrices[s] = prices[s];
      });
      if (Object.keys(clientPrices).length > 0) {
        sendToClient(client.id, "price", clientPrices);
      }
    }
  }, 5000); // every 5 seconds
}

export function stopPriceStream() {
  if (priceStreamInterval) {
    clearInterval(priceStreamInterval);
    priceStreamInterval = null;
  }
}

// ============ Stats ============
export function getStreamStats() {
  return {
    connectedClients: clients.size,
    subscribedSymbols: Array.from(subscribedSymbols),
  };
}
