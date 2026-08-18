// scripts/socket-server.ts
// Standalone Socket.IO server for production.
// Run with: npx tsx scripts/socket-server.ts
//
// This starts a dedicated HTTP server with Socket.IO attached, so real-time
// features work reliably in production (Next.js dev mode has limited WS support).
//
// In development, the useSocket() hook gracefully degrades — it will attempt
// to connect to the same path on the Next.js server and silently no-op if
// no Socket.IO server is available.

import { createServer } from 'http'
import { config as loadEnv } from 'dotenv'

// Load .env first
loadEnv()

const PORT = parseInt(process.env.SOCKET_PORT || process.env.PORT || '3001', 10)

async function main() {
  // Dynamic imports so the script doesn't crash if some deps aren't installed
  const { initSocketServer } = await import('../src/lib/socket-server')

  const httpServer = createServer((req, res) => {
    // Basic health endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', service: 'TOPTIER Socket.IO', port: PORT }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      service: 'TOPTIER Socket.IO Server',
      port: PORT,
      socketPath: '/api/socket/io',
      message: 'Use a Socket.IO client to connect.',
    }))
  })

  const io = initSocketServer(httpServer)

  httpServer.listen(PORT, () => {
    console.log('')
    console.log('==============================================')
    console.log('  TOPTIER Socket.IO Server')
    console.log('==============================================')
    console.log(`  Listening:     http://localhost:${PORT}`)
    console.log(`  Socket.IO path: /api/socket/io`)
    console.log(`  Health check:   http://localhost:${PORT}/health`)
    console.log('')
    console.log('  Connect from client with:')
    console.log(`    io({ path: '/api/socket/io' })`)
    console.log('')
    console.log('  Press Ctrl+C to stop.')
    console.log('==============================================')
    console.log('')
  })

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n[${signal}] Shutting down Socket.IO server...`)
    io.close()
    httpServer.close(() => {
      console.log('Server closed.')
      process.exit(0)
    })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch(err => {
  console.error('Failed to start socket server:', err)
  process.exit(1)
})
