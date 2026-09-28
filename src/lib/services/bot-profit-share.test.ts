import { describe, it, expect } from 'vitest'
import { summarizeConnection } from '@/lib/services/bot-profit-share'

const conn = (over: Partial<Parameters<typeof summarizeConnection>[0]> = {}) =>
  ({
    id: 'c1',
    realizedPnl: 0,
    grossProfit: 0,
    settledProviderAmount: 0,
    providerSharePct: 0,
    ...over,
  }) as Parameters<typeof summarizeConnection>[0]

describe('bot profit share', () => {
  it('owes nothing when the share is 0, even with winning trades', () => {
    const s = summarizeConnection(conn({ grossProfit: 250, providerSharePct: 0 }))
    expect(s.providerSharePct).toBe(0)
    expect(s.dueAmount).toBe(0)
  })

  it('keeps the user 100% of profit at a 0% share', () => {
    const s = summarizeConnection(conn({ grossProfit: 1234.56, providerSharePct: 0 }))
    expect(s.dueAmount).toBe(0)
  })

  it('still supports a non-zero share for legacy connections', () => {
    const s = summarizeConnection(conn({ grossProfit: 100, providerSharePct: 50 }))
    expect(s.providerSharePct).toBe(50)
    expect(s.dueAmount).toBe(50)
  })

  it('nets the share against what has already been settled', () => {
    const s = summarizeConnection(conn({ grossProfit: 100, providerSharePct: 50, settledProviderAmount: 20 }))
    expect(s.dueAmount).toBe(30)
  })

  it('never reports a negative amount due', () => {
    const s = summarizeConnection(conn({ grossProfit: 0, providerSharePct: 50, settledProviderAmount: 25 }))
    expect(s.dueAmount).toBe(0)
  })

  it('ignores losing trades when a share is configured', () => {
    const s = summarizeConnection(conn({ realizedPnl: -500, grossProfit: 100, providerSharePct: 50 }))
    expect(s.realizedPnl).toBe(-500)
    expect(s.dueAmount).toBe(50)
  })
})
