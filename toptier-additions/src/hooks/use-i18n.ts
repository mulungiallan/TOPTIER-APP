"use client";

/**
 * i18n Hook — client-side translations
 * Drop into: src/hooks/use-i18n.ts
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Locale, LOCALES, DEFAULT_LOCALE, translate, formatNumber, formatCurrency, formatDate, formatRelativeTime, getTextDirection, isRTL } from "@/lib/i18n";

const STORAGE_KEY = "toptier-locale";

export function useI18n() {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    // Load from localStorage or detect from browser
    const stored = (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY)) as Locale;
    if (stored && LOCALES.includes(stored)) {
      setLocale(stored);
    } else if (typeof navigator !== "undefined") {
      const browserLang = navigator.language.split("-")[0] as Locale;
      if (LOCALES.includes(browserLang)) setLocale(browserLang);
    }
  }, []);

  const changeLocale = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, newLocale);
    }
    // Update document direction for RTL
    if (typeof document !== "undefined") {
      document.documentElement.dir = getTextDirection(newLocale);
      document.documentElement.lang = newLocale;
    }
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>) => {
    return translate(locale, key, params);
  }, [locale]);

  const fmt = useMemo(() => ({
    number: (value: number, options?: Intl.NumberFormatOptions) => formatNumber(value, locale, options),
    currency: (value: number, currency = "USD") => formatCurrency(value, locale, currency),
    date: (date: Date | string, options?: Intl.DateTimeFormatOptions) => formatDate(date, locale, options),
    relativeTime: (date: Date | string) => formatRelativeTime(date, locale),
  }), [locale]);

  return {
    locale,
    setLocale: changeLocale,
    t,
    fmt,
    isRTL: isRTL(locale),
    dir: getTextDirection(locale),
  };
}
