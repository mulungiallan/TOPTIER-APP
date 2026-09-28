import { describe, it, expect } from 'vitest'
import { instanceLiveness, formatHeartbeatAge, HEARTBEAT_STALE_MS } from '@/lib/services/bot-liveness'

const now = new Date('2026-09-28T16:00:00.000Z')
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000)

describe('instanceLiveness', () => {
  it('treats a running instance with a fresh heartbeat as live', () => {
    const r = instanceLiveness({ status: 'running', lastHeartbeatAt: minsAgo(1) }, now)
    expect(r.claimsRunning).toBe(true)
    expect(r.live).toBe(true)
    expect(r.stale).toBe(false)
  })

  it('flags a running instance whose heartbeat expired (the dead-bot case)', () => {
    const r = instanceLiveness({ status: 'running', lastHeartbeatAt: minsAgo(60 * 47) }, now)
    expect(r.claimsRunning).toBe(true)
    expect(r.live).toBe(false)
    expect(r.stale).toBe(true)
  })

  it('flags a running instance that never sent a heartbeat', () => {
    const r = instanceLiveness({ status: 'running', lastHeartbeatAt: null }, now)
    expect(r.live).toBe(false)
    expect(r.stale).toBe(true)
    expect(r.heartbeatAgeMs).toBeNull()
  })

  it('does not flag a deliberately stopped instance as stale', () => {
    const r = instanceLiveness({ status: 'stopped', lastHeartbeatAt: minsAgo(60 * 47) }, now)
    expect(r.claimsRunning).toBe(false)
    expect(r.stale).toBe(false)
    expect(r.live).toBe(false)
  })

  it('is not live for a starting instance without a heartbeat', () => {
    const r = instanceLiveness({ status: 'starting', lastHeartbeatAt: null }, now)
    expect(r.live).toBe(false)
    expect(r.stale).toBe(true)
  })

  it('handles a missing instance', () => {
    const r = instanceLiveness(null, now)
    expect(r.claimsRunning).toBe(false)
    expect(r.live).toBe(false)
    expect(r.stale).toBe(false)
  })

  it('uses a 15 minute staleness window (3 missed 5-minute report cycles)', () => {
    expect(HEARTBEAT_STALE_MS).toBe(15 * 60 * 1000)
    // healthy cadence is ~5 min, so 4 min and 14 min are both alive
    expect(instanceLiveness({ status: 'running', lastHeartbeatAt: minsAgo(4) }, now).live).toBe(true)
    expect(instanceLiveness({ status: 'running', lastHeartbeatAt: minsAgo(14) }, now).live).toBe(true)
    // 16 min means three missed cycles: dead
    expect(instanceLiveness({ status: 'running', lastHeartbeatAt: minsAgo(16) }, now).live).toBe(false)
    expect(instanceLiveness({ status: 'running', lastHeartbeatAt: minsAgo(16) }, now).stale).toBe(true)
  })

  it('still flags a bot dead for 47 hours', () => {
    const r = instanceLiveness({ status: 'running', lastHeartbeatAt: minsAgo(60 * 47) }, now)
    expect(r.stale).toBe(true)
    expect(r.live).toBe(false)
  })
})

describe('formatHeartbeatAge', () => {
  it('formats ages for display', () => {
    expect(formatHeartbeatAge(null)).toBe('never')
    expect(formatHeartbeatAge(5_000)).toBe('just now')
    expect(formatHeartbeatAge(12 * 60_000)).toBe('12m ago')
    expect(formatHeartbeatAge(20 * 3_600_000)).toBe('20h ago')
    expect(formatHeartbeatAge(47 * 3_600_000)).toBe('1d ago')
    expect(formatHeartbeatAge(50 * 3_600_000)).toBe('2d ago')
  })
})
