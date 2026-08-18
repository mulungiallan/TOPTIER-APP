import { describe, it, expect, vi, afterEach } from 'vitest'
import { t, isRTL, getLocaleCurrency, detectUserLocale, locales, localeList } from '@/lib/i18n/config'

describe('i18n config', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('supports 20 locales with metadata', () => {
    expect(localeList.length).toBe(20)
    expect(locales.ar.direction).toBe('rtl')
    expect(locales.en.direction).toBe('ltr')
  })

  it('translates known keys', () => {
    expect(t('nav.dashboard', 'es')).toBe('Panel')
    expect(t('nav.dashboard', 'en')).toBe('Dashboard')
    expect(t('nav.dashboard', 'sw')).toBe('Dashibodi')
  })

  it('falls back to English then to the key itself', () => {
    // Unknown locale -> English
    expect(t('nav.dashboard', 'xx')).toBe('Dashboard')
    // Unknown key -> the key
    expect(t('nonexistent.key', 'en')).toBe('nonexistent.key')
  })

  it('detects RTL locales', () => {
    expect(isRTL('ar')).toBe(true)
    expect(isRTL('en')).toBe(false)
    expect(isRTL('zz')).toBe(false)
  })

  it('maps locales to their default currencies', () => {
    expect(getLocaleCurrency('en')).toBe('USD')
    expect(getLocaleCurrency('ke' as unknown as string)).toBe('USD') // ke not a locale code
    expect(getLocaleCurrency('sw')).toBe('KES')
    expect(getLocaleCurrency('ja')).toBe('JPY')
  })

  it('detects browser locale from navigator', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { language: 'fr-FR' },
      configurable: true,
    })
    expect(detectUserLocale()).toBe('fr')
  })

  it('returns default locale when navigator is missing', () => {
    const nav = globalThis.navigator
    // @ts-expect-error simulating SSR
    delete globalThis.navigator
    expect(detectUserLocale()).toBe('en')
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true })
  })
})
