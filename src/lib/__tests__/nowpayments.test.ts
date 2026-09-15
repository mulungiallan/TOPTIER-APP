import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import {
  nowpaymentsConfigured,
  toNowpaymentsCurrency,
  verifyIpnSignature,
} from '@/lib/payments/nowpayments'

const savedEnv = { ...process.env }

function sign(payload: Record<string, unknown>, secret: string): string {
  return createHmac('sha512', secret).update(JSON.stringify(payload, Object.keys(payload).sort())).digest('hex')
}

describe('nowpayments module', () => {
  beforeEach(() => {
    process.env = { ...savedEnv }
    delete process.env.NOWPAYMENTS_API_KEY
    delete process.env.NOWPAYMENTS_IPN_SECRET
  })

  afterEach(() => {
    process.env = savedEnv
  })

  it('is not configured without credentials', () => {
    expect(nowpaymentsConfigured()).toBe(false)
  })

  it('requires both the API key and the IPN secret', () => {
    process.env.NOWPAYMENTS_API_KEY = 'api-key'
    expect(nowpaymentsConfigured()).toBe(false)
    process.env.NOWPAYMENTS_IPN_SECRET = 'ipn-secret'
    expect(nowpaymentsConfigured()).toBe(true)
  })

  it('maps each supported asset to a NOWPayments currency ticket', () => {
    expect(toNowpaymentsCurrency('BTC')).toBe('btc')
    expect(toNowpaymentsCurrency('ETH')).toBe('eth')
    expect(toNowpaymentsCurrency('USDT')).toBe('usdttrc20')
    expect(toNowpaymentsCurrency('SOL')).toBe('sol')
  })

  it('verifies a well-formed IPN signature', () => {
    const secret = 'ipn-secret'
    const payload = {
      payment_id: 5077125052,
      payment_status: 'finished',
      pay_address: 'someaddress',
      price_amount: 0.05,
      price_currency: 'btc',
      pay_amount: 0.05,
      pay_currency: 'btc',
      order_id: 'crpt_abc',
    }
    const rawBody = JSON.stringify(payload)
    const signature = sign(payload, secret)
    expect(verifyIpnSignature(rawBody, signature, secret)).toBe(true)
  })

  it('rejects a tampered body', () => {
    const secret = 'ipn-secret'
    const payload = { payment_id: 1, payment_status: 'waiting' }
    const lying = { payment_id: 999999, payment_status: 'finished' }
    const rawBody = JSON.stringify(lying)
    const signature = sign(payload, secret)
    expect(verifyIpnSignature(rawBody, signature, secret)).toBe(false)
  })

  it('rejects a signature signed with the wrong secret', () => {
    const payload = { payment_id: 1, payment_status: 'finished' }
    const rawBody = JSON.stringify(payload)
    expect(verifyIpnSignature(rawBody, sign(payload, 'other-secret'), 'ipn-secret')).toBe(false)
  })

  it('rejects missing or malformed signatures/JSON', () => {
    expect(verifyIpnSignature('{"payment_id":1}', null, 'secret')).toBe(false)
    expect(verifyIpnSignature('', 'sig', 'secret')).toBe(false)
    expect(verifyIpnSignature('not-json', 'sig', 'secret')).toBe(false)
    expect(verifyIpnSignature('[1,2]', 'sig', 'secret')).toBe(false)
    expect(verifyIpnSignature('{"a":1}', 'sig', '')).toBe(false)
  })
})