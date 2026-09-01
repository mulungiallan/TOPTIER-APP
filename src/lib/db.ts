import { PrismaClient } from '@/generated/prisma'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? [] : ['query'],
  })
  return client
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

globalForPrisma.prisma = db