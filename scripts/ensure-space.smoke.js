// Manual verification of scripts/ensure-space.js against a deliberately bloated
// database. Not part of the vitest run: it writes real files and shells out to
// the boot script, which is the only way to prove the destructive swap path is
// safe. Run with: node scripts/ensure-space.smoke.js
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', '.tmp-ensure-space')
const DB = path.join(DIR, 'test.db')
const URL = `file:${DB}`

const { PrismaClient } = require('../src/generated/prisma')

const db = () => new PrismaClient({ datasources: { db: { url: URL } } })

function size() {
  return fs.existsSync(DB) ? fs.statSync(DB).size : 0
}

async function main() {
  fs.rmSync(DIR, { recursive: true, force: true })
  fs.mkdirSync(DIR, { recursive: true })

  // Build a schema-shaped database with real rows.
  const setup = db()
  await setup.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "User" (id TEXT PRIMARY KEY, email TEXT)'
  )
  await setup.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "ActivityLog" (id TEXT PRIMARY KEY, createdAt DATETIME, userId TEXT)'
  )
  await setup.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "Blob" (id TEXT PRIMARY KEY, pad BLOB)')
  await setup.$executeRawUnsafe(`INSERT INTO "User" (id, email) VALUES ('u1', 'a@b.c')`)
  // Prisma stores SQLite DateTime as INTEGER epoch-ms, so the age filter has to
  // compare against a number or it will silently match nothing.
  const oldMs = Date.now() - 90 * 86400000
  await setup.$executeRawUnsafe(
    `INSERT INTO "ActivityLog" (id, createdAt) VALUES ('a1', ${oldMs})`
  )
  // Bulk in blobs, then delete them, so the file keeps its size but is mostly
  // free pages - exactly the production situation.
  const rows = []
  for (let i = 0; i < 4000; i++) {
    rows.push(`('b${i}', randomblob(8000))`)
  }
  await setup.$executeRawUnsafe(
    `INSERT INTO "Blob" (id, pad) VALUES ${rows.join(',').slice(0, 1e7)}`
  )
  await setup.$disconnect()

  const before = size()
  const usersBefore = 1
  console.log(`built db: ${(before / 1024 / 1024).toFixed(1)}MB`)

  // Delete most of the blobs so the file keeps its size but is mostly free
  // pages - exactly the production situation.
  const del = db()
  await del.$executeRawUnsafe('DELETE FROM "Blob" WHERE id NOT IN (\'b0\')')
  await del.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)')
  await del.$disconnect()
  console.log(`after deletes: ${(size() / 1024 / 1024).toFixed(1)}MB, mostly free pages`)

  // A tiny threshold forces the compact path to run on this small file.
  execFileSync(process.execPath, [path.join(__dirname, 'ensure-space.js')], {
    env: {
      ...process.env,
      DATABASE_URL: URL,
      DB_COMPACT_MIN_BYTES: '1024',
      ACTIVITY_LOG_RETENTION_DAYS: '1',
    },
    stdio: 'inherit',
  })

  const after = size()
  console.log(`\nsize ${(before / 1024 / 1024).toFixed(1)}MB -> ${(after / 1024 / 1024).toFixed(1)}MB`)
  if (after >= before) throw new Error('compaction did not shrink the file')
  if (fs.existsSync(`${DB}.compact`)) throw new Error('staging file left behind')

  // The compacted copy must still be a working database with the live data.
  const check = db()
  const users = await check.$queryRawUnsafe('SELECT COUNT(*) as c FROM "User"')
  const logs = await check.$queryRawUnsafe('SELECT COUNT(*) as c FROM "ActivityLog"')
  await check.$disconnect()
  console.log(`users ${users[0].c} (expected ${usersBefore}), activityLog ${logs[0].c}`)
  if (Number(users[0].c) !== usersBefore) throw new Error('compacted copy lost rows')
  if (Number(logs[0].c) !== 0) throw new Error('stale activityLog was not pruned')

  fs.rmSync(DIR, { recursive: true, force: true })
  console.log('\nPASS: compacted, shrank, kept live rows, no staging left')
}

main().catch((err) => {
  console.error('FAIL', err)
  fs.rmSync(DIR, { recursive: true, force: true })
  process.exit(1)
})
