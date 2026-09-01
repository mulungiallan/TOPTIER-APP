'use client'

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Newspaper,
  Search,
  Bookmark,
  BookmarkCheck,
  Share2,
  TrendingUp,
  TrendingDown,
  Minus,
  Globe,
  Crown,
  RefreshCcw,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Zap,
  Filter,
  ChevronDown,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Types ─────────────────────────────────────────────────────────────────────

type Sentiment = 'bullish' | 'bearish' | 'neutral'
type MarketCategory = 'Forex' | 'Crypto' | 'Stocks' | 'Commodities' | 'Economy'
type SessionStatus = 'open' | 'closed'

interface NewsArticle {
  id: string
  source: string
  title: string
  summary: string
  sentiment: Sentiment
  assets: string[]
  category: MarketCategory
  publishedAt: string
  isBookmarked: boolean
  isBreaking?: boolean
}

interface MarketMover {
  asset: string
  change: string
  changePercent: string
  direction: 'up' | 'down'
}

// ─── Static sidebar data (no API for these) ────────────────────────────────────

const marketSessions = [
  { name: 'Asian', status: 'closed' as SessionStatus, time: 'Tokyo 09:00-18:00 JST' },
  { name: 'European', status: 'open' as SessionStatus, time: 'London 08:00-17:00 GMT' },
  { name: 'US', status: 'closed' as SessionStatus, time: 'New York 09:30-16:00 EST' },
]

const topGainers: MarketMover[] = [
  { asset: 'GBP/JPY', change: '+128', changePercent: '+0.67%', direction: 'up' },
  { asset: 'AUD/USD', change: '+0.0045', changePercent: '+0.58%', direction: 'up' },
  { asset: 'BTC/USD', change: '+1,245', changePercent: '+1.32%', direction: 'up' },
]

const topLosers: MarketMover[] = [
  { asset: 'EUR/USD', change: '-0.0032', changePercent: '-0.29%', direction: 'down' },
  { asset: 'XAU/USD', change: '-18.50', changePercent: '-0.63%', direction: 'down' },
  { asset: 'ETH/USD', change: '-42.30', changePercent: '-1.85%', direction: 'down' },
]

const categoryFilters: Array<'All' | MarketCategory> = ['All', 'Forex', 'Crypto', 'Stocks', 'Commodities', 'Economy']
const sentimentFilters: Array<'All' | Sentiment> = ['All', 'bullish', 'bearish', 'neutral']

// Map API category to UI category
function mapApiCategory(apiCategory: string | null): MarketCategory {
  if (!apiCategory) return 'Economy'
  const lower = apiCategory.toLowerCase()
  if (lower.includes('forex') || lower.includes('currency')) return 'Forex'
  if (lower.includes('crypto') || lower.includes('bitcoin') || lower.includes('ethereum')) return 'Crypto'
  if (lower.includes('stock') || lower.includes('equity')) return 'Stocks'
  if (lower.includes('commodit') || lower.includes('gold') || lower.includes('oil')) return 'Commodities'
  return 'Economy'
}

// Map UI category to API category filter
function mapUiCategoryToApi(uiCategory: MarketCategory): string {
  const map: Record<MarketCategory, string> = {
    Forex: 'forex',
    Crypto: 'crypto',
    Stocks: 'stocks',
    Commodities: 'commodities',
    Economy: 'economy',
  }
  return map[uiCategory]
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Recently'
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  } catch {
    return 'Recently'
  }
}

// ─── Helper Components ─────────────────────────────────────────────────────────

