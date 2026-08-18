/**
 * Economic Calendar Service
 * Drop into: src/lib/calendar-service.ts
 *
 * Sources (in priority order):
 *  1. Alpha Vantage Economic Indicators (free, 25 req/day but cached heavily)
 *  2. FRED API (free, more data)
 *  3. Static fallback with major recurring events
 */

import { cache, cacheKeys } from "./cache";

export interface EconomicEvent {
  id: string;
  title: string;
  country: string;
  countryCode: string;
  currency: string;
  date: string;       // ISO date
  time?: string;      // HH:mm UTC
  impact: "high" | "medium" | "low";
  actual?: string | null;
  forecast?: string | null;
  previous?: string | null;
  source: string;
  category: string;
}

const COUNTRY_MAP: Record<string, { code: string; currency: string; flag: string }> = {
  "United States": { code: "US", currency: "USD", flag: "🇺🇸" },
  "Euro Zone": { code: "EU", currency: "EUR", flag: "🇪🇺" },
  "Germany": { code: "DE", currency: "EUR", flag: "🇩🇪" },
  "France": { code: "FR", currency: "EUR", flag: "🇫🇷" },
  "United Kingdom": { code: "GB", currency: "GBP", flag: "🇬🇧" },
  "Japan": { code: "JP", currency: "JPY", flag: "🇯🇵" },
  "Australia": { code: "AU", currency: "AUD", flag: "🇦🇺" },
  "Canada": { code: "CA", currency: "CAD", flag: "🇨🇦" },
  "Switzerland": { code: "CH", currency: "CHF", flag: "🇨🇭" },
  "New Zealand": { code: "NZ", currency: "NZD", flag: "🇳🇿" },
  "China": { code: "CN", currency: "CNY", flag: "🇨🇳" },
  "India": { code: "IN", currency: "INR", flag: "🇮🇳" },
};

// Alpha Vantage free functions for economic data
const AV_INDICATORS = [
  { fn: "REAL_GDP", country: "United States", title: "GDP Growth Rate", impact: "high", category: "GDP" },
  { fn: "CPI", country: "United States", title: "Consumer Price Index (CPI)", impact: "high", category: "Inflation" },
  { fn: "INFLATION", country: "United States", title: "Inflation Rate", impact: "high", category: "Inflation" },
  { fn: "FEDERAL_FUNDS_RATE", country: "United States", title: "Federal Funds Rate", impact: "high", category: "Interest Rate" },
  { fn: "UNEMPLOYMENT", country: "United States", title: "Unemployment Rate", impact: "high", category: "Employment" },
  { fn: "TREASURY_YIELD", country: "United States", title: "Treasury Yield", impact: "medium", category: "Bonds" },
];

async function fetchAlphaVantage(): Promise<EconomicEvent[]> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) throw new Error("ALPHA_VANTAGE_API_KEY missing");

  const events: EconomicEvent[] = [];

  // Fetch each indicator — but respect rate limits (only fetch top 3 each call)
  for (const ind of AV_INDICATORS.slice(0, 3)) {
    try {
      const url = `https://www.alphavantage.co/query?function=${ind.fn}&apikey=${apiKey}`;
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (!res.ok) continue;
      const data = await res.json();
      const entries = data?.data || [];
      if (entries.length === 0) continue;

      const latest = entries[0];
      const previous = entries[1];
      const meta = COUNTRY_MAP[ind.country] || { code: "US", currency: "USD", flag: "🇺🇸" };

      events.push({
        id: `av-${ind.fn}-${latest.date}`,
        title: ind.title,
        country: ind.country,
        countryCode: meta.code,
        currency: meta.currency,
        date: latest.date,
        time: "08:30",
        impact: ind.impact,
        actual: latest.value ? `${latest.value}%` : null,
        previous: previous?.value ? `${previous.value}%` : null,
        forecast: null,
        source: "Alpha Vantage",
        category: ind.category,
      });
    } catch (e) {
      console.error(`AV fetch failed for ${ind.fn}:`, e);
    }
  }

  return events;
}

