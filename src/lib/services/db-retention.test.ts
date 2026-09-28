import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted above the imports, so the spies have to be created with
// vi.hoisted for the factory below to be able to close over them.
const h = vi.hoisted(() => {
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 })
  const count = vi.fn().mockResolvedValue(0)
  const $queryRawUnsafe = vi.fn().mockResolvedValue([])
  const $executeRawUnsafe = vi.fn().mockResolvedValue(0)
  const models: Record<string, { deleteMany: unknown; count: unknown }> = {}
  for (const name of [
    'signal',
    'notification',
    'activityLog',
    'usageEvent',
    'usageSession',
    'screenshotAnalysis',
    'newsArticle',
    'economicEvent',
    'botSnapshot',
    'adminAuditLog',
  ]) {
    models[name] = { deleteMany, count }
  }
  return { deleteMany, count, $queryRawUnsafe, $executeRawUnsafe, models }
})

const { deleteMany, $queryRawUnsafe, $executeRawUnsafe } = h

vi.mock('@/lib/db', () => ({
  // Referenced through `h` rather than the destructured locals below, because the
  // factory runs hoisted, before those bindings exist.
  db: {
    ...h.models,
    $queryRawUnsafe: h.$queryRawUnsafe,
    $executeRawUnsafe: h.$executeRawUnsafe,
  },
}))

import { RETENTION_DAYS, pruneExpiredRows, checkpointWal } from '@/lib/services/db-retention'

describe('pruneExpiredRows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteMany.mockResolvedValue({ count: 0 })
  })

  it('cuts every high-churn table, so none of them can grow without bound', async () => {
    await pruneExpiredRows()
    const pruned = deleteMany.mock.calls.map((call) => (call[0] as { where: unknown }).where)
    expect(pruned).toHaveLength(Object.keys(RETENTION_DAYS).length)
  })

  it('never deletes a row that is still inside its retention window', async () => {
    await pruneExpiredRows()
    for (const [model, days] of Object.entries(RETENTION_DAYS)) {
      const index = Object.keys(RETENTION_DAYS).indexOf(model as keyof typeof RETENTION_DAYS)
      const where = deleteMany.mock.calls[index][0] as { where: { createdAt: { lt: Date } } }
      const expected = Date.now() - days * 86_400_000
      // The cutoff must be the age boundary, not "now" (which would wipe live rows).
      expect(Math.abs(where.where.createdAt.lt.getTime() - expected)).toBeLessThan(5_000)
    }
  })

  it('leaves money and identity tables out of the retention list', () => {
    // Deleting any of these would destroy real user or financial data.
    for (const protectedTable of ['payment', 'walletEntry', 'walletAccount', 'user', 'trade']) {
      expect(RETENTION_DAYS).not.toHaveProperty(protectedTable)
    }
  })

  it('reports how many rows each table lost', async () => {
    deleteMany.mockResolvedValue({ count: 7 })
    const results = await pruneExpiredRows()
    expect(results).toHaveLength(Object.keys(RETENTION_DAYS).length)
    expect(results.every((r) => r.deleted === 7)).toBe(true)
  })

  it('keeps pruning the remaining tables when one model fails', async () => {
    // A full disk, a missing table or a locked DB must not abort the whole job.
    deleteMany.mockRejectedValueOnce(new Error('database is locked'))
    await expect(pruneExpiredRows()).resolves.toBeDefined()
    expect(deleteMany).toHaveBeenCalledTimes(Object.keys(RETENTION_DAYS).length)
  })
})

describe('checkpointWal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses a query, because PRAGMA wal_checkpoint returns a row', async () => {
    await checkpointWal()
    expect($queryRawUnsafe).toHaveBeenCalledWith('PRAGMA wal_checkpoint(PASSIVE)')
    // $executeRawUnsafe rejects statements that return results, so using it here
    // would mean the WAL is never actually reclaimed.
    expect($executeRawUnsafe).not.toHaveBeenCalled()
  })

  it('swallows checkpoint errors', async () => {
    $queryRawUnsafe.mockRejectedValueOnce(new Error('busy'))
    await expect(checkpointWal()).resolves.toBeUndefined()
  })
})
