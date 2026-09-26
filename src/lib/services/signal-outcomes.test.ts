import { describe, it, expect } from 'vitest'
import {
  classifySignalOutcome,
  type ActiveSignalLite,
} from '@/lib/services/signal-outcomes'

function makeSignal(overrides?: Partial<ActiveSignalLite>): ActiveSignalLite {
  return {
    id: 'sig-test',
    type: 'BUY',
    asset: 'BTC/USD',
    entryPrice: 100,
    stopLoss: 95,
    takeProfit1: 105,
    takeProfit2: 110,
    takeProfit3: null,
    confidence: 80,
    expiryDate: new Date(Date.now() + 3600_000),
    ...overrides,
  }
}

describe('classifySignalOutcome', () => {
  it('returns null while the price is still between stop and take-profit', () => {
    const signal = makeSignal()
    expect(classifySignalOutcome(signal, 101)).toBeNull()
  })

  it('marks a BUY that trades through TP1 as hit_tp/tp1', () => {
    const outcome = classifySignalOutcome(makeSignal(), 105.5)
    expect(outcome).toEqual({ status: 'hit_tp', resultType: 'tp1', resultPrice: 105.5 })
  })

  it('reports the DEEPEST TP when a BUY gaps through tp1 and tp2', () => {
    const outcome = classifySignalOutcome(makeSignal(), 113)
    expect(outcome?.resultType).toBe('tp2')
  })

  it('reports tp3 when the signal has a third take-profit and the price gaps through', () => {
    const signal = makeSignal({ takeProfit3: 115 })
    const outcome = classifySignalOutcome(signal, 116)
    expect(outcome?.resultType).toBe('tp3')
  })

  it('marks a BUY that hits stop-loss as hit_sl/sl', () => {
    const outcome = classifySignalOutcome(makeSignal(), 94.1)
    expect(outcome).toEqual({ status: 'hit_sl', resultType: 'sl', resultPrice: 94.1 })
  })

  it('mirrors the levels for SELL signals (TP below entry, SL above)', () => {
    const sell = makeSignal({
      type: 'SELL',
      entryPrice: 100,
      stopLoss: 105,
      takeProfit1: 95,
      takeProfit2: 90,
      takeProfit3: null,
    })
    expect(classifySignalOutcome(sell, 94)).toEqual({ status: 'hit_tp', resultType: 'tp1', resultPrice: 94 })
    expect(classifySignalOutcome(sell, 106)).toEqual({ status: 'hit_sl', resultType: 'sl', resultPrice: 106 })
    expect(classifySignalOutcome(sell, 89)).toEqual({ status: 'hit_tp', resultType: 'tp2', resultPrice: 89 })
  })

  it('treats an exact stop hit as a stop-out, not a take-profit', () => {
    // BUY, stop 95, price 95 → SL. Take-profit 105 exactly → hit_tp.
    expect(classifySignalOutcome(makeSignal(), 95)).toEqual({ status: 'hit_sl', resultType: 'sl', resultPrice: 95 })
    expect(classifySignalOutcome(makeSignal(), 105)?.status).toBe('hit_tp')
  })

  it('guards against invalid input (zero/unparseable prices)', () => {
    expect(classifySignalOutcome(makeSignal(), 0)).toBeNull()
    expect(classifySignalOutcome(makeSignal(), Number.NaN)).toBeNull()
    const bad = makeSignal({ entryPrice: 0 })
    expect(classifySignalOutcome(bad, 110)).toBeNull()
  })
})