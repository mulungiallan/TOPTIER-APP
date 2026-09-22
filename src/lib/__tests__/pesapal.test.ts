import { describe, it, expect } from 'vitest'
import { pesapalAmountAccepted } from '@/lib/payments/pesapal'

describe('pesapalAmountAccepted', () => {
  it('accepts an exact same-currency match', () => {
    const res = pesapalAmountAccepted({
      expectedAmount: 329,
      expectedCurrency: 'KES',
      reportedAmount: 329,
      reportedCurrency: 'KES',
    })
    expect(res.accepted).toBe(true)
    expect(res.reason).toBeUndefined()
  })

  it('rejects a same-currency mismatch', () => {
    const res = pesapalAmountAccepted({
      expectedAmount: 329,
      expectedCurrency: 'KES',
      reportedAmount: 310,
      reportedCurrency: 'KES',
    })
    expect(res.accepted).toBe(false)
    expect(res.reason).toContain('expected 329 KES')
  })

  it('never stranding new in cross-currency reports (the production bug)', () => {
    // 329 KES order (10,000 UGX top-up) paid via AirtelUG returns amount=9980
    // in a non-KES currency — must NOT be treated as a failure.
    const res = pesapalAmountAccepted({
      expectedAmount: 329,
      expectedCurrency: 'KES',
      reportedAmount: 9980,
      reportedCurrency: 'USD',
    })
    expect(res.accepted).toBe(true)
    expect(res.reason).toContain('informational')
  })

  it('treats a missing reported amount as informational', () => {
    const res = pesapalAmountAccepted({
      expectedAmount: 329,
      expectedCurrency: 'KES',
      reportedAmount: null,
      reportedCurrency: null,
    })
    expect(res.accepted).toBe(true)
  })
})