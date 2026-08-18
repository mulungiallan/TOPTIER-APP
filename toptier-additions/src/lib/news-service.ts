/**
 * Real News Feed Service
 * Drop into: src/lib/news-service.ts
 *
 * Uses NewsAPI.org (free tier: 100 requests/day, dev only).
 * Falls back to RSS parsing if NewsAPI quota exhausted or key missing.
 */

import { cache, cacheKeys } from "./cache";

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  content: string;
  url: string;
  image: string | null;
  source: string;
  author: string | null;
  publishedAt: string;
  category: "forex" | "stocks" | "crypto" | "commodities" | "economy" | "general";
  sentiment: "positive" | "negative" | "neutral";
  tickers: string[];
}

interface NewsAPIArticle {
  source: { id: string | null; name: string };
  author: string | null;
  title: string;
  description: string;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  content: string;
}

const NEWS_SOURCES = (process.env.NEWS_SOURCES || "reuters.com,bloomberg.com,cnbc.com,ft.com").split(",");
const DEFAULT_QUERY = process.env.NEWS_QUERY || "forex OR stocks OR trading OR economy";

// ---------- Category detection ----------
function categorize(text: string): NewsArticle["category"] {
  const t = text.toLowerCase();
  if (/\b(forex|fx|currency|eur|usd|gbp|jpy|aud|cad|chf|nzd)\b/.test(t)) return "forex";
  if (/\b(stock|equity|share|nasdaq|nyse|dow|s&p|sp500)\b/.test(t)) return "stocks";
  if (/\b(bitcoin|btc|ethereum|eth|crypto|altcoin|token)\b/.test(t)) return "crypto";
  if (/\b(oil|gold|silver|copper|wheat|corn|commodity|brent|crude)\b/.test(t)) return "commodities";
  if (/\b(fed|ecb|boe|boj|interest rate|inflation|gdp|cpi|nonfarm|powell)\b/.test(t)) return "economy";
  return "general";
}

// ---------- Sentiment scoring (lightweight, no AI needed) ----------
const POSITIVE_WORDS = ["surge", "rally", "gain", "rise", "jump", "boost", "bullish", "upgrade", "beat", "strong", "growth", "rally", "soar", "high"];
const NEGATIVE_WORDS = ["fall", "drop", "decline", "plunge", "crash", "bearish", "downgrade", "miss", "weak", "loss", "risk", "fear", "slump", "low"];

function scoreSentiment(text: string): NewsArticle["sentiment"] {
  const t = text.toLowerCase();
  let pos = 0, neg = 0;
  POSITIVE_WORDS.forEach((w) => { if (t.includes(w)) pos++; });
  NEGATIVE_WORDS.forEach((w) => { if (t.includes(w)) neg++; });
  if (pos > neg + 1) return "positive";
  if (neg > pos + 1) return "negative";
  return "neutral";
}

// ---------- Ticker extraction ----------
const TICKER_RE = /\b(?:\$)?(EUR\/USD|GBP\/USD|USD\/JPY|AUD\/USD|USD\/CAD|USD\/CHF|NZD\/USD|EUR\/GBP|XAU\/USD|BTC|ETH|AAPL|MSFT|GOOGL|TSLA|AMZN|META|NVDA|SPY|QQQ)\b/gi;
function extractTickers(text: string): string[] {
  const matches = text.match(TICKER_RE) || [];
  return Array.from(new Set(matches.map((m) => m.replace(/^\$/, "").toUpperCase()))).slice(0, 6);
}

