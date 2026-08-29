import { PrismaClient } from '@/generated/prisma'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  // Ensure the directory for the SQLite database exists.
  const dbUrl = process.env.DATABASE_URL
  if (dbUrl?.startsWith('file:')) {
    const filePath = dbUrl.replace('file:', '').split('?')[0]
    try { mkdirSync(dirname(filePath), { recursive: true }) } catch {}
  }

  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? [] : ['query'],
  })

  // Enable WAL mode for SQLite to allow concurrent reads during writes.
  // This is safe to call on every startup — it's a no-op if already enabled.
  if (dbUrl?.includes('file:')) {
    client.$executeRawUnsafe('PRAGMA journal_mode=WAL').catch(() => {})
    client.$executeRawUnsafe('PRAGMA busy_timeout=5000').catch(() => {})
  }

  return client
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

globalForPrisma.prisma = db