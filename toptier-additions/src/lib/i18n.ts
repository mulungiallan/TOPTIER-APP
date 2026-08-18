/**
 * i18n — Internationalization
 * Drop into: src/lib/i18n.ts
 *
 * Supports: en, es, fr, de, ar (RTL), ja, zh
 * Add more translations in: public/locales/{lang}/common.json
 */

import fs from "fs";
import path from "path";

export type Locale = "en" | "es" | "fr" | "de" | "ar" | "ja" | "zh";

export const LOCALES: Locale[] = ["en", "es", "fr", "de", "ar", "ja", "zh"];
export const DEFAULT_LOCALE: Locale = "en";
export const RTL_LOCALES: Locale[] = ["ar"];

export const LOCALE_NAMES: Record<Locale, { name: string; native: string; flag: string }> = {
  en: { name: "English", native: "English", flag: "🇬🇧" },
  es: { name: "Spanish", native: "Español", flag: "🇪🇸" },
  fr: { name: "French", native: "Français", flag: "🇫🇷" },
  de: { name: "German", native: "Deutsch", flag: "🇩🇪" },
  ar: { name: "Arabic", native: "العربية", flag: "🇸🇦" },
  ja: { name: "Japanese", native: "日本語", flag: "🇯🇵" },
  zh: { name: "Chinese", native: "中文", flag: "🇨🇳" },
};

// ============ LOAD TRANSLATIONS ============
const translationsCache = new Map<string, Record<string, string>>();

function loadTranslations(locale: Locale, namespace = "common"): Record<string, string> {
  const cacheKey = `${locale}.${namespace}`;
  if (translationsCache.has(cacheKey)) return translationsCache.get(cacheKey)!;

  try {
    const filePath = path.join(process.cwd(), "public", "locales", locale, `${namespace}.json`);
    const content = fs.readFileSync(filePath, "utf-8");
    const translations = JSON.parse(content);
    translationsCache.set(cacheKey, translations);
    return translations;
  } catch {
    // Fall back to English
    if (locale !== DEFAULT_LOCALE) return loadTranslations(DEFAULT_LOCALE, namespace);
    return {};
  }
}

// ============ TRANSLATE ============
export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const translations = loadTranslations(locale);
  let value = translations[key] || key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }

  return value;
}

// ============ FORMATTING ============
export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  const intlLocale = locale === "ar" ? "ar-EG" : locale === "zh" ? "zh-CN" : locale;
  return new Intl.NumberFormat(intlLocale, options).format(value);
}

export function formatCurrency(value: number, locale: Locale, currency = "USD"): string {
  const intlLocale = locale === "ar" ? "ar-EG" : locale === "zh" ? "zh-CN" : locale;
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatDate(date: Date | string, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  const intlLocale = locale === "ar" ? "ar-EG" : locale === "zh" ? "zh-CN" : locale;
  return new Intl.DateTimeFormat(intlLocale, options || {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export function formatRelativeTime(date: Date | string, locale: Locale): string {
  const intlLocale = locale === "ar" ? "ar-EG" : locale === "zh" ? "zh-CN" : locale;
  const diff = new Date(date).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
  const absDiff = Math.abs(diff);
  const day = 86400000;
  const hour = 3600000;
  const min = 60000;

  if (absDiff < min) return rtf.format(Math.round(diff / 1000), "second");
  if (absDiff < hour) return rtf.format(Math.round(diff / min), "minute");
  if (absDiff < day) return rtf.format(Math.round(diff / hour), "hour");
  if (absDiff < 30 * day) return rtf.format(Math.round(diff / day), "day");
  return rtf.format(Math.round(diff / (30 * day)), "month");
}

// ============ TIMEZONE ============
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function convertToTimezone(date: Date | string, timezone: string): Date {
  const d = new Date(date);
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + getTimezoneOffsetMs(timezone));
}

function getTimezoneOffsetMs(timezone: string): number {
  try {
    const now = new Date();
    const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const local = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    return local.getTime() - utc.getTime();
  } catch {
    return 0;
  }
}

// ============ RTL ============
export function isRTL(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

export function getTextDirection(locale: Locale): "ltr" | "rtl" {
  return isRTL(locale) ? "rtl" : "ltr";
}