// ---------- NewsAPI primary ----------
async function fetchFromNewsAPI(category?: string): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) throw new Error("NEWS_API_KEY missing");

  const q = category ? `${category} AND (${DEFAULT_QUERY})` : DEFAULT_QUERY;
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sortBy = "publishedAt";

  const url = new URL(`${process.env.NEWS_API_BASE_URL || "https://newsapi.org/v2"}/everything`);
  url.searchParams.set("q", q);
  url.searchParams.set("from", from);
  url.searchParams.set("sortBy", sortBy);
  url.searchParams.set("pageSize", "30");
  url.searchParams.set("language", "en");
  url.searchParams.set("apiKey", apiKey);

  const res = await fetch(url.toString(), { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`NewsAPI ${res.status}: ${await res.text()}`);
  const data = await res.json() as { articles: NewsAPIArticle[] };

  return (data.articles || [])
    .filter((a) => a.title && a.title !== "[Removed]")
    .map((a, i) => {
      const combined = `${a.title} ${a.description || ""}`;
      return {
        id: `news-${Buffer.from(a.url).toString("base64").slice(0, 16)}-${i}`,
        title: a.title,
        description: a.description || "",
        content: a.content || "",
        url: a.url,
        image: a.urlToImage,
        source: a.source?.name || "Unknown",
        author: a.author,
        publishedAt: a.publishedAt,
        category: categorize(combined),
        sentiment: scoreSentiment(combined),
        tickers: extractTickers(combined),
      } as NewsArticle;
    });
}

// ---------- RSS fallback (no API key needed) ----------
const RSS_FEEDS: Record<string, string[]> = {
  general: [
    "https://feeds.reuters.com/reuters/businessNews",
    "https://feeds.reuters.com/reuters/companyNews",
    "https://www.investing.com/rss/news_1.rss",
  ],
  forex: [
    "https://www.investing.com/rss/news_25.rss",
    "https://feeds.feedburner.com/FXstreetNews",
  ],
  stocks: [
    "https://feeds.reuters.com/reuters/companyNews",
    "https://www.cnbc.com/id/100003114/device/rss/rss.html",
  ],
  economy: [
    "https://www.cnbc.com/id/20910258/device/rss/rss.html",
  ],
};

async function fetchFromRSS(category?: string): Promise<NewsArticle[]> {
  const feeds = category ? RSS_FEEDS[category] || RSS_FEEDS.general : Object.values(RSS_FEEDS).flat();
  const articles: NewsArticle[] = [];

  await Promise.all(
    feeds.map(async (feedUrl) => {
      try {
        const res = await fetch(feedUrl, { next: { revalidate: 300 } });
        if (!res.ok) return;
        const xml = await res.text();
        // Lightweight XML parse (avoid extra deps)
        const items = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
        for (const item of items) {
          const block = item[1];
          const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim();
          const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim();
          const desc = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1]?.trim() || "";
          const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim();
          if (!title || !link) continue;
          const combined = `${title} ${desc.replace(/<[^>]+>/g, "")}`;
          articles.push({
            id: `rss-${Buffer.from(link).toString("base64").slice(0, 16)}`,
            title,
            description: desc.replace(/<[^>]+>/g, ""),
            content: "",
            url: link,
            image: null,
            source: new URL(feedUrl).hostname,
            author: null,
            publishedAt: pubDate || new Date().toISOString(),
            category: categorize(combined),
            sentiment: scoreSentiment(combined),
            tickers: extractTickers(combined),
          });
        }
      } catch (e) {
        console.error(`RSS fetch failed for ${feedUrl}:`, e);
      }
    })
  );

  return articles
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 30);
}

// ---------- Public API ----------
export const newsService = {
  async getNews(category?: string): Promise<NewsArticle[]> {
    const key = cacheKeys.news(category);
    return cache.remember<NewsArticle[]>(key, 300, async () => {
      try {
        return await fetchFromNewsAPI(category);
      } catch (e) {
        console.warn("NewsAPI failed, falling back to RSS:", e);
        return await fetchFromRSS(category);
      }
    });
  },

  async getTrending(): Promise<NewsArticle[]> {
    const all = await this.getNews();
    return all
      .filter((a) => a.tickers.length > 0)
      .slice(0, 10);
  },

  async getByTicker(ticker: string): Promise<NewsArticle[]> {
    const all = await this.getNews();
    return all.filter((a) => a.tickers.includes(ticker.toUpperCase()));
  },
};
