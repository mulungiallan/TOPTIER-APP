// src/lib/socket-server.ts
// Socket.IO server for real-time price updates, alerts, and signal actions.
//
// In Next.js dev mode, this attaches to the underlying HTTP server via a
// custom server approach. In production we recommend running a standalone
// Node server (see scripts/socket-server.ts).
//
// The route /api/socket/io handles upgrade requests and forwards them to
// this singleton io instance.

import { Server as SocketServer, Socket } from 'socket.io'
import { Server as HTTPServer } from 'http'
import { db } from '@/lib/db'
import { marketDataService } from '@/lib/services/market-data'
import { verifyToken } from '@/lib/auth'
import { startAlertMonitor, stopAlertMonitor } from '@/lib/services/alert-monitor'

let io: SocketServer | null = null
let priceUpdateTimer: NodeJS.Timeout | null = null

const MAX_SUBSCRIPTIONS_PER_SOCKET = 50
const MAX_CHAT_MESSAGE_LENGTH = 2000
const CHAT_RATE_LIMIT_MS = 1_000
const CHAT_MAX_MESSAGES_PER_WINDOW = 5

/**
 * Initialize (or return existing) Socket.IO server attached to the given HTTP server.
 * Safe to call multiple times — second call returns existing instance.
 */
export function initSocketServer(server: HTTPServer): SocketServer {
  if (io) return io

  io = new SocketServer(server, {
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      credentials: true,
    },
    path: '/api/socket/io',
    transports: ['websocket', 'polling'],
  })

  // ─── Auth middleware ────────────────────────────────────────────────────────
  io.use(async (socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined

    if (!token) {
      socket.data.userId = null
      socket.data.anonymous = true
      socket.data.subscriptionCount = 0
      socket.data.chatMessages = 0
      socket.data.chatWindowStart = Date.now()
      return next()
    }

    try {
      const decoded = verifyToken(token)
      if (!decoded?.userId) {
        return next(new Error('Invalid token'))
      }

      socket.data.userId = decoded.userId
      socket.data.anonymous = false
      socket.data.subscriptionCount = 0
      socket.data.chatMessages = 0
      socket.data.chatWindowStart = Date.now()
      next()
    } catch (err) {
      next(new Error('Authentication required'))
    }
  })

  // ─── Connection handler ────────────────────────────────────────────────────
  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string | null

    // Join user-specific room for private notifications
    if (userId) {
      socket.join(`user:${userId}`)
    }

    // ─── Subscribe to price updates for symbols ──────────────────────────────
    socket.on('subscribe:price', (symbols: string[]) => {
      if (!Array.isArray(symbols)) return
      const validSymbols = symbols.filter(s => typeof s === 'string' && s.length > 0).slice(0, MAX_SUBSCRIPTIONS_PER_SOCKET - (socket.data.subscriptionCount || 0))
      if (validSymbols.length === 0) return

      validSymbols.forEach(symbol => {
        socket.join(`price:${symbol}`)
      })
      socket.data.subscriptionCount = (socket.data.subscriptionCount || 0) + validSymbols.length
      socket.emit('subscribed:price', { symbols: validSymbols, count: validSymbols.length })
    })

    socket.on('unsubscribe:price', (symbols: string[]) => {
      if (!Array.isArray(symbols)) return
      symbols.forEach(symbol => {
        socket.leave(`price:${symbol}`)
      })
      socket.data.subscriptionCount = Math.max(0, (socket.data.subscriptionCount || 0) - symbols.length)
      socket.emit('unsubscribed:price', { symbols, count: symbols.length })
    })

    // ─── Signal room actions ─────────────────────────────────────────────────
    socket.on('subscribe:signal', (signalId: string) => {
      if (!signalId || typeof signalId !== 'string') return
      socket.join(`signal:${signalId}`)
    })

    socket.on('signal:action', (data: { signalId: string; action: string }) => {
      if (!socket.data.userId) {
        socket.emit('error', { message: 'Authentication required' })
        return
      }
      io?.to(`signal:${data.signalId}`).emit('signal:updated', {
        ...data,
        userId: socket.data.userId,
        timestamp: new Date().toISOString(),
      })
    })

    // ─── Alert trigger (server-side broadcast to that user) ───────────────────
    socket.on('alert:triggered', (data: { alertId: string; asset: string; price: number }) => {
      if (!socket.data.userId) {
        socket.emit('error', { message: 'Authentication required' })
        return
      }
      io?.to(`user:${socket.data.userId}`).emit('alert:triggered', {
        ...data,
        userId: socket.data.userId,
        timestamp: new Date().toISOString(),
      })
    })

    // ─── Community chat (rate-limited, sanitized) ─────────────────────────────
    socket.on('chat:message', (data: { channel: string; message: string }) => {
      if (!socket.data.userId || !data.channel || !data.message) return

      // Rate limit: max messages per window
      const now = Date.now()
      if (now - (socket.data.chatWindowStart || 0) > 30_000) {
        socket.data.chatMessages = 0
        socket.data.chatWindowStart = now
      }
      socket.data.chatMessages = (socket.data.chatMessages || 0) + 1
      if (socket.data.chatMessages > CHAT_MAX_MESSAGES_PER_WINDOW) {
        socket.emit('error', { message: 'Chat rate limit exceeded. Please wait.' })
        return
      }

      // Sanitize and truncate message
      const message = String(data.message).slice(0, MAX_CHAT_MESSAGE_LENGTH).trim()
      if (!message) return

      io?.to(`chat:${data.channel}`).emit('chat:message', {
        userId: socket.data.userId,
        message,
        channel: data.channel,
        timestamp: new Date().toISOString(),
      })
    })

    socket.on('chat:join', (channel: string) => {
      if (!channel || typeof channel !== 'string' || !socket.data.userId) return
      socket.join(`chat:${channel}`)
    })

    socket.on('chat:leave', (channel: string) => {
      if (!channel || typeof channel !== 'string') return
      socket.leave(`chat:${channel}`)
    })

    // ─── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      // Cleanup: Socket.IO automatically removes the socket from all rooms
    })
  })

  // ─── Start background price-update service ──────────────────────────────────
  startPriceUpdateService(io)

  // ─── Start background price-alert monitor ───────────────────────────────────
  startAlertMonitor(io)

  return io
}

