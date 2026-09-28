import { describe, it, expect } from 'vitest'
import { parseTradeDate, parseTradeDateOr } from '@/lib/trade-dates'

describe('parseTradeDate', () => {
  it('parses the ISO-8601 strings the Python reporter actually sends', () => {
    // This exact shape caused every trade report to 500: Number(iso) is NaN.
    const d = parseTradeDate('2026-09-25T10:00:52.803582+00:00')
    expect(d).not.toBeNull()
    expect(d!.toISOString()).toBe('2026-09-25T10:00:52.803Z')
  })

  it('never returns an Invalid Date for an ISO string', () => {
    for (const iso of [
      '2026-09-26T06:03:03.405323+00:00',
      '2026-09-25T09:59:39.910240+00:00',
      '2026-09-28T11:47:35.719358',
    ]) {
      const d = parseTradeDate(iso)
      expect(d).not.toBeNull()
      expect(Number.isNaN(d!.getTime())).toBe(false)
    }
  })

  it('parses Unix seconds', () => {
    expect(parseTradeDate(1758787200)!.toISOString()).toBe(new Date(1758787200 * 1000).toISOString())
  })

  it('parses Unix milliseconds without scaling them twice', () => {
    const ms = 1758787200000
    expect(parseTradeDate(ms)!.getTime()).toBe(ms)
  })

  it('parses numeric strings as epoch seconds', () => {
    expect(parseTradeDate('1758787200')!.toISOString()).toBe(new Date(1758787200 * 1000).toISOString())
  })

  it('accepts a Date instance', () => {
    const d = new Date('2026-09-25T10:00:52.803Z')
    expect(parseTradeDate(d)).toBe(d)
  })

  it('returns null for missing or unusable values', () => {
    expect(parseTradeDate(null)).toBeNull()
    expect(parseTradeDate(undefined)).toBeNull()
    expect(parseTradeDate('')).toBeNull()
    expect(parseTradeDate('   ')).toBeNull()
    expect(parseTradeDate('not-a-date')).toBeNull()
    expect(parseTradeDate(0)).toBeNull()
    expect(parseTradeDate(-5)).toBeNull()
    expect(parseTradeDate(new Date('nope'))).toBeNull()
  })
})

describe('parseTradeDateOr', () => {
  it('falls back only when the value is unusable', () => {
    const fallback = new Date('2026-01-01T00:00:00.000Z')
    expect(parseTradeDateOr('2026-09-25T10:00:52.803582+00:00', fallback).toISOString())
      .toBe('2026-09-25T10:00:52.803Z')
    expect(parseTradeDateOr('garbage', fallback)).toBe(fallback)
    expect(parseTradeDateOr(undefined, fallback)).toBe(fallback)
  })
})
