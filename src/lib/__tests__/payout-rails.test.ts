import { describe, it, expect } from 'vitest'
import { normalizeKeMsisdn, payoutSupportedFor } from '@/lib/services/user-payouts'
import { normalizeUgMsisdn } from '@/lib/payments/momo'
import { mpesaB2cParseResult } from '@/lib/payments/mpesa-b2c'

describe('normalizeKeMsisdn', () => {
  it('normalizes 0-prefixed M-Pesa numbers to E.164', () => {
    expect(normalizeKeMsisdn('0712345678')).toBe('254712345678')
    expect(normalizeKeMsisdn('0112345678')).toBe('254112345678')
  })

  it('normalizes +254 / 254 spellings', () => {
    expect(normalizeKeMsisdn('+254712345678')).toBe('254712345678')
    expect(normalizeKeMsisdn('254712345678')).toBe('254712345678')
  })

  it('strips spaces/hyphens', () => {
    expect(normalizeKeMsisdn('0712 345 678')).toBe('254712345678')
    expect(normalizeKeMsisdn('+254-712-345-678')).toBe('254712345678')
  })

  it('rejects non-Kenyan shapes', () => {
    expect(normalizeKeMsisdn('0723456')).toBe('')
    expect(normalizeKeMsisdn('256712345678')).toBe('')
    expect(normalizeKeMsisdn('hello')).toBe('')
  })
})

describe('normalizeUgMsisdn', () => {
  it('normalizes Ugandan MTN numbers to MSISDN form', () => {
    expect(normalizeUgMsisdn('0772345678')).toBe('256772345678')
    expect(normalizeUgMsisdn('+256772345678')).toBe('256772345678')
    expect(normalizeUgMsisdn('256772345678')).toBe('256772345678')
    expect(normalizeUgMsisdn('772345678')).toBe('256772345678')
  })

  it('rejects non-Ugandan or unparseable shapes', () => {
    expect(normalizeUgMsisdn('071234')).toBe('')
    expect(normalizeUgMsisdn('254712345678')).toBe('')
    expect(normalizeUgMsisdn('1234567890')).toBe('')
    expect(normalizeUgMsisdn('abc')).toBe('')
  })
})

describe('mpesaB2cParseResult', () => {
  it('extracts settled result fields', () => {
    const payload = {
      Result: {
        ResultType: 0,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        OriginatorConversationID: 'b2c-originator-1',
        ConversationID: 'b2c-conversation-1',
        TransactionID: 'SGKFAK12345',
        ResultParameters: {
          Item: [
            { Name: 'TransactionAmount', Value: '5000.00' },
            { Name: 'TransactionReceipt', Value: 'SGKFAK12345' },
          ],
        },
      },
    }
    const r = mpesaB2cParseResult(payload)
    expect(r).not.toBeNull()
    expect(r!.resultCode).toBe(0)
    expect(r!.transactionId).toBe('SGKFAK12345')
    expect(r!.originatorConversationId).toBe('b2c-originator-1')
    expect(r!.amount).toBe(5000)
  })

  it('returns null for non-B2C payloads', () => {
    expect(mpesaB2cParseResult({ Body: { stkCallback: { ResultCode: 0 } } })).toBeNull()
    expect(mpesaB2cParseResult({})).toBeNull()
  })
})

describe('payoutSupportedFor', () => {
  it('binance rail only supports USD/USDT', () => {
    expect(payoutSupportedFor('USD')).toBe(true)
    expect(payoutSupportedFor('USDT')).toBe(true)
    expect(payoutSupportedFor('KES')).toBe(false)
    expect(payoutSupportedFor('UGX')).toBe(false)
    expect(payoutSupportedFor('BTC')).toBe(false)
  })
})