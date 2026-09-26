import { describe, expect, it } from 'vitest'
import { normalizePriceSymbol } from './market-data'

describe('normalizePriceSymbol', () => {
  it('passes canonical slash pairs through unchanged', () => {
    expect(normalizePriceSymbol('EUR/USD')).toBe('EUR/USD')
    expect(normalizePriceSymbol('BTC/USD')).toBe('BTC/USD')
    expect(normalizePriceSymbol('AAPL')).toBe('AAPL')
  })

  it('normalizes broker-style bare crypto symbols', () => {
    expect(normalizePriceSymbol('SOLUSD')).toBe('SOL/USD')
    expect(normalizePriceSymbol('ETHUSD')).toBe('ETH/USD')
    expect(normalizePriceSymbol('BTCUSD')).toBe('BTC/USD')
    expect(normalizePriceSymbol('XRPUSD')).toBe('XRP/USD')
    expect(normalizePriceSymbol('USDTUSD')).toBe('USDT/USD')
  })

  it('is case-insensitive', () => {
    expect(normalizePriceSymbol('solusd')).toBe('SOL/USD')
    expect(normalizePriceSymbol('BtCuSd')).toBe('BTC/USD')
  })

  it('also normalizes the USDT-suffixed broker spelling', () => {
    expect(normalizePriceSymbol('SOLUSDT')).toBe('SOL/USD')
    expect(normalizePriceSymbol('BTCUSDT')).toBe('BTC/USD')
  })

  it('leaves unknown bare symbols untouched', () => {
    expect(normalizePriceSymbol('FOOBAR')).toBe('FOOBAR')
    expect(normalizePriceSymbol('GBPJPY')).toBe('GBPJPY')
  })
})