function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  const config = {
    bullish: { icon: TrendingUp, className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
    bearish: { icon: TrendingDown, className: 'bg-red-500/10 text-red-600 border-red-500/20' },
    neutral: { icon: Minus, className: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  }
  const { icon: Icon, className } = config[sentiment]
  return (
    <Badge variant="outline" className={cn('gap-1 capitalize', className)}>
      <Icon className="size-3" />
      {sentiment}
    </Badge>
  )
}

function SessionIndicator({ name, status, time }: { name: string; status: SessionStatus; time: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <span className={cn(
        'size-2.5 rounded-full',
        status === 'open' ? 'bg-emerald-500 animate-pulse' : 'bg-red-400'
      )} />
      <div>
        <p className="text-xs font-medium">{name}</p>
        <p className="text-[10px] text-muted-foreground">{time}</p>
      </div>
      <Badge variant={status === 'open' ? 'default' : 'secondary'} className="text-[10px] ml-auto px-1.5 py-0">
        {status === 'open' ? 'Open' : 'Closed'}
      </Badge>
    </div>
  )
}

function MoverRow({ mover }: { mover: MarketMover }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs font-mono font-medium">{mover.asset}</span>
      <div className="flex items-center gap-1">
        {mover.direction === 'up' ? (
          <ArrowUpRight className="size-3 text-emerald-600" />
        ) : (
          <ArrowDownRight className="size-3 text-red-600" />
        )}
        <span className={cn(
          'text-xs font-medium',
          mover.direction === 'up' ? 'text-emerald-600' : 'text-red-600'
        )}>
          {mover.changePercent}
        </span>
      </div>
    </div>
  )
}