/**
 * Background task that polls Yahoo Finance for prices of symbols that users
 * have subscribed to via their watchlists, then broadcasts updates to all
 * connected clients subscribed to those symbol rooms.
 */
async function startPriceUpdateService(io: SocketServer) {
  if (priceUpdateTimer) return

  const updateInterval = 30_000 // 30 seconds

  async function tick() {
    try {
      // Get all symbols currently being watched across all users
      const items = await db.watchlistItem.findMany({
        select: { asset: true },
        distinct: ['asset'],
      })

      if (items.length === 0) {
        return
      }

      const symbols = items.map(i => i.asset)
      const pricesMap = await marketDataService.getMultiplePrices(symbols)

      pricesMap.forEach((price, symbol) => {
        io.to(`price:${symbol}`).emit('price:update', {
          symbol,
          price: price.price,
          change: price.change,
          changePercent: price.changePercent,
          volume: price.volume,
          high: price.high,
          low: price.low,
          timestamp: price.timestamp.toISOString(),
        })
      })
    } catch (err) {
      console.error('[Socket.IO] Price update tick failed:', err)
    }
  }

  // Initial tick after 5 seconds (let things settle)
  setTimeout(tick, 5000)
  priceUpdateTimer = setInterval(tick, updateInterval)
}

/**
 * Public accessor to get the singleton io instance (may be null if not initialized).
 */
export function getIO(): SocketServer | null {
  return io
}

/**
 * Graceful shutdown.
 */
export function closeSocketServer() {
  stopAlertMonitor()
  if (priceUpdateTimer) {
    clearInterval(priceUpdateTimer)
    priceUpdateTimer = null
  }
  if (io) {
    io.close()
    io = null
  }
}

/**
 * Emit a notification to a specific user (server-side helper for other modules).
 * Example: emitToUser(userId, 'alert:triggered', payload)
 */
export function emitToUser(userId: string, event: string, payload: Record<string, unknown>): boolean {
  if (!io) return false
  io.to(`user:${userId}`).emit(event, payload)
  return true
}

/**
 * Broadcast a price update to all subscribers of a symbol.
 */
export function broadcastPriceUpdate(symbol: string, payload: Record<string, unknown>): boolean {
  if (!io) return false
  io.to(`price:${symbol}`).emit('price:update', { symbol, ...payload })
  return true
}

/**
 * Broadcast a new signal to all connected clients.
 */
export function broadcastNewSignal(signal: Record<string, unknown>): boolean {
  if (!io) return false
  io.emit('signal:new', signal)
  return true
}