// ---------- Static fallback calendar ----------
// Real-world recurring economic events (approximate dates — used when APIs are unavailable)
function buildFallbackCalendar(startDate: Date, endDate: Date): EconomicEvent[] {
  const events: EconomicEvent[] = [];
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  // FOMC meetings (8x/year) — approx every 6 weeks
  // Nonfarm Payrolls — first Friday of each month
  // CPI release — mid-month
  for (let i = 0; i <= days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const day = d.getDay();
    const date = d.getDate();
    const month = d.getMonth();

    // First Friday — Nonfarm Payrolls
    if (day === 5 && date <= 7) {
      events.push(makeEvent(d, "Nonfarm Payrolls", "United States", "high", "Employment", "08:30"));
    }
    // Mid-month (12-14) — CPI
    if (date >= 12 && date <= 14) {
      events.push(makeEvent(d, "CPI m/m", "United States", "high", "Inflation", "08:30"));
    }
    // FOMC — approx every 6 weeks (mid-week)
    if (day === 2 && (date === 14 || date === 28 || date === 7 || date === 21)) {
      events.push(makeEvent(d, "FOMC Statement & Rate Decision", "United States", "high", "Interest Rate", "14:00"));
    }
    // ECB — first Thursday of month
    if (day === 4 && date <= 7) {
      events.push(makeEvent(d, "ECB Main Refinancing Rate", "Euro Zone", "high", "Interest Rate", "11:45"));
    }
    // BoE — Thursday after first Monday
    if (day === 4 && date >= 8 && date <= 14) {
      events.push(makeEvent(d, "BoE Official Bank Rate", "United Kingdom", "high", "Interest Rate", "12:00"));
    }
    // BoJ — varies
    if (day === 2 && date >= 20 && date <= 24) {
      events.push(makeEvent(d, "BoJ Policy Rate", "Japan", "high", "Interest Rate", "03:00"));
    }
  }

  return events;
}

function makeEvent(d: Date, title: string, country: string, impact: EconomicEvent["impact"], category: string, time: string): EconomicEvent {
  const meta = COUNTRY_MAP[country] || { code: "US", currency: "USD", flag: "🇺🇸" };
  return {
    id: `fallback-${title}-${d.toISOString().slice(0, 10)}`,
    title,
    country,
    countryCode: meta.code,
    currency: meta.currency,
    date: d.toISOString().slice(0, 10),
    time,
    impact,
    actual: null,
    forecast: null,
    previous: null,
    source: "Static Calendar",
    category,
  };
}

// ---------- Public API ----------
export const calendarService = {
  async getEvents(startDate?: string, endDate?: string): Promise<EconomicEvent[]> {
    const start = startDate || new Date().toISOString().slice(0, 10);
    const end = endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const key = cacheKeys.calendar(start, end);
    return cache.remember<EconomicEvent[]>(key, 600, async () => {
      try {
        const avEvents = await fetchAlphaVantage();
        const fallback = buildFallbackCalendar(new Date(start), new Date(end));
        // Merge: prefer Alpha Vantage for actuals, fallback for upcoming schedule
        const merged = [...avEvents, ...fallback.filter((f) => !avEvents.some((a) => a.title === f.title && a.date === f.date))];
        return merged
          .filter((e) => e.date >= start && e.date <= end)
          .sort((a, b) => new Date(`${a.date}T${a.time || "00:00"}Z`).getTime() - new Date(`${b.date}T${b.time || "00:00"}Z`).getTime());
      } catch (e) {
        console.warn("Calendar API failed, using static:", e);
        return buildFallbackCalendar(new Date(start), new Date(end));
      }
    });
  },

  async getHighImpact(): Promise<EconomicEvent[]> {
    const all = await this.getEvents();
    return all.filter((e) => e.impact === "high");
  },
};