function NewsCard({
  article,
  onBookmark,
  onShare,
}: {
  article: NewsArticle
  onBookmark: (id: string) => void
  onShare: (id: string) => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <Card className="overflow-hidden hover:border-primary/20 transition-colors">
        <CardContent className="p-4 space-y-3">
          {/* Source + Time */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                <Newspaper className="size-2.5" />
                {article.source}
              </Badge>
              <SentimentBadge sentiment={article.sentiment} />
            </div>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="size-2.5" />
              {article.publishedAt}
            </span>
          </div>

          {/* Title */}
          <h3 className="font-semibold text-sm leading-snug cursor-pointer hover:text-primary transition-colors line-clamp-2">
            {article.title}
          </h3>

          {/* Summary */}
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {article.summary}
          </p>

          {/* Tags + Actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 flex-wrap">
              {article.assets.map((asset) => (
                <Badge key={asset} variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                  {asset}
                </Badge>
              ))}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {article.category}
              </Badge>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => onBookmark(article.id)}
              >
                {article.isBookmarked ? (
                  <BookmarkCheck className="size-3.5 text-primary" />
                ) : (
                  <Bookmark className="size-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => onShare(article.id)}
              >
                <Share2 className="size-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── Loading Skeletons ─────────────────────────────────────────────────────────

function NewsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            </div>
            <div className="space-y-1">
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Main News Page ────────────────────────────────────────────────────────────

export function NewsPage() {
  const user = useStore((s) => s.user)
  const isPremium = user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'pro'

  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'All' | MarketCategory>('All')
  const [sentimentFilter, setSentimentFilter] = useState<'All' | Sentiment>('All')
  const [activeTab, setActiveTab] = useState('feed')
  const [visibleCount, setVisibleCount] = useState(6)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('news-bookmarks')
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch {
      return new Set()
    }
  })

  // Debounce search input
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 400)
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [searchQuery])

  // Persist bookmarks to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('news-bookmarks', JSON.stringify([...bookmarks]))
    } catch {}
  }, [bookmarks])

  // Fetch news from API
  const fetchNews = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      if (categoryFilter !== 'All') {
        params.set('category', mapUiCategoryToApi(categoryFilter))
      }
      if (sentimentFilter !== 'All') {
        params.set('sentiment', sentimentFilter)
      }
      if (debouncedSearch) {
        params.set('search', debouncedSearch)
      }
      params.set('limit', '50')

      const result = await api.get(`/news?${params.toString()}`)
      const data = result.data as {
        articles: any[]
        total: number
      }

      // Map API articles to UI type
      const mapped: NewsArticle[] = (data.articles || []).map((a, index) => ({
        id: a.id,
        source: a.source || 'Unknown',
        title: a.title,
        summary: a.summary || '',
        sentiment: (a.sentiment as Sentiment) || 'neutral',
        assets: a.taggedAssets ? a.taggedAssets.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
        category: mapApiCategory(a.category),
        publishedAt: formatTimeAgo(a.publishedAt),
        isBookmarked: bookmarks.has(a.id),
        isBreaking: index === 0 && (a.sentiment === 'bullish' || a.sentiment === 'bearish'),
      }))

      setArticles(mapped)
    } catch (err: any) {
      setError(err.message || 'Failed to load news')
    } finally {
      setLoading(false)
    }
  }, [categoryFilter, sentimentFilter, debouncedSearch, bookmarks])

  useEffect(() => {
    fetchNews()
  }, [fetchNews])

  const bookmarkedArticles = useMemo(
    () => articles.filter((a) => bookmarks.has(a.id)),
    [articles, bookmarks]
  )

  const filteredArticles = useMemo(() => {
    return articles.filter((article) => {
      // Category and sentiment already filtered server-side, but keep as fallback
      if (categoryFilter !== 'All' && article.category !== categoryFilter) return false
      if (sentimentFilter !== 'All' && article.sentiment !== sentimentFilter) return false
      return true
    })
  }, [articles, categoryFilter, sentimentFilter])

  const toggleBookmark = (id: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        toast.success('Bookmark removed')
      } else {
        next.add(id)
        toast.success('Article bookmarked')
      }
      return next
    })
    // Also update articles for immediate UI feedback
    setArticles((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, isBookmarked: !a.isBookmarked } : a
      )
    )
  }

  const handleShare = (id: string) => {
    const article = articles.find((a) => a.id === id)
    if (article) {
      navigator.clipboard?.writeText(article.title).catch(() => {})
      toast.success('Title copied to clipboard')
    }
  }

  const loadMore = () => {
    setVisibleCount((prev) => Math.min(prev + 4, filteredArticles.length))
  }

  // Calculate sentiment gauge
  const bullishCount = articles.filter((a) => a.sentiment === 'bullish').length
  const bearishCount = articles.filter((a) => a.sentiment === 'bearish').length
  const total = bullishCount + bearishCount
  const bullishPercent = total > 0 ? Math.round((bullishCount / total) * 100) : 50

  // Breaking news
  const breakingNews = articles.find((a) => a.isBreaking)

  // Loading state
  if (loading && articles.length === 0) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <div className="h-5 w-32 animate-pulse rounded bg-muted" />
              </CardHeader>
              <CardContent className="space-y-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="h-10 animate-pulse rounded bg-muted" />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
        <NewsSkeleton />
      </div>
    )
  }

  // Error state
  if (error && articles.length === 0) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="size-12 text-destructive/50 mb-4" />
            <h3 className="font-semibold mb-1">Failed to Load News</h3>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchNews} className="gap-1.5">
              <Loader2 className="size-3.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Breaking News Banner */}
      {breakingNews && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg bg-red-600 text-white p-3 flex items-center gap-3"
        >
          <div className="flex items-center gap-1.5 shrink-0">
            <Zap className="size-4 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider">Breaking</span>
          </div>
          <p className="text-sm font-medium flex-1 line-clamp-1">
            {breakingNews.title}
          </p>
          <div className="flex items-center gap-1 text-[10px] opacity-80 shrink-0">
            <RefreshCcw className="size-3" />
            Live
          </div>
        </motion.div>
      )}

      {/* Market Overview Section */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Market Sessions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="size-4 text-primary" />
              Market Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {marketSessions.map((session) => (
              <SessionIndicator key={session.name} {...session} />
            ))}
            {/* Session Overlap Note */}
            <div className="rounded-md bg-primary/5 border border-primary/10 p-2 mt-2">
              <p className="text-[10px] text-muted-foreground">
                <span className="font-medium text-primary">London-NY Overlap</span> (13:00-17:00 GMT) — Highest liquidity window
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Market Sentiment Gauge */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" />
              Market Sentiment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-emerald-600 font-medium">
                <TrendingUp className="size-3" />
                Bullish {bullishPercent}%
              </span>
              <span className="flex items-center gap-1 text-red-600 font-medium">
                <TrendingDown className="size-3" />
                Bearish {100 - bullishPercent}%
              </span>
            </div>
            <div className="relative h-3 rounded-full overflow-hidden bg-red-500/20">
              <div
                className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full transition-all"
                style={{ width: `${bullishPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{bullishCount} bullish articles</span>
              <span>{bearishCount} bearish articles</span>
            </div>
          </CardContent>
        </Card>

        {/* Top Movers */}
        <Card className="sm:col-span-2 lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="size-4 text-primary" />
              Top Movers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-emerald-600 mb-2 flex items-center gap-1">
                  <ArrowUpRight className="size-3" />
                  Gainers
                </p>
                {topGainers.map((m) => (
                  <MoverRow key={m.asset} mover={m} />
                ))}
              </div>
              <div>
                <p className="text-xs font-medium text-red-600 mb-2 flex items-center gap-1">
                  <ArrowDownRight className="size-3" />
                  Losers
                </p>
                {topLosers.map((m) => (
                  <MoverRow key={m.asset} mover={m} />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Access Level Notice */}
      {!isPremium && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="flex items-center gap-3 p-4">
            <Crown className="size-5 text-yellow-500 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">Headlines only — 15 min delay</p>
              <p className="text-xs text-muted-foreground">
                Upgrade to Premium for real-time news with full analysis.
              </p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5 border-yellow-500/30 text-yellow-600 hover:bg-yellow-500/10">
              <Crown className="size-3.5" />
              Upgrade
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Search and Filter */}
      <div className="space-y-3">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search news, assets, or keywords..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {debouncedSearch !== searchQuery && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="size-3.5 text-muted-foreground shrink-0" />
          {categoryFilters.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                categoryFilter === cat
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/20'
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Sentiment Filter */}
        <div className="flex items-center gap-2">
          {sentimentFilters.map((s) => (
            <button
              key={s}
              onClick={() => setSentimentFilter(s)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors capitalize',
                sentimentFilter === s
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/20'
              )}
            >
              {s === 'All' ? 'All Sentiments' : s}
            </button>
          ))}
        </div>
      </div>

      {/* Loading overlay when refetching */}
      {loading && articles.length > 0 && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="size-3 animate-spin" />
          <span>Updating news...</span>
        </div>
      )}

      {/* Tabs: Feed / Bookmarks */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="feed" className="gap-1.5">
            <Newspaper className="size-3.5" />
            News Feed
          </TabsTrigger>
          <TabsTrigger value="bookmarks" className="gap-1.5">
            <Bookmark className="size-3.5" />
            Bookmarked
            {bookmarkedArticles.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                {bookmarkedArticles.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* News Feed */}
        <TabsContent value="feed" className="space-y-4 mt-4">
          {/* Pull-to-refresh indicator (decorative) */}
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-2">
            <RefreshCcw className="size-3" />
            <span>Latest news as of just now</span>
          </div>

          {filteredArticles.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="size-12 text-muted-foreground/30 mb-4" />
                <h3 className="font-semibold mb-1">No Articles Found</h3>
                <p className="text-sm text-muted-foreground">
                  Try adjusting your search or filters.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {filteredArticles.slice(0, visibleCount).map((article) => (
                  <NewsCard
                    key={article.id}
                    article={article}
                    onBookmark={toggleBookmark}
                    onShare={handleShare}
                  />
                ))}
              </AnimatePresence>

              {/* Load More */}
              {visibleCount < filteredArticles.length && (
                <div className="flex justify-center pt-2">
                  <Button variant="outline" size="sm" onClick={loadMore} className="gap-2">
                    Load More
                    <ChevronDown className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* Bookmarks */}
        <TabsContent value="bookmarks" className="space-y-4 mt-4">
          {bookmarkedArticles.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Bookmark className="size-12 text-muted-foreground/30 mb-4" />
                <h3 className="font-semibold mb-1">No Bookmarks</h3>
                <p className="text-sm text-muted-foreground">
                  Bookmark articles to read them later.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {bookmarkedArticles.map((article) => (
                  <NewsCard
                    key={article.id}
                    article={article}
                    onBookmark={toggleBookmark}
                    onShare={handleShare}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
