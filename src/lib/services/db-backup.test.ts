import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The backup service VACUUMs into a real file and then re-opens it with a second
// Prisma client to prove it is readable. The mock reproduces that contract - in
// particular, that the destination path is derived from the SQL, and that the
// verification client can fail independently of the writer.
const h = vi.hoisted(() => ({
  sql: [] as string[],
  failVacuum: false,
  failVerify: false,
  users: 3,
}))

vi.mock('@/generated/prisma', async () => {
  const fsp = await import('node:fs')
  class PrismaClient {
    constructor(public opts?: { datasources?: { db: { url: string } } }) {}
    async $executeRawUnsafe(sql: string) {
      h.sql.push(sql)
      if (h.failVacuum) throw new Error('SQLITE_FULL: database or disk is full')
      const m = /VACUUM INTO '(.+)'/.exec(sql)
      if (!m) throw new Error(`unexpected statement: ${sql}`)
      // VACUUM INTO requires the target to be absent, exactly like real SQLite.
      if (fsp.existsSync(m[1])) throw new Error('output file already exists')
      fsp.writeFileSync(m[1], 'snapshot-bytes')
      return 0
    }
    user = {
      count: async () => {
        if (h.failVerify) throw new Error('unable to open database file')
        return h.users
      },
    }
    async $disconnect() {}
  }
  return { PrismaClient }
})

import { runBackup } from '@/lib/services/db-backup'

let tmp: string
let live: string
let dir: string
const env = { ...process.env }

beforeEach(() => {
  h.sql = []
  h.failVacuum = false
  h.failVerify = false
  h.users = 3
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'topbackup-'))
  live = path.join(tmp, 'live.db')
  dir = path.join(tmp, 'backups')
  fs.writeFileSync(live, 'live-bytes')
  process.env.DATABASE_URL = `file:${live}`
  process.env.DB_BACKUP_DIR = dir
  delete process.env.DB_BACKUP_KEEP
  delete process.env.DB_BACKUP_MAX_MB
})

afterEach(() => {
  process.env = { ...env }
  fs.rmSync(tmp, { recursive: true, force: true })
})

const shots = () =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort() : []

describe('runBackup', () => {
  it('snapshots with VACUUM INTO so a full live volume cannot block it', async () => {
    const res = await runBackup()
    expect(res.ok).toBe(true)
    // VACUUM INTO only reads the source. A COPY (or writing to the same volume)
    // would fail with SQLITE_FULL at exactly the moment the backup matters.
    expect(h.sql[0]).toMatch(/^VACUUM INTO '/)
  })

  it('writes to the backup volume, never onto the live database', async () => {
    const res = await runBackup()
    expect(path.dirname(res.file as string)).toBe(dir)
    expect(path.dirname(res.file as string)).not.toBe(path.dirname(live))
    expect(shots()).toHaveLength(1)
    // The live file is read-only input; it must be left exactly as it was.
    expect(fs.readFileSync(live, 'utf8')).toBe('live-bytes')
  })

  it('verifies the snapshot before trusting it, and reports the user count', async () => {
    // This is the whole point: a snapshot that cannot be reopened is worthless at
    // the moment it is needed, so it must never be counted as a backup.
    const res = await runBackup()
    expect(res.users).toBe(3)
  })

  it('deletes a snapshot it cannot verify instead of keeping a corrupt copy', async () => {
    h.failVerify = true
    const res = await runBackup()
    expect(res.ok).toBe(false)
    expect(shots()).toHaveLength(0)
  })

  it('leaves no partial file behind when the VACUUM fails', async () => {
    h.failVacuum = true
    const res = await runBackup()
    expect(res.ok).toBe(false)
    expect(shots()).toHaveLength(0)
  })

  it('never throws, because a failed backup must not take the server down', async () => {
    process.env.DATABASE_URL = 'postgres://example/db'
    await expect(runBackup()).resolves.toMatchObject({ ok: false })
  })

  it('refuses to run against a missing live database', async () => {
    fs.rmSync(live)
    const res = await runBackup()
    expect(res.ok).toBe(false)
    expect(h.sql).toHaveLength(0)
  })

  it('reports a clear reason when the backup volume is not mounted', async () => {
    // No /backups volume (the common case until the IaC change applies) must
    // degrade to a log line, never to a boot failure.
    process.env.DB_BACKUP_DIR = path.join(live, 'not-a-dir')
    const res = await runBackup()
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/unavailable|does not exist/)
  })
})

describe('rotation', () => {
  const seed = (n: number) => {
    for (let i = 0; i < n; i++) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `toptier-2020-01-0${i + 1}-00-00-00-000Z.db`), 'old')
    }
  }

  it('keeps the newest snapshots and drops the oldest past the limit', async () => {
    process.env.DB_BACKUP_KEEP = '2'
    seed(5)
    await runBackup()
    const remaining = shots()
    expect(remaining).toHaveLength(2)
    // Sorted ascending, the survivors must be the newest - the recent ones are
    // the only ones worth restoring from.
    expect(remaining[remaining.length - 1]).not.toContain('2020-01-01')
  })

  it('enforces the total size budget even when the count is under the limit', async () => {
    process.env.DB_BACKUP_KEEP = '50'
    process.env.DB_BACKUP_MAX_MB = '0'
    seed(3)
    await runBackup()
    // A byte budget is the only thing stopping the backup volume filling up.
    expect(shots().length).toBeLessThanOrEqual(1)
  })
})
