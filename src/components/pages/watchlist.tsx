'use client'

import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Eye,
  Plus,
  X,
  Search,
  TrendingUp,
  TrendingDown,
  GripVertical,
  Zap,
  Crown,
  Signal,
  Trash2,
  Check,
  Filter,
  Clock,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { useLiveMarket } from '@/hooks/use-live-market'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Types ─────────────────────────────────────────────────────────────────────

type MarketType = 'Forex' | 'Crypto' | 'Stocks' | 'Indices' | 'Commodities'

interface WatchlistAsset {
  id: string
  symbol: string
  name: string
  market: MarketType
  price?: number
  change24h?: number
}

interface Watchlist {
  id: string
  name: string
  isDefault: boolean
  items: WatchlistAsset[]
}

// ─── Asset Catalog (instrument list only — prices come from the live market) ──

interface AssetDef {
  symbol: string
  name: string
  market: MarketType
}

const ASSET_CATALOG: AssetDef[] = [
  // Forex
  { symbol: 'EUR/USD', name: 'Euro / US Dollar', market: 'Forex' },
  { symbol: 'GBP/USD', name: 'British Pound / US Dollar', market: 'Forex' },
  { symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen', market: 'Forex' },
  { symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar', market: 'Forex' },
  { symbol: 'USD/CAD', name: 'US Dollar / Canadian Dollar', market: 'Forex' },
  { symbol: 'NZD/USD', name: 'New Zealand Dollar / US Dollar', market: 'Forex' },
  { symbol: 'EUR/GBP', name: 'Euro / British Pound', market: 'Forex' },
  { symbol: 'GBP/JPY', name: 'British Pound / Japanese Yen', market: 'Forex' },
  // Crypto
  { symbol: 'BTC/USD', name: 'Bitcoin', market: 'Crypto' },
  { symbol: 'ETH/USD', name: 'Ethereum', market: 'Crypto' },
  { symbol: 'SOL/USD', name: 'Solana', market: 'Crypto' },
  { symbol: 'XRP/USD', name: 'Ripple', market: 'Crypto' },
  { symbol: 'ADA/USD', name: 'Cardano', market: 'Crypto' },
  // Stocks
  { symbol: 'AAPL', name: 'Apple Inc.', market: 'Stocks' },
  { symbol: 'TSLA', name: 'Tesla Inc.', market: 'Stocks' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', market: 'Stocks' },
  // Indices
  { symbol: 'NAS100', name: 'NASDAQ 100', market: 'Indices' },
  { symbol: 'SPX500', name: 'S&P 500', market: 'Indices' },
  // Commodities
  { symbol: 'XAU/USD', name: 'Gold', market: 'Commodities' },
  { symbol: 'XAG/USD', name: 'Silver', market: 'Commodities' },
]

const ALL_ASSETS: WatchlistAsset[] = ASSET_CATALOG.map((a) => ({
  id: a.symbol,
  symbol: a.symbol,
  name: a.name,
  market: a.market,
}))

const MAX_ITEMS_PER_LIST = 50

// ─── Market Badge ──────────────────────────────────────────────────────────────

// ─── Market Badge ──────────────────────────────────────────────────────────────

function MarketBadge({ market }: { market: MarketType }) {
  const colors: Record<MarketType, string> = {
    Forex: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    Crypto: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    Stocks: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    Indices: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    Commodities: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  }

  return (
    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 border', colors[market])}>
      {market}
    </Badge>
  )
}

// ─── Loading Skeleton ──────────────────────────────────────────────────────────

function WatchlistSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b last:border-b-0">
              <div className="h-4 w-4 animate-pulse rounded bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-3 w-36 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              <div className="h-4 w-12 animate-pulse rounded bg-muted" />
              <div className="hidden sm:block h-6 w-[60px] animate-pulse rounded bg-muted" />
              <div className="h-7 w-16 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Error State ───────────────────────────────────────────────────────────────

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="size-12 text-destructive/50 mb-4" />
        <h3 className="font-semibold mb-1">Failed to Load Watchlist</h3>
        <p className="text-sm text-muted-foreground mb-4">{message}</p>
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
          <Loader2 className="size-3.5" />
          Retry
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Add Asset Dialog ──────────────────────────────────────────────────────────

function AddAssetDialog({
  onAdd,
  existingAssets,
}: {
  onAdd: (asset: WatchlistAsset) => void
  existingAssets: WatchlistAsset[]
}) {
  const [search, setSearch] = useState('')
  const [marketFilter, setMarketFilter] = useState<MarketType | 'all'>('all')
  const [open, setOpen] = useState(false)

  const existingIds = new Set(existingAssets.map((a) => a.id))
  const existingSymbols = new Set(existingAssets.map((a) => a.symbol))

  const filteredAssets = ALL_ASSETS.filter((asset) => {
    const matchesSearch =
      search === '' ||
      asset.symbol.toLowerCase().includes(search.toLowerCase()) ||
      asset.name.toLowerCase().includes(search.toLowerCase())
    const matchesMarket = marketFilter === 'all' || asset.market === marketFilter
    return matchesSearch && matchesMarket
  })

  // Popular assets for quick add
  const popularAssets = ALL_ASSETS.filter((a) => !existingSymbols.has(a.symbol)).slice(0, 8)

  const handleAdd = (asset: WatchlistAsset) => {
    if (existingSymbols.has(asset.symbol)) {
      toast.error(`${asset.symbol} is already in your watchlist`)
      return
    }
    onAdd(asset)
    toast.success(`${asset.symbol} added to watchlist`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          Add Asset
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Asset to Watchlist</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search assets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Market Filter */}
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'Forex', 'Crypto', 'Stocks', 'Indices', 'Commodities'] as const).map((market) => (
                <Button
                  key={market}
                  variant={marketFilter === market ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => setMarketFilter(market)}
                >
                  {market === 'all' ? 'All' : market}
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Quick Add - Popular */}
          {search === '' && marketFilter === 'all' && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Popular Assets</p>
              <div className="grid grid-cols-2 gap-2">
                {popularAssets.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => handleAdd(asset)}
                    className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:bg-muted/50 transition-colors text-left"
                  >
                    <div>
                      <p className="font-medium text-sm">{asset.symbol}</p>
                      <p className="text-[10px] text-muted-foreground">{asset.name}</p>
                    </div>
                    <Plus className="size-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search Results */}
          {(search !== '' || marketFilter !== 'all') && (
            <ScrollArea className="max-h-64">
              <div className="space-y-1">
                {filteredAssets.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No assets found</p>
                ) : (
                  filteredAssets.map((asset) => {
                    const alreadyAdded = existingSymbols.has(asset.symbol)
                    return (
                      <div
                        key={asset.id}
                        className="flex items-center justify-between rounded-lg p-2.5 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{asset.symbol}</span>
                              <MarketBadge market={asset.market} />
                            </div>
                            <p className="text-xs text-muted-foreground">{asset.name}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={alreadyAdded ? 'ghost' : 'outline'}
                          className="h-7 gap-1 text-xs"
                          disabled={alreadyAdded}
                          onClick={() => handleAdd(asset)}
                        >
                          {alreadyAdded ? (
                            <>
                              <Check className="size-3" />
                              Added
                            </>
                          ) : (
                            <>
                              <Plus className="size-3" />
                              Add
                            </>
                          )}
                        </Button>
                      </div>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function WatchlistPage() {
  const { user, setPage } = useStore()
  const isPremium = user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'pro'

  const [watchlists, setWatchlists] = useState<Watchlist[]>([])
  const [activeListId, setActiveListId] = useState<string>('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Fetch watchlists from API
  const fetchWatchlists = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await api.get('/watchlist')
      const apiWatchlists = result.data as Array<{
        id: string
        name: string
        isDefault: boolean
        items: Array<{ id: string; asset: string; assetName: string; order: number }>
      }>

      // Map API data to component types (prices are attached live below)
      const mapped: Watchlist[] = apiWatchlists.map((wl) => ({
        id: wl.id,
        name: wl.name,
        isDefault: wl.isDefault,
        items: wl.items.map((item) => {
          const def = ASSET_CATALOG.find((a) => a.symbol === item.asset)
          return {
            id: item.id,
            symbol: item.asset,
            name: item.assetName || def?.name || item.asset,
            market: def?.market || 'Forex',
          }
        }),
      }))

      setWatchlists(mapped)
      // Set active list to first if not set or current is gone
      if (mapped.length > 0) {
        setActiveListId((prev) => {
          if (prev && mapped.some((w) => w.id === prev)) return prev
          return mapped[0].id
        })
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load watchlists')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWatchlists()
  }, [fetchWatchlists])

  // Collect all unique symbols across all watchlists for live price fetching
  const allSymbols = useMemo(() => {
    const set = new Set<string>()
    watchlists.forEach(wl => wl.items.forEach(item => set.add(item.symbol)))
    return Array.from(set)
  }, [watchlists])

  // Fetch live prices for every symbol across all watchlists
  const { prices: livePrices, lastUpdated, refresh: refreshLive, source, loading: liveLoading } = useLiveMarket({
    symbols: allSymbols,
    refreshMs: 30_000,
    enabled: allSymbols.length > 0,
  })

  // Build a quick lookup map: symbol -> live price
  const livePriceMap = useMemo(() => {
    const m = new Map<string, typeof livePrices[number]>()
    livePrices.forEach(p => m.set(p.symbol, p))
    return m
  }, [livePrices])

  // Attach live prices where available. Items without a price show "unavailable".
  const mergedWatchlists = useMemo<Watchlist[]>(() => {
    return watchlists.map(wl => ({
      ...wl,
      items: wl.items.map(item => {
        const live = livePriceMap.get(item.symbol)
        if (!live) return item
        return {
          ...item,
          price: live.price,
          change24h: live.changePercent,
        }
      }),
    }))
  }, [watchlists, livePriceMap])

  const isLive = source === 'finnhub' || source === 'yahoo' || source === 'mixed'

  const activeList = mergedWatchlists.find((wl) => wl.id === activeListId) || mergedWatchlists[0]
  const activeListCount = activeList?.items.length ?? 0

  // Add asset to active list
  const handleAddAsset = useCallback(
    async (asset: WatchlistAsset) => {
      if (!activeList || activeListCount >= MAX_ITEMS_PER_LIST) {
        toast.error(`Maximum ${MAX_ITEMS_PER_LIST} assets per watchlist`)
        return
      }
      try {
        setActionLoading(true)
        await api.post('/watchlist', {
          action: 'add_item',
          watchlistId: activeList.id,
          asset: asset.symbol,
          assetName: asset.name,
        })
        await fetchWatchlists()
      } catch (err: any) {
        toast.error(err.message || 'Failed to add asset')
      } finally {
        setActionLoading(false)
      }
    },
    [activeList, activeListCount, fetchWatchlists]
  )

  // Remove asset from active list
  const handleRemoveAsset = useCallback(
    async (assetId: string) => {
      try {
        setActionLoading(true)
        await api.delete(`/watchlist?itemId=${assetId}`)
        toast.success('Asset removed from watchlist')
        await fetchWatchlists()
      } catch (err: any) {
        toast.error(err.message || 'Failed to remove asset')
      } finally {
        setActionLoading(false)
      }
    },
    [fetchWatchlists]
  )

  // Create new watchlist
  const handleCreateWatchlist = useCallback(async () => {
    if (!newListName.trim()) {
      toast.error('Please enter a name for the watchlist')
      return
    }
    try {
      setActionLoading(true)
      await api.post('/watchlist', { action: 'create_list', name: newListName.trim() })
      setNewListName('')
      setShowCreateDialog(false)
      toast.success(`Watchlist "${newListName.trim()}" created`)
      await fetchWatchlists()
    } catch (err: any) {
      toast.error(err.message || 'Failed to create watchlist')
    } finally {
      setActionLoading(false)
    }
  }, [newListName, fetchWatchlists])

  // Delete watchlist
  const handleDeleteWatchlist = useCallback(
    async (listId: string) => {
      const list = watchlists.find((wl) => wl.id === listId)
      if (list?.isDefault) {
        toast.error('Cannot delete default watchlist')
        return
      }
      try {
        setActionLoading(true)
        await api.delete(`/watchlist?watchlistId=${listId}`)
        if (activeListId === listId && watchlists.length > 0) {
          setActiveListId(watchlists.find((w) => w.id !== listId)?.id || '')
        }
        toast.success('Watchlist deleted')
        await fetchWatchlists()
      } catch (err: any) {
        toast.error(err.message || 'Failed to delete watchlist')
      } finally {
        setActionLoading(false)
      }
    },
    [watchlists, activeListId, fetchWatchlists]
  )

  // Navigate to the signals page to see real analyst signals for an asset
  const handleViewSignals = useCallback((asset: WatchlistAsset) => {
    setPage('signals')
  }, [setPage])

  // Format price
  const formatPrice = (price: number | undefined, market: MarketType) => {
    if (price === undefined || price === null) return '—'
    if (market === 'Crypto' && price > 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    if (market === 'Forex') return price.toFixed(price < 10 ? 4 : 2)
    if (market === 'Stocks') return price.toFixed(2)
    if (market === 'Indices') return price.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    if (market === 'Commodities') return price.toFixed(price > 100 ? 2 : 4)
    return price.toFixed(2)
  }

  // Loading state
  if (loading) {
    return (
      <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 w-32 animate-pulse rounded bg-muted" />
            <div className="h-4 w-56 animate-pulse rounded bg-muted mt-2" />
          </div>
          <div className="h-6 w-28 animate-pulse rounded bg-muted" />
        </div>
        <WatchlistSkeleton />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h2 className="text-2xl font-bold">Watchlist</h2>
          <p className="text-muted-foreground text-sm mt-1">Track and monitor your favorite assets</p>
        </div>
        <ErrorState message={error} onRetry={fetchWatchlists} />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            Watchlist
            {isLive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                LIVE
              </span>
            )}
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Track and monitor your favorite assets
            {lastUpdated && (
              <span className="ml-1 text-[11px]">
                · Updated {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={refreshLive}
            disabled={liveLoading}
          >
            <RefreshCw className={cn('size-3.5', liveLoading && 'animate-spin')} />
            Refresh
          </Button>
          <Badge variant="outline" className="gap-1.5 text-xs">
            {isLive ? (
              <>
                <Crown className="size-3 text-yellow-500" />
                Real-time prices
              </>
            ) : (
              <>
                <Clock className="size-3" />
                Prices unavailable
              </>
            )}
          </Badge>
        </div>
      </div>

      {/* ─── Watchlist Tabs ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {mergedWatchlists.map((wl) => (
          <button
            key={wl.id}
            onClick={() => setActiveListId(wl.id)}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all whitespace-nowrap',
              activeListId === wl.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {wl.name}
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-[10px] font-bold',
                activeListId === wl.id
                  ? 'bg-primary-foreground/20 text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {wl.items.length}
            </span>
          </button>
        ))}

        {/* Create new watchlist */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1 shrink-0">
              <Plus className="size-4" />
              New List
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Create New Watchlist</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Watchlist name..."
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateWatchlist()}
                disabled={actionLoading}
              />
              <Button className="w-full" onClick={handleCreateWatchlist} disabled={actionLoading}>
                {actionLoading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Create Watchlist
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* No watchlists */}
      {watchlists.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-16 text-center"
        >
          <div className="flex size-20 items-center justify-center rounded-full bg-muted">
            <Eye className="size-10 text-muted-foreground" />
          </div>
          <p className="mt-4 text-lg font-medium">No watchlists yet</p>
          <p className="text-muted-foreground mt-1 text-sm">Create your first watchlist to start tracking assets.</p>
        </motion.div>
      ) : !activeList ? null : (
        <>
          {/* ─── Watchlist Header ───────────────────────────────────── */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold">{activeList.name}</h3>
              <Badge variant="secondary" className="text-xs">
                {activeListCount}/{MAX_ITEMS_PER_LIST} assets
              </Badge>
              {activeListCount > 0 && (
                <Progress value={(activeListCount / MAX_ITEMS_PER_LIST) * 100} className="w-20 h-1.5" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <AddAssetDialog onAdd={handleAddAsset} existingAssets={activeList.items} />
              {!activeList.isDefault && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive gap-1" disabled={actionLoading}>
                      <Trash2 className="size-3.5" />
                      Delete List
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete &quot;{activeList.name}&quot;?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete this watchlist and all its items. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDeleteWatchlist(activeListId)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          {/* ─── Watchlist Content ──────────────────────────────────── */}
          {activeList.items.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              <div className="flex size-20 items-center justify-center rounded-full bg-muted">
                <Eye className="size-10 text-muted-foreground" />
              </div>
              <p className="mt-4 text-lg font-medium">Your watchlist is empty</p>
              <p className="text-muted-foreground mt-1 text-sm">Add assets to start tracking.</p>
              <AddAssetDialog onAdd={handleAddAsset} existingAssets={activeList.items} />
            </motion.div>
          ) : (
            <Card>
              <CardContent className="p-0">
                {/* Table Header */}
                <div className="hidden sm:grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-4 py-3 border-b border-border text-xs font-medium text-muted-foreground">
                  <span className="w-6" /> {/* Grip */}
                  <span>Asset</span>
                  <span className="text-right">Price</span>
                  <span className="text-right">24h Change</span>
                  <span className="text-right">Actions</span>
                </div>

                <ScrollArea className="max-h-[500px]">
                  <div className="divide-y divide-border">
                    {activeList.items.map((asset, index) => (
                      <motion.div
                        key={asset.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto_auto_auto] gap-2 sm:gap-4 items-center px-4 py-3 hover:bg-muted/30 transition-colors"
                      >
                        {/* Drag Handle */}
                        <div className="hidden sm:flex items-center">
                          <GripVertical className="size-4 text-muted-foreground/50 cursor-grab" />
                        </div>

                        {/* Asset Info */}
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm">{asset.symbol}</span>
                              <MarketBadge market={asset.market} />
                            </div>
                            <span className="text-xs text-muted-foreground">{asset.name}</span>
                          </div>
                        </div>

                        {/* Price */}
                        <div className="sm:text-right">
                          {asset.price !== undefined ? (
                            <span className="font-mono font-semibold text-sm">
                              {formatPrice(asset.price, asset.market)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>

                        {/* Change */}
                        {asset.change24h !== undefined ? (
                          <div className="sm:text-right flex items-center sm:justify-end gap-1">
                            {asset.change24h >= 0 ? (
                              <TrendingUp className="size-3.5 text-emerald-500" />
                            ) : (
                              <TrendingDown className="size-3.5 text-red-500" />
                            )}
                            <span
                              className={cn(
                                'font-mono text-sm font-medium',
                                asset.change24h >= 0 ? 'text-emerald-500' : 'text-red-500'
                              )}
                            >
                              {asset.change24h >= 0 ? '+' : ''}
                              {asset.change24h.toFixed(2)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground sm:text-right">—</span>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-1 sm:justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            onClick={() => handleViewSignals(asset)}
                          >
                            <Signal className="size-3" />
                            <span className="hidden sm:inline">Signals</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveAsset(asset.id)}
                            disabled={actionLoading}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ─── Premium Upsell ─────────────────────────────────────── */}
      {!isPremium && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <Crown className="size-5 text-primary shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">Unlock pro analysis tools</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Get advanced signal analysis, priority support, and more.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setPage('subscriptions')} className="shrink-0">
            <Crown className="size-3.5 mr-1" />
            Upgrade
          </Button>
        </div>
      )}
    </div>
  )
}
