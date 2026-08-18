"use client";

/**
 * News Page — Real-time financial news feed
 * Drop into: src/components/pages/news.tsx
 * Add to your store/routing as page = "news"
 */

import { useState, useEffect, useMemo } from "react";
import { useRobustFetch } from "@/hooks/use-robust-fetch";
import {
  NewsCardSkeleton,
  ErrorState,
  OfflineBanner,
} from "@/components/loading-skeletons";

interface NewsArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  image: string | null;
  source: string;
  publishedAt: string;
  category: string;
  sentiment: "positive" | "negative" | "neutral";
  tickers: string[];
}

const CATEGORIES = [
  { id: "all", label: "All", icon: "📰" },
  { id: "forex", label: "Forex", icon: "💱" },
  { id: "stocks", label: "Stocks", icon: "📈" },
  { id: "crypto", label: "Crypto", icon: "₿" },
  { id: "commodities", label: "Commodities", icon: "🪙" },
  { id: "economy", label: "Economy", icon: "🏛️" },
];

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SentimentBadge({ sentiment }: { sentiment: NewsArticle["sentiment"] }) {
  const config = {
    positive: { bg: "bg-emerald-500/15", text: "text-emerald-400", icon: "▲" },
    negative: { bg: "bg-red-500/15", text: "text-red-400", icon: "▼" },
    neutral: { bg: "bg-slate-500/15", text: "text-slate-400", icon: "●" },
  }[sentiment];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${config.bg} ${config.text}`}>
      {config.icon} {sentiment}
    </span>
  );
}

function NewsCard({ article }: { article: NewsArticle }) {
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden hover:border-white/20 transition group"
    >
      {article.image && (
        <div className="h-40 bg-cover bg-center" style={{ backgroundImage: `url(${article.image})` }} />
      )}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
            {article.source}
          </span>
          <SentimentBadge sentiment={article.sentiment} />
          <span className="text-xs text-muted-foreground">{timeAgo(article.publishedAt)}</span>
        </div>
        <h3 className="font-semibold mb-2 line-clamp-2 group-hover:text-blue-400 transition">
          {article.title}
        </h3>
        <p className="text-sm text-muted-foreground line-clamp-2">{article.description}</p>
        {article.tickers.length > 0 && (
          <div className="mt-3 flex gap-1 flex-wrap">
            {article.tickers.map((t) => (
              <span key={t} className="text-xs px-2 py-0.5 rounded bg-white/5 text-white/70">
                ${t}
              </span>
            ))}
          </div>
        )}
      </div>
    </a>
  );
}

export function NewsPage() {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (category !== "all") params.set("category", category);
    return `/api/news${params.toString() ? `?${params}` : ""}`;
  }, [category]);

  const { data, loading, error, retry, isRetrying, isOffline } = useRobustFetch<{ data: NewsArticle[] }>({
    url,
    refetchInterval: 5 * 60 * 1000,
  });

  const articles = (data?.data || []).filter((a) =>
    !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 md:p-6">
      <OfflineBanner isOffline={isOffline} />

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">📰 Market News</h1>
          <p className="text-muted-foreground">Real-time financial news from trusted sources</p>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`px-4 py-2 rounded-lg whitespace-nowrap text-sm font-medium transition ${
                category === cat.id
                  ? "bg-blue-500 text-white"
                  : "bg-white/5 text-muted-foreground hover:bg-white/10"
              }`}
            >
              <span className="mr-1">{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search news..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full mb-4 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-muted-foreground focus:outline-none focus:border-blue-500"
        />

        {/* Content */}
        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <NewsCardSkeleton key={i} />)}
          </div>
        ) : error ? (
          <ErrorState error={error.message} onRetry={retry} isRetrying={isRetrying} />
        ) : (
          <>
            <div className="text-sm text-muted-foreground mb-3">
              {articles.length} article{articles.length !== 1 ? "s" : ""}
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {articles.map((a) => <NewsCard key={a.id} article={a} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
