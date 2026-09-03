'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Users, UserPlus, UserMinus, Copy, TrendingUp, Loader2,
  Store, BadgePercent, Wallet, History, UserCheck, Play,
  Pause, Link2, Unlink, Landmark, ShieldCheck, Settings2,
  ExternalLink,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ReferralLockBanner } from '@/components/referral-lock'

interface FollowEntry {
  id: string
  autoCopy: boolean
  copyRatio: number
  maxPositionSize: number
  allocationPct: number
  status: string
  declaredBalanceUsd?: number | null
  termsAccepted?: boolean
  connectionId?: string | null
  connection?: { label: string; brokerName: string | null; platform: string; login: string } | null
  following: { id: string; name: string | null; profilePicture: string | null; subscriptionTier: string; referralCount: number }
}

interface CopyTradeEntry {
  id: string
  symbol: string
  direction: string
  size: number
  entryPrice: number
  status: string
  pnl: number | null
  createdAt: string
  followerId: string
  traderId: string
  trader: { name: string | null; profilePicture: string | null }
}

interface ProviderEntry {
  id: string
  userId: string
  handle: string
  bio: string | null
  copyFeePct: number
  platformFeePct: number
  minAccountBalanceUsd: number
  lotsPer100Usd: number
  status: string
  totalFollowers: number
  realizedPnl: number
  trades: number
  winRate: number
  user: { id: string; name: string | null; profilePicture: string | null }
}

interface SettlementEntry {
  id: string
  grossProfit: number
  providerFeePct: number
  platformFeePct: number
  providerAmount: number
  platformAmount: number
  status: string
  settledBy?: string
  createdAt: string
  follower: { name: string | null }
  trader: { handle: string }
  connection?: { label: string; brokerName: string | null } | null
}

interface ManagerEntry {
  trader: {
    id: string
    handle: string
    copyFeePct: number
    platformFeePct: number
    brokerSettled: boolean
    minAllocationPct: number
    maxAllocationPct: number
    minAccountBalanceUsd: number
    lotsPer100Usd: number
    brokerAccountLabel?: string | null
    brokerAccountLogin?: string | null
    // Risk management settings
    maxRiskPerTradePct: number
    maxConcurrentTrades: number
    marginBudgetPct: number
    drawdownSoftPausePct: number
    accountWideHardStopPct: number
    maxSymbolExposurePct: number
    maxAssetClassExposurePct: number
    weekendCryptoCapPct: number
    newsBlackoutMinutes: number
    // Per-asset-class sizing
    forexBaseLotsPer100Usd: number
    forexMinLotSize: number
    forexMaxLots: number
    forexMaxRiskPct: number
    metalsBaseLotsPer100Usd: number
    metalsMinLotSize: number
    metalsMaxLots: number
    metalsMaxRiskPct: number
    cryptoBaseLotsPer100Usd: number
    cryptoMinLotSize: number
    cryptoMaxLots: number
    cryptoMaxRiskPct: number
    hardStopActive: boolean
    hardStopActivatedAt?: string | null
    currentDrawdownPct: number
    lastRebalanceAt?: string | null
    lastReconcileAt?: string | null
    masterConnection: {
      id: string
      label: string
      brokerName: string | null
      login: string
      platform: string
      tradesCount: number
    } | null
  }
  followers: {
    id: string
    allocationPct: number
    status: string
    declaredBalanceUsd?: number | null
    concurrentTradeCount: number
    allocatedMarginUsd: number
    follower: { id: string; name: string | null; profilePicture: string | null }
  }[]
  totals: {
    providerDue: number
    providerPaid: number
    platformDue: number
    platformPaid: number
  }
  openTrades: CopyTradeEntry[]
  settlements: SettlementEntry[]
  riskEvents: {
    id: string
    eventType: string
    symbol?: string | null
    drawdownPct: number
    thresholdPct: number
    details?: string | null
    createdAt: string
  }[]
  exposure: {
    totalLongLots: number
    totalShortLots: number
    netExposure: number
    bySymbol: Record<string, { long: number; short: number }>
    byAssetClass: Record<string, { long: number; short: number }>
  }
}

interface BotConnectionEntry {
  id: string
  label: string
  platform: string
  login: string
  brokerName: string | null
  isActive: boolean
  _count?: { trades: number }
}

type Tab = 'following' | 'trades' | 'providers' | 'become' | 'manage'

function TradesView({ trades, following, settlements, exitPrices, setExitPrices, handleCloseTrade, closingId }: {
  trades: CopyTradeEntry[]
  following: FollowEntry[]
  settlements: SettlementEntry[]
  exitPrices: Record<string, string>
  setExitPrices: React.Dispatch<React.SetStateAction<Record<string, string>>>
  handleCloseTrade: (id: string) => void
  closingId: string | null
}) {
  const myOpenTrades = trades.filter((t) => t.status === 'open')
  const myClosedTrades = trades.filter((t) => t.status === 'closed')
  const totalPnl = myClosedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0)
  const mySettlements = settlements.filter((s) => s.status === 'due' || s.status === 'paid')
  const totalSettled = mySettlements.reduce((sum, s) => sum + s.providerAmount, 0)

  return (
    <div>
      {following.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-4 mb-4">
          <Card><CardContent className="p-3 text-center">
            <div className="text-2xl font-bold">{myOpenTrades.length}</div>
            <div className="text-xs text-muted-foreground">Open Positions</div>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <div className={cn('text-2xl font-bold', totalPnl >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">Total PnL ({myClosedTrades.length} trades)</div>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <div className="text-2xl font-bold">{following.length}</div>
            <div className="text-xs text-muted-foreground">Traders Followed</div>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <div className="text-2xl font-bold tabular-nums">${totalSettled.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">Settlements ({mySettlements.length})</div>
          </CardContent></Card>
        </div>
      )}
      {trades.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <TrendingUp className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p>No copy trades executed yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Copy Trade History</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {trades.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 p-2 rounded-lg border bg-card/50">
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant={t.direction === 'BUY' ? 'default' : 'destructive'} className="text-[10px]">{t.direction}</Badge>
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{t.symbol}</div>
                    <div className="text-xs text-muted-foreground">
                      From: {t.trader.name || 'Unknown'} · {new Date(t.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm tabular-nums">{t.size} @ ${t.entryPrice}</div>
                    <div className={cn('text-xs tabular-nums', (t.pnl || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                      {t.status === 'open' ? 'Open' : `${(t.pnl || 0) >= 0 ? '+' : ''}$${(t.pnl || 0).toFixed(2)}`}
                    </div>
                  </div>
                  {t.status === 'open' && (
                    <div className="flex items-end gap-2">
                      <Input
                        type="number"
                        step="any"
                        placeholder="Exit price"
                        value={exitPrices[t.id] || ''}
                        onChange={(e) => setExitPrices((prev) => ({ ...prev, [t.id]: e.target.value }))}
                        className="w-24 h-8 text-xs"
                      />
                      <Button size="sm" variant="outline" className="h-8" onClick={() => handleCloseTrade(t.id)} disabled={closingId === t.id}>
                        {closingId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                        Close
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export function CopyTradingPage() {
  const user = useStore((s) => s.user)
  const [following, setFollowing] = useState<FollowEntry[]>([])
  const [trades, setTrades] = useState<CopyTradeEntry[]>([])
  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [myProvider, setMyProvider] = useState<(ProviderEntry & { platformEarned: { due: number; paid: number }; brokerEarned: { due: number; paid: number } }) | null>(null)
  const [settlements, setSettlements] = useState<SettlementEntry[]>([])
  const [manager, setManager] = useState<ManagerEntry | null>(null)
  const [connections, setConnections] = useState<BotConnectionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [newTraderId, setNewTraderId] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [acting, setActing] = useState<string | null>(null)
  const [view, setView] = useState<Tab>('following')
  const [unfollowTarget, setUnfollowTarget] = useState<{ traderId: string; openTrades: number } | null>(null)
  const [closeOnUnfollow, setCloseOnUnfollow] = useState(false)
  const [exitPrices, setExitPrices] = useState<Record<string, string>>({})
  const [closingId, setClosingId] = useState<string | null>(null)
  const [allocDrafts, setAllocDrafts] = useState<Record<string, string>>({})

  // Follow form (account size + Copy Trading T&C)
  const [followBalance, setFollowBalance] = useState('')
  const [followTerms, setFollowTerms] = useState(false)

  // Become a trader form
  const [pHandle, setPHandle] = useState('')
  const [pBio, setPBio] = useState('')
  const [pFee, setPFee] = useState('50')
  const [savingProvider, setSavingProvider] = useState(false)

  // PAMM/MAM manager form
  const [mConnectionId, setMConnectionId] = useState('')
  const [mFee, setMFee] = useState('50')
  const [mBrokerSettled, setMBrokerSettled] = useState(false)
  const [mMin, setMMin] = useState('1')
  const [mMax, setMMax] = useState('100')
  const [mMinBalance, setMMinBalance] = useState('100')
  const [mLots, setMLots] = useState('0.01')
  const [mBrokerLabel, setMBrokerLabel] = useState('')
  const [mBrokerLogin, setMBrokerLogin] = useState('')
  const [savingManager, setSavingManager] = useState(false)
  const [settlingBroker, setSettlingBroker] = useState(false)

  // Risk management settings
  const [mMaxRisk, setMMaxRisk] = useState('2')
  const [mMaxConcurrent, setMMaxConcurrent] = useState('20')
  const [mMarginBudget, setMMarginBudget] = useState('100')
  const [mDrawdownPause, setMDrawdownPause] = useState('8')
  const [mHardStop, setMHardStop] = useState('15')
  const [mMaxSymbolExp, setMMaxSymbolExp] = useState('20')
  const [mMaxClassExp, setMMaxClassExp] = useState('40')
  const [mWeekendCrypto, setMWeekendCrypto] = useState('50')
  const [mNewsBlackout, setMNewsBlackout] = useState('30')

  // Per-asset-class sizing
  const [mFxBase, setMFxBase] = useState('0.02')
  const [mFxMinLot, setMFxMinLot] = useState('0.01')
  const [mFxMaxLots, setMFxMaxLots] = useState('15')
  const [mFxMaxRisk, setMFxMaxRisk] = useState('2')
  const [mMtBase, setMMtBase] = useState('0.01')
  const [mMtMinLot, setMMtMinLot] = useState('0.01')
  const [mMtMaxLots, setMMtMaxLots] = useState('5')
  const [mMtMaxRisk, setMMtMaxRisk] = useState('2')
  const [mCrBase, setMCrBase] = useState('0.01')
  const [mCrMinLot, setMCrMinLot] = useState('0.02')
  const [mCrMaxLots, setMCrMaxLots] = useState('5')
  const [mCrMaxRisk, setMCrMaxRisk] = useState('1.5')
  const [rebalancing, setRebalancing] = useState(false)
  const [reconciling, setReconciling] = useState(false)

  const [refStatus, setRefStatus] = useState<{ lockEnabled: boolean; unlocked: boolean; referralUrl?: string | null; message?: string | null } | null>(null)

  useEffect(() => {
    api.get<{ success: boolean; data: any }>('/referral/status')
      .then((res) => setRefStatus(res?.data || null))
      .catch(() => setRefStatus(null))
  }, [])

  const refLocked = !!refStatus && refStatus.lockEnabled && !refStatus.unlocked

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      const [f, t, p, m, s, mg, c] = await Promise.all([
        api.get<{ success: boolean; data: { data: FollowEntry[] } }>('/copy-trading?view=following', { signal }),
        api.get<{ success: boolean; data: { data: CopyTradeEntry[] } }>('/copy-trading?view=trades', { signal }),
        api.get<{ success: boolean; data: { data: ProviderEntry[] } }>('/copy-trading?view=providers', { signal }),
        api.get<{ success: boolean; data: { data: ProviderEntry & { platformEarned: { due: number; paid: number }; brokerEarned: { due: number; paid: number } } | null } }>('/copy-trading?view=provider', { signal }),
        api.get<{ success: boolean; data: { data: SettlementEntry[] } }>('/copy-trading?view=settlements', { signal }),
        api.get<{ success: boolean; data: { data: ManagerEntry | null } }>('/copy-trading?view=manager', { signal }),
        api.get<{ success: boolean; data: { connections: BotConnectionEntry[] } }>('/bot/connections', { signal }),
      ])
      if (signal?.aborted) return
      setFollowing(f?.data?.data || [])
      setTrades(t?.data?.data || [])
      setProviders(p?.data?.data || [])
      setMyProvider(m?.data?.data || null)
      setSettlements(s?.data?.data || [])
      setManager(mg?.data?.data || null)
      setConnections(c?.data?.connections || [])
      if (mg?.data?.data?.trader?.masterConnection) {
        setMConnectionId(mg.data.data.trader.masterConnection.id)
        setMFee(String(mg.data.data.trader.copyFeePct))
        setMBrokerSettled(mg.data.data.trader.brokerSettled)
        setMMin(String(mg.data.data.trader.minAllocationPct))
        setMMax(String(mg.data.data.trader.maxAllocationPct))
        setMMinBalance(String(mg.data.data.trader.minAccountBalanceUsd ?? 100))
        setMLots(String(mg.data.data.trader.lotsPer100Usd ?? 0.01))
        setMBrokerLabel(mg.data.data.trader.brokerAccountLabel ?? '')
        setMBrokerLogin(mg.data.data.trader.brokerAccountLogin ?? '')
        // Risk management settings
        setMMaxRisk(String(mg.data.data.trader.maxRiskPerTradePct ?? 2))
        setMMaxConcurrent(String(mg.data.data.trader.maxConcurrentTrades ?? 20))
        setMMarginBudget(String(mg.data.data.trader.marginBudgetPct ?? 100))
        setMDrawdownPause(String(mg.data.data.trader.drawdownSoftPausePct ?? 8))
        setMHardStop(String(mg.data.data.trader.accountWideHardStopPct ?? 15))
        setMMaxSymbolExp(String(mg.data.data.trader.maxSymbolExposurePct ?? 20))
        setMMaxClassExp(String(mg.data.data.trader.maxAssetClassExposurePct ?? 40))
        setMWeekendCrypto(String(mg.data.data.trader.weekendCryptoCapPct ?? 50))
        setMNewsBlackout(String(mg.data.data.trader.newsBlackoutMinutes ?? 30))
        // Per-asset-class sizing
        setMFxBase(String(mg.data.data.trader.forexBaseLotsPer100Usd ?? 0.02))
        setMFxMinLot(String(mg.data.data.trader.forexMinLotSize ?? 0.01))
        setMFxMaxLots(String(mg.data.data.trader.forexMaxLots ?? 15))
        setMFxMaxRisk(String(mg.data.data.trader.forexMaxRiskPct ?? 2))
        setMMtBase(String(mg.data.data.trader.metalsBaseLotsPer100Usd ?? 0.01))
        setMMtMinLot(String(mg.data.data.trader.metalsMinLotSize ?? 0.01))
        setMMtMaxLots(String(mg.data.data.trader.metalsMaxLots ?? 5))
        setMMtMaxRisk(String(mg.data.data.trader.metalsMaxRiskPct ?? 2))
        setMCrBase(String(mg.data.data.trader.cryptoBaseLotsPer100Usd ?? 0.01))
        setMCrMinLot(String(mg.data.data.trader.cryptoMinLotSize ?? 0.02))
        setMCrMaxLots(String(mg.data.data.trader.cryptoMaxLots ?? 5))
        setMCrMaxRisk(String(mg.data.data.trader.cryptoMaxRiskPct ?? 1.5))
      }
    } catch {
      if (!signal?.aborted) {
        setFollowing([])
        setTrades([])
        setProviders([])
        setMyProvider(null)
        setSettlements([])
        setManager(null)
        setConnections([])
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    fetchData(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchData])

  const handleFollow = async (traderId: string) => {
    if (!traderId) {
      toast.error('Enter a trader user ID')
      return
    }
    if (!followTerms) {
      toast.error('You must agree to the Copy Trading Terms & Conditions before following')
      return
    }
    const provider = providers.find((p) => p.userId === traderId)
    const minBalance = provider?.minAccountBalanceUsd ?? 100
    const balance = Number(followBalance)
    if (!Number.isFinite(balance) || balance < minBalance) {
      toast.error(`Copy trading requires an account of at least $${minBalance.toFixed(2)}`)
      return
    }
    setActing('new')
    try {
      await api.post('/copy-trading', {
        action: 'follow',
        traderId,
        autoCopy: true,
        copyRatio: 1.0,
        maxPositionSize: 1000,
        declaredBalanceUsd: balance,
        connectionId: selectedConnectionId || undefined,
        termsAccepted: true,
      })
      toast.success('Now following trader!')
      setNewTraderId('')
      setFollowBalance('')
      setFollowTerms(false)
      setSelectedConnectionId('')
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to follow')
    } finally {
      setActing(null)
    }
  }

  const handleUnfollow = async (traderId: string, closeAll = false) => {
    setActing(traderId)
    try {
      await api.post('/copy-trading', { action: 'unfollow', traderId, closeOpenTrades: closeAll })
      toast.success(closeAll ? 'Unfollowed and closed all positions' : 'Unfollowed')
      setUnfollowTarget(null)
      setCloseOnUnfollow(false)
      fetchData()
    } catch {
      toast.error('Failed to unfollow')
    } finally {
      setActing(null)
    }
  }

  const handleToggleAutoCopy = async (entry: FollowEntry, value: boolean) => {
    setFollowing((prev) => prev.map((f) => f.id === entry.id ? { ...f, autoCopy: value } : f))
    try {
      await api.post('/copy-trading', {
        action: 'follow', traderId: entry.following.id,
        autoCopy: value, copyRatio: entry.copyRatio, maxPositionSize: entry.maxPositionSize,
      })
    } catch {
      setFollowing((prev) => prev.map((f) => f.id === entry.id ? { ...f, autoCopy: !value } : f))
      toast.error('Failed to update')
    }
  }

  const handleSetAllocation = async (traderId: string) => {
    const pct = Number(allocDrafts[traderId])
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      toast.error('Allocation must be between 0 and 100%')
      return
    }
    setActing(`alloc-${traderId}`)
    try {
      const res = await api.post<{ success: boolean; data: { follow: FollowEntry & { note?: string | null } } }>('/copy-trading', {
        action: 'allocation', traderId, allocationPct: pct,
      })
      const note = res?.data?.follow?.note
      toast.success(note || `Allocation set to ${res?.data?.follow?.allocationPct ?? pct}%`)
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to set allocation')
    } finally {
      setActing(null)
    }
  }

  const handlePauseResume = async (traderId: string, status: 'active' | 'paused') => {
    setActing(`status-${traderId}`)
    try {
      await api.post('/copy-trading', { action: status === 'paused' ? 'pause' : 'resume', traderId })
      toast.success(status === 'paused' ? 'Copying paused — no new master trades mirrored' : 'Copying resumed')
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setActing(null)
    }
  }

  const handleSaveManager = async () => {
    if (!myProvider) {
      toast.error('Register a copy-trader profile first (Become a Trader tab)')
      setView('become')
      return
    }
    if (!mConnectionId) {
      toast.error('Select a master account to run the bot on')
      return
    }
    const fee = Number(mFee)
    const minPct = Number(mMin)
    const maxPct = Number(mMax)
    if (!Number.isFinite(fee) || fee < 0 || fee > 100) {
      toast.error('Profit share must be between 0 and 100%')
      return
    }
    if (!Number.isFinite(minPct) || !Number.isFinite(maxPct) || minPct <= 0 || maxPct < minPct) {
      toast.error('Enter a valid allocation range (min ≤ max, both > 0)')
      return
    }
    const minBalance = Number(mMinBalance)
    if (!Number.isFinite(minBalance) || minBalance < 100) {
      toast.error('Minimum account size must be at least $100')
      return
    }
    const lots = Number(mLots)
    if (!Number.isFinite(lots) || lots <= 0) {
      toast.error('Enter a valid base lot size (lots per $100)')
      return
    }
    setSavingManager(true)
    try {
      await api.post('/copy-trading', {
        action: 'manager',
        connectionId: mConnectionId,
        profitSharePct: fee,
        brokerSettled: mBrokerSettled,
        minAllocationPct: minPct,
        maxAllocationPct: maxPct,
        minAccountBalanceUsd: minBalance,
        lotsPer100Usd: lots,
        brokerAccountLabel: mBrokerLabel || undefined,
        brokerAccountLogin: mBrokerLogin || undefined,
        // Risk management settings
        maxRiskPerTradePct: Number(mMaxRisk),
        maxConcurrentTrades: Number(mMaxConcurrent),
        marginBudgetPct: Number(mMarginBudget),
        drawdownSoftPausePct: Number(mDrawdownPause),
        accountWideHardStopPct: Number(mHardStop),
        maxSymbolExposurePct: Number(mMaxSymbolExp),
        maxAssetClassExposurePct: Number(mMaxClassExp),
        weekendCryptoCapPct: Number(mWeekendCrypto),
        newsBlackoutMinutes: Number(mNewsBlackout),
        // Per-asset-class sizing
        forexBaseLotsPer100Usd: Number(mFxBase),
        forexMinLotSize: Number(mFxMinLot),
        forexMaxLots: Number(mFxMaxLots),
        forexMaxRiskPct: Number(mFxMaxRisk),
        metalsBaseLotsPer100Usd: Number(mMtBase),
        metalsMinLotSize: Number(mMtMinLot),
        metalsMaxLots: Number(mMtMaxLots),
        metalsMaxRiskPct: Number(mMtMaxRisk),
        cryptoBaseLotsPer100Usd: Number(mCrBase),
        cryptoMinLotSize: Number(mCrMinLot),
        cryptoMaxLots: Number(mCrMaxLots),
        cryptoMaxRiskPct: Number(mCrMaxRisk),
      })
      toast.success(mBrokerSettled
        ? 'Master account linked — your 50% profit share is paid into your broker account (PAMM/MAM)'
        : 'Master account linked — followers will mirror it')
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to link master account')
    } finally {
      setSavingManager(false)
    }
  }

  const handleSettleBroker = async () => {
    setSettlingBroker(true)
    try {
      const res = await api.post<{ success: boolean; data: { settled: number; amount: number } }>('/copy-trading', { action: 'settle-broker' })
      const d = res?.data
      if (d && d.settled > 0) {
        toast.success(`Settled $${d.amount.toFixed(2)} to your broker account`)
      } else {
        toast.info('No provider fees due')
      }
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to settle to broker')
    } finally {
      setSettlingBroker(false)
    }
  }

  const handleUnlinkManager = async () => {
    setActing('unlink')
    try {
      await api.post('/copy-trading', { action: 'unlink-manager' })
      toast.success('Master account unlinked')
      setMConnectionId('')
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to unlink')
    } finally {
      setActing(null)
    }
  }

  const handleRebalance = async () => {
    setRebalancing(true)
    try {
      const res = await api.post<{ success: boolean; data: { rebalanced: number } }>('/copy-trading', { action: 'rebalance' })
      toast.success(`Rebalanced ${res?.data?.rebalanced ?? 0} follower allocations`)
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to rebalance')
    } finally {
      setRebalancing(false)
    }
  }

  const handleReconcile = async () => {
    setReconciling(true)
    try {
      const res = await api.post<{ success: boolean; data: { reconciled: number; summary: { ok: number; moderateDrift: number; significantDrift: number } } }>('/copy-trading', { action: 'reconcile' })
      const s = res?.data?.summary
      if (s && s.significantDrift > 0) {
        toast.warning(`Reconciled ${res?.data?.reconciled} followers — ${s.significantDrift} with significant drift`)
      } else {
        toast.success(`Reconciled ${res?.data?.reconciled} followers — all OK`)
      }
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reconcile')
    } finally {
      setReconciling(false)
    }
  }

  const handleResumeHardStop = async () => {
    setActing('resume-hardstop')
    try {
      await api.post('/copy-trading', { action: 'resume-hardstop' })
      toast.success('Hard stop resumed — all followers reactivated')
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to resume')
    } finally {
      setActing(null)
    }
  }

  const handleCloseTrade = async (tradeId: string) => {
    const exitPrice = Number(exitPrices[tradeId])
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      toast.error('Enter a valid exit price')
      return
    }
    setClosingId(tradeId)
    try {
      const res = await api.post<{ success: boolean; data: { pnl: number } }>('/copy-trading', {
        action: 'close', copyTradeId: tradeId, exitPrice,
      })
      const pnl = res?.data?.pnl ?? 0
      toast.success(pnl >= 0 ? `Closed at +$${pnl.toFixed(2)}` : `Closed at ${pnl.toFixed(2)}`)
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to close trade')
    } finally {
      setClosingId(null)
    }
  }

  const handleSaveProvider = async () => {
    if (!pHandle.trim()) {
      toast.error('Enter a public handle')
      return
    }
    const fee = Number(pFee)
    if (!Number.isFinite(fee) || fee < 0 || fee > 100) {
      toast.error('Copy fee must be between 0 and 100%')
      return
    }
    setSavingProvider(true)
    try {
      await api.post('/copy-trading', {
        action: 'provider',
        handle: pHandle.trim(),
        bio: pBio.trim() || undefined,
        copyFeePct: fee,
      })
      toast.success('Copy trader profile saved!')
      setView('become')
      fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save profile')
    } finally {
      setSavingProvider(false)
    }
  }

  const openTradeCount = trades.filter((t) => t.status === 'open').length

  if (refLocked) {
    return (
      <div className="space-y-5 p-3 md:p-4 max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Copy className="h-7 w-7 text-violet-500" />
            Copy Trading
          </h1>
        </motion.div>
        <ReferralLockBanner message={refStatus?.message} referralUrl={refStatus?.referralUrl} />
      </div>
    )
  }

  return (
    <div className="space-y-5 p-3 md:p-4 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Copy className="h-7 w-7 text-violet-500" />
          Copy Trading
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Follow top traders, mirror their signals, or register yourself as a copy trader and earn from followers.
        </p>
      </motion.div>

      <div className="flex gap-2 flex-wrap">
        <Button variant={view === 'following' ? 'default' : 'outline'} size="sm" onClick={() => setView('following')}>
          <Users className="h-4 w-4 mr-1.5" /> Following ({following.length})
        </Button>
        <Button variant={view === 'trades' ? 'default' : 'outline'} size="sm" onClick={() => setView('trades')}>
          <TrendingUp className="h-4 w-4 mr-1.5" /> Copy Trades ({openTradeCount} open)
        </Button>
        <Button variant={view === 'providers' ? 'default' : 'outline'} size="sm" onClick={() => setView('providers')}>
          <Store className="h-4 w-4 mr-1.5" /> Find Traders ({providers.length})
        </Button>
        <Button variant={view === 'become' ? 'default' : 'outline'} size="sm" onClick={() => setView('become')}>
          <BadgePercent className="h-4 w-4 mr-1.5" /> Become a Trader
        </Button>
        <Button variant={view === 'manage' ? 'default' : 'outline'} size="sm" onClick={() => setView('manage')}>
          <Landmark className="h-4 w-4 mr-1.5" /> Manage (PAMM)
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : view === 'following' ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">Follow a new trader (user ID)</label>
                  <input
                    type="text"
                    value={newTraderId}
                    onChange={(e) => setNewTraderId(e.target.value)}
                    placeholder="e.g. user_abc123..."
                    className="w-full mt-1 px-3 py-2 rounded-md border bg-background text-sm"
                  />
                </div>
                <Button onClick={() => handleFollow(newTraderId.trim())} disabled={acting === 'new'}>
                  {acting === 'new' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1.5" />}
                  Follow
                </Button>
              </div>
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Link broker account (PAMM/MAM)
                  </label>
                  {connections.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No broker accounts linked. <Button variant="link" className="h-auto p-0 text-xs" onClick={() => window.location.hash = ''}>Link your MT5 account first</Button> in Bot Trading.
                    </p>
                  ) : (
                    <select
                      value={selectedConnectionId}
                      onChange={(e) => setSelectedConnectionId(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                    >
                      <option value="">— Select broker account (optional) —</option>
                      {connections.filter((c) => c.isActive).map((c) => (
                        <option key={c.id} value={c.id}>{c.label} ({c.platform.toUpperCase()} · {c.brokerName || 'Unknown'} · {c.login})</option>
                      ))}
                    </select>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Linking your broker account enables the PAMM/MAM system to track positions on your real account.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Your account size (USD) — must be $100 or more
                  </label>
                  <Input
                    type="number"
                    min={100}
                    step="any"
                    value={followBalance}
                    onChange={(e) => setFollowBalance(e.target.value)}
                    placeholder="e.g. 500"
                  />
                  <p className="text-xs text-muted-foreground">
                    Mirrored lot sizes scale progressively with your account size. Losses stay in your account —
                    the trader only earns 50% of your <span className="font-medium">profitable</span> trades, never a share of losses.
                  </p>
                </div>
                <label className="flex items-start gap-2.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={followTerms}
                    onChange={(e) => setFollowTerms(e.target.checked)}
                    className="mt-0.5 size-4 accent-violet-600"
                  />
                  <span>
                    I agree to the <span className="font-medium text-foreground">Copy Trading Terms &amp; Conditions</span>: my account is
                    at least $100, the trader earns 50% of my take-profit profits only (never losses), and copied trades are
                    executed in my own broker account.
                  </span>
                </label>
              </div>
            </CardContent>
          </Card>

          {following.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p>You're not following anyone yet. Try the Find Traders tab.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {following.map((f, idx) => (
                <motion.div key={f.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarFallback>{(f.following.name || 'A')[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{f.following.name || 'Anonymous'}</span>
                          <Badge variant="outline" className="text-[10px] capitalize">{f.following.subscriptionTier}</Badge>
                          <span className="text-xs text-muted-foreground">{f.following.referralCount} refs</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Account: <span className="font-mono">${f.declaredBalanceUsd ? f.declaredBalanceUsd.toFixed(2) : '—'}</span> · Copy ratio: <span className="font-mono">{f.copyRatio}×</span> · Max size: <span className="font-mono">${f.maxPositionSize}</span> ·{' '}
                          {f.status === 'paused' ? (
                            <Badge variant="destructive" className="text-[10px] ml-0.5">Paused</Badge>
                          ) : (
                            <span>Allocation: <span className="font-mono">{f.allocationPct}%</span></span>
                          )}
                          {f.termsAccepted && <Badge variant="outline" className="text-[10px] ml-1 text-emerald-600 border-emerald-600/30">T&C ✓</Badge>}
                          {f.connection && <Badge variant="outline" className="text-[10px] ml-1 text-blue-600 border-blue-600/30">Broker: {f.connection.label}</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step="any"
                            placeholder="Alloc %"
                            value={allocDrafts[f.following.id] ?? ''}
                            onChange={(e) => setAllocDrafts((prev) => ({ ...prev, [f.following.id]: e.target.value }))}
                            className="w-20 h-8 text-xs"
                          />
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleSetAllocation(f.following.id)} disabled={acting === `alloc-${f.following.id}`}>
                            {acting === `alloc-${f.following.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Settings2 className="h-3 w-3" />}
                            Set
                          </Button>
                        </div>
                        <Button size="icon" variant="ghost" onClick={() => handlePauseResume(f.following.id, f.status === 'paused' ? 'active' : 'paused')} disabled={acting === `status-${f.following.id}`}>
                          {acting === `status-${f.following.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : f.status === 'paused' ? <Play className="h-4 w-4 text-emerald-500" /> : <Pause className="h-4 w-4 text-amber-500" />}
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => {
                          const openTrades = trades.filter((t) => t.followerId === user?.id && t.traderId === f.following.id && t.status === 'open').length
                          setUnfollowTarget({ traderId: f.following.id, openTrades })
                        }} disabled={acting === f.following.id}>
                          {acting === f.following.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4 text-rose-500" />}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      ) : view === 'trades' ? (
        <TradesView trades={trades} following={following} settlements={settlements} exitPrices={exitPrices} setExitPrices={setExitPrices} handleCloseTrade={handleCloseTrade} closingId={closingId} />
      ) : view === 'providers' ? (
        providers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Store className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>No copy traders registered yet. Be the first on the Become a Trader tab!</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {providers.map((p, idx) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback>{(p.user.name || p.handle || 'T')[0].toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">@{p.handle}</span>
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {p.totalFollowers} followers
                        </Badge>
                        <Badge className="text-[10px] bg-emerald-500/10 text-emerald-600">Win {p.winRate}%</Badge>
                      </div>
                      {p.bio && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{p.bio}</p>}
                      <div className="text-xs text-muted-foreground mt-0.5">
                        <span className="text-emerald-600 font-medium">{p.copyFeePct}%</span> of your profitable trades only (never losses) · Min account{' '}
                        <span className="font-mono">${p.minAccountBalanceUsd}</span> · Base size <span className="font-mono">{p.lotsPer100Usd} lot/$100</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Realized PnL:{' '}
                        <span className={cn('font-mono', p.realizedPnl >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                          {p.realizedPnl >= 0 ? '+' : ''}${p.realizedPnl.toFixed(2)}
                        </span>
                        {p.trades > 0 && <> · {p.trades} closed trades</>}
                      </div>
                    </div>
                    {p.userId === user?.id ? (
                      <Badge variant="secondary" className="text-[10px]">You</Badge>
                    ) : (
                      <Button size="sm" onClick={() => { setNewTraderId(p.userId); setFollowBalance(''); setFollowTerms(false); setView('following') }} disabled={acting === 'new'}>
                        <UserPlus className="h-4 w-4 mr-1.5" /> Follow
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )
      ) : view === 'manage' ? (
        <div className="space-y-4">
          <Card className="border-violet-500/30 bg-violet-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Landmark className="h-4 w-4 text-violet-500" /> PAMM/MAM Manager
              </CardTitle>
              <CardDescription>
                Link one of your MetaTrader accounts as the MASTER. The bot trades it live and followers'
                allocations are mirrored from it. At a PAMM/MAM broker the broker itself settles your profit
                share; otherwise it is tracked as due for manual settlement.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {connections.length === 0 ? (
                <div className="flex items-start gap-3 rounded-lg border border-dashed p-4">
                  <Link2 className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="text-sm text-muted-foreground">
                    No linked trading accounts yet. Add one on the <span className="font-semibold text-foreground">Trading Bot</span> page first — it will become your master account.
                    {process.env.NEXT_PUBLIC_BROKER_REFERRAL_URL && (
                      <a
                        href={process.env.NEXT_PUBLIC_BROKER_REFERRAL_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block mt-2 text-xs text-[#1b4f9c] hover:underline inline-flex items-center gap-1"
                      >
                        Don&apos;t have an MT5 account? Open one with our broker partner <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Master account (your live trading account)</Label>
                    <select
                      value={mConnectionId}
                      onChange={(e) => setMConnectionId(e.target.value)}
                      disabled={savingManager}
                      className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                    >
                      <option value="">Select an account…</option>
                      {connections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label} · {c.platform.toUpperCase()} #{c.login}{c.brokerName ? ` · ${c.brokerName}` : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Tip: run this account on a broker with PAMM/MAM support so followers can invest and the broker auto-pays you.
                      {process.env.NEXT_PUBLIC_BROKER_REFERRAL_URL && (
                        <a
                          href={process.env.NEXT_PUBLIC_BROKER_REFERRAL_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1 text-[#1b4f9c] hover:underline inline-flex items-center gap-0.5"
                        >
                          Open an account <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </p>
                    <p className="text-xs text-amber-600/80">
                      One account, one use: an account running the bot can't be a copy-trading MASTER, and vice versa. Stop the bot first if you want to switch.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="m-fee">Your profit share (% of followers' positive profits)</Label>
                    <Input
                      id="m-fee"
                      type="number"
                      min={0}
                      max={100}
                      value={mFee}
                      onChange={(e) => setMFee(e.target.value)}
                      disabled={savingManager}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="m-min">Min follower allocation (%)</Label>
                    <Input
                      id="m-min"
                      type="number"
                      min={0.1}
                      max={100}
                      step="any"
                      value={mMin}
                      onChange={(e) => setMMin(e.target.value)}
                      disabled={savingManager}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="m-max">Max follower allocation (%)</Label>
                    <Input
                      id="m-max"
                      type="number"
                      min={0.1}
                      max={100}
                      step="any"
                      value={mMax}
                      onChange={(e) => setMMax(e.target.value)}
                      disabled={savingManager}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="m-minbal">Minimum follower account size (USD)</Label>
                    <Input
                      id="m-minbal"
                      type="number"
                      min={100}
                      step="any"
                      value={mMinBalance}
                      onChange={(e) => setMMinBalance(e.target.value)}
                      disabled={savingManager}
                    />
                    <p className="text-xs text-muted-foreground">Copy trading requires $100 or more. Followers below this are rejected.</p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Broker account (where your copy-trading money is paid)</Label>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Input
                        type="text"
                        placeholder="Broker account label (e.g. FP Markets Master)"
                        value={mBrokerLabel}
                        onChange={(e) => setMBrokerLabel(e.target.value)}
                        disabled={savingManager}
                      />
                      <Input
                        type="text"
                        placeholder="Broker account login (e.g. 44559901)"
                        value={mBrokerLogin}
                        onChange={(e) => setMBrokerLogin(e.target.value)}
                        disabled={savingManager}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Auto-filled from your master account. Your 50% profit share is paid into this broker account — copy-trading money is
                      <span className="font-semibold"> never</span> paid into Binance.
                    </p>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Broker-settled fees (PAMM/MAM)</p>
                        <p className="text-xs text-muted-foreground">
                          ON: your profit share is paid into your <span className="font-mono">broker account</span> above and settlements show as <span className="font-mono">paid</span>.
                          OFF: settlements stay <span className="font-mono">due</span> until you settle them to the broker account here.
                        </p>
                      </div>
                    </div>
                    <Switch checked={mBrokerSettled} onCheckedChange={setMBrokerSettled} disabled={savingManager} />
                  </div>

                  {/* ─── Risk Management Settings (Rules #1-#5) ──────────────── */}
                  <div className="md:col-span-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-amber-500" />
                      <p className="text-sm font-medium">Risk Management Rules</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      These settings control position sizing, exposure limits, and circuit breakers for all followers.
                    </p>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Max risk per trade (%)</Label>
                        <Input type="number" min={0.1} max={10} step="any" value={mMaxRisk} onChange={(e) => setMMaxRisk(e.target.value)} disabled={savingManager} className="h-8 text-xs" />
                        <p className="text-[10px] text-muted-foreground">Rule #1: Hard cap</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Max concurrent trades</Label>
                        <Input type="number" min={1} max={100} value={mMaxConcurrent} onChange={(e) => setMMaxConcurrent(e.target.value)} disabled={savingManager} className="h-8 text-xs" />
                        <p className="text-[10px] text-muted-foreground">Rule #2: Per-provider cap</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Margin budget (%)</Label>
                        <Input type="number" min={10} max={100} step="any" value={mMarginBudget} onChange={(e) => setMMarginBudget(e.target.value)} disabled={savingManager} className="h-8 text-xs" />
                        <p className="text-[10px] text-muted-foreground">Rule #2: Margin reservation</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Drawdown soft pause (%)</Label>
                        <Input type="number" min={1} max={50} step="any" value={mDrawdownPause} onChange={(e) => setMDrawdownPause(e.target.value)} disabled={savingManager} className="h-8 text-xs" />
                        <p className="text-[10px] text-muted-foreground">Rule #5: Per-provider</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Hard stop (%)</Label>
                        <Input type="number" min={5} max={50} step="any" value={mHardStop} onChange={(e) => setMHardStop(e.target.value)} disabled={savingManager} className="h-8 text-xs" />
                        <p className="text-[10px] text-muted-foreground">Rule #5: Account-wide</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Max symbol exposure (%)</Label>
                        <Input type="number" min={5} max={100} step="any" value={mMaxSymbolExp} onChange={(e) => setMMaxSymbolExp(e.target.value)} disabled={savingManager} className="h-8 text-xs" />
                        <p className="text-[10px] text-muted-foreground">Rule #3: Per-symbol cap</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Max asset-class exposure (%)</Label>
                        <Input type="number" min={10} max={100} step="any" value={mMaxClassExp} onChange={(e) => setMMaxClassExp(e.target.value)} disabled={savingManager} className="h-8 text-xs" />
                        <p className="text-[10px] text-muted-foreground">Rule #3: Per-class cap</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Weekend crypto cap (%)</Label>
                        <Input type="number" min={10} max={100} step="any" value={mWeekendCrypto} onChange={(e) => setMWeekendCrypto(e.target.value)} disabled={savingManager} className="h-8 text-xs" />
                        <p className="text-[10px] text-muted-foreground">Rule #4: Weekend adjustment</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">News blackout (minutes)</Label>
                        <Input type="number" min={0} max={120} value={mNewsBlackout} onChange={(e) => setMNewsBlackout(e.target.value)} disabled={savingManager} className="h-8 text-xs" />
                        <p className="text-[10px] text-muted-foreground">Rule #4: Before/after release</p>
                      </div>
                    </div>

                    {/* ─── Per-Asset-Class Position Sizing ────────────────── */}
                    <div className="border-t border-amber-500/20 pt-4 space-y-3">
                      <p className="text-xs font-medium">Position Sizing by Pair Type</p>
                      <p className="text-[10px] text-muted-foreground">
                        Lot sizes scale with volatility — forex (lowest vol) gets the most lots, crypto (highest vol) gets the fewest.
                      </p>
                      {/* Forex */}
                      <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
                        <p className="text-[11px] font-semibold text-blue-400">Currency Pairs (Forex)</p>
                        <div className="grid gap-2 grid-cols-4">
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Base lots/$100</Label>
                            <Input type="number" min={0.001} step="any" value={mFxBase} onChange={(e) => setMFxBase(e.target.value)} disabled={savingManager} className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Min lot</Label>
                            <Input type="number" min={0.01} step="any" value={mFxMinLot} onChange={(e) => setMFxMinLot(e.target.value)} disabled={savingManager} className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Max lots</Label>
                            <Input type="number" min={1} value={mFxMaxLots} onChange={(e) => setMFxMaxLots(e.target.value)} disabled={savingManager} className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Max risk %</Label>
                            <Input type="number" min={0.1} max={10} step="any" value={mFxMaxRisk} onChange={(e) => setMFxMaxRisk(e.target.value)} disabled={savingManager} className="h-7 text-xs" />
                          </div>
                        </div>
                      </div>
                      {/* Metals */}
                      <div className="rounded-md border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-2">
                        <p className="text-[11px] font-semibold text-yellow-500">Metals (Gold, Silver, etc.)</p>
                        <div className="grid gap-2 grid-cols-4">
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Base lots/$100</Label>
                            <Input type="number" min={0.001} step="any" value={mMtBase} onChange={(e) => setMMtBase(e.target.value)} disabled={savingManager} className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Min lot</Label>
                            <Input type="number" min={0.01} step="any" value={mMtMinLot} onChange={(e) => setMMtMinLot(e.target.value)} disabled={savingManager} className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Max lots</Label>
                            <Input type="number" min={1} value={mMtMaxLots} onChange={(e) => setMMtMaxLots(e.target.value)} disabled={savingManager} className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Max risk %</Label>
                            <Input type="number" min={0.1} max={10} step="any" value={mMtMaxRisk} onChange={(e) => setMMtMaxRisk(e.target.value)} disabled={savingManager} className="h-7 text-xs" />
                          </div>
                        </div>
                      </div>
                      {/* Crypto */}
                      <div className="rounded-md border border-purple-500/20 bg-purple-500/5 p-3 space-y-2">
                        <p className="text-[11px] font-semibold text-purple-400">Crypto (BTC, ETH, etc.)</p>
                        <div className="grid gap-2 grid-cols-4">
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Base lots/$100</Label>
                            <Input type="number" min={0.001} step="any" value={mCrBase} onChange={(e) => setMCrBase(e.target.value)} disabled={savingManager} className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Min lot</Label>
                            <Input type="number" min={0.01} step="any" value={mCrMinLot} onChange={(e) => setMCrMinLot(e.target.value)} disabled={savingManager} className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Max lots</Label>
                            <Input type="number" min={1} value={mCrMaxLots} onChange={(e) => setMCrMaxLots(e.target.value)} disabled={savingManager} className="h-7 text-xs" />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px]">Max risk %</Label>
                            <Input type="number" min={0.1} max={10} step="any" value={mCrMaxRisk} onChange={(e) => setMCrMaxRisk(e.target.value)} disabled={savingManager} className="h-7 text-xs" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 md:col-span-2">
                    <Button onClick={handleSaveManager} disabled={savingManager}>
                      {savingManager ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Link2 className="h-4 w-4 mr-1.5" />}
                      {manager?.trader?.masterConnection ? 'Update Master Setup' : 'Link Master Account'}
                    </Button>
                    {manager?.trader?.masterConnection && (
                      <Button variant="outline" onClick={handleUnlinkManager} disabled={acting === 'unlink'}>
                        {acting === 'unlink' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Unlink className="h-4 w-4 mr-1.5" />}
                        Unlink
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {manager && manager.trader.masterConnection ? (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-violet-500" /> Manager Dashboard
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-emerald-500/5 border-emerald-500/20 p-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Landmark className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                      <div className="text-xs text-muted-foreground min-w-0">
                        Copy-trading money is paid into your <span className="font-semibold text-foreground">broker account</span> —{' '}
                        <span className="font-mono">{manager.trader.brokerAccountLabel || manager.trader.masterConnection?.label || 'Master account'}</span>
                        {manager.trader.brokerAccountLogin || manager.trader.masterConnection?.login ? (
                          <> · #{manager.trader.brokerAccountLogin || manager.trader.masterConnection?.login}</>
                        ) : null}{' '}
                        (never Binance).
                      </div>
                    </div>
                    <Button size="sm" onClick={handleSettleBroker} disabled={settlingBroker || manager.totals.providerDue <= 0}>
                      {settlingBroker ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Landmark className="h-4 w-4 mr-1.5" />}
                      Settle ${manager.totals.providerDue.toFixed(2)} to broker
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-lg border bg-card p-3 text-center">
                      <p className="text-lg font-bold tabular-nums">${manager.totals.providerDue.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">Profit share due (broker)</p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 text-center">
                      <p className="text-lg font-bold tabular-nums text-emerald-600">${manager.totals.providerPaid.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">Profit share paid (broker)</p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 text-center">
                      <p className="text-lg font-bold tabular-nums">${manager.totals.platformDue.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">TOPTIER fee due</p>
                    </div>
                    <div className="rounded-lg border bg-card p-3 text-center">
                      <p className="text-lg font-bold tabular-nums text-emerald-600">${manager.totals.platformPaid.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">TOPTIER fee paid</p>
                    </div>
                  </div>

                  {/* ─── Circuit Breaker Status ────────────────────────────── */}
                  {manager.trader.hardStopActive && (
                    <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
                      <div className="flex items-start gap-2.5">
                        <ShieldCheck className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-rose-600">Hard Stop Active</p>
                          <p className="text-xs text-muted-foreground">
                            Account-wide drawdown {manager.trader.currentDrawdownPct.toFixed(1)}% exceeded threshold {manager.trader.accountWideHardStopPct}%.
                            All followers paused. Manual review required.
                          </p>
                        </div>
                      </div>
                      <Button size="sm" variant="destructive" onClick={handleResumeHardStop} disabled={acting === 'resume-hardstop'}>
                        {acting === 'resume-hardstop' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Play className="h-4 w-4 mr-1.5" />}
                        Resume
                      </Button>
                    </div>
                  )}

                  {/* ─── Exposure Dashboard (Rule #3) ──────────────────────── */}
                  <div>
                    <div className="text-sm font-medium mb-2 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" /> Net Exposure
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border bg-card p-3 text-center">
                        <p className="text-lg font-bold tabular-nums text-emerald-600">{manager.exposure.totalLongLots.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">Long lots</p>
                      </div>
                      <div className="rounded-lg border bg-card p-3 text-center">
                        <p className="text-lg font-bold tabular-nums text-rose-500">{manager.exposure.totalShortLots.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">Short lots</p>
                      </div>
                      <div className="rounded-lg border bg-card p-3 text-center">
                        <p className={cn('text-lg font-bold tabular-nums', manager.exposure.netExposure >= 0 ? 'text-emerald-600' : 'text-rose-500')}>
                          {manager.exposure.netExposure >= 0 ? '+' : ''}{manager.exposure.netExposure.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">Net</p>
                      </div>
                    </div>
                    {Object.keys(manager.exposure.byAssetClass).length > 0 && (
                      <div className="mt-2 flex gap-2 flex-wrap">
                        {Object.entries(manager.exposure.byAssetClass).map(([cls, exp]) => (
                          <Badge key={cls} variant="outline" className="text-[10px]">
                            {cls}: {exp.long > 0 ? `+${exp.long.toFixed(2)}` : ''}{exp.short > 0 ? ` -${exp.short.toFixed(2)}` : ''}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ─── Rebalance & Reconcile (Rules #6-#7) ──────────────── */}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleRebalance} disabled={rebalancing}>
                      {rebalancing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Settings2 className="h-4 w-4 mr-1.5" />}
                      Rebalance (Rule #6)
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleReconcile} disabled={reconciling}>
                      {reconciling ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <History className="h-4 w-4 mr-1.5" />}
                      Reconcile (Rule #7)
                    </Button>
                    {manager.trader.lastRebalanceAt && (
                      <span className="text-[10px] text-muted-foreground self-center ml-1">
                        Last rebalance: {new Date(manager.trader.lastRebalanceAt).toLocaleDateString()}
                      </span>
                    )}
                    {manager.trader.lastReconcileAt && (
                      <span className="text-[10px] text-muted-foreground self-center ml-1">
                        Last reconcile: {new Date(manager.trader.lastReconcileAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" /> Followers & allocations
                    </div>
                    {manager.followers.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No active followers yet. Share your handle <span className="font-mono">@{manager.trader.handle}</span> and ask them to Follow + set an allocation.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {manager.followers.map((f) => (
                          <div key={f.id} className="flex items-center justify-between gap-3 p-2 rounded-lg border bg-card/50">
                            <div className="flex items-center gap-2 min-w-0">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback>{(f.follower.name || 'A')[0]}</AvatarFallback>
                              </Avatar>
                              <span className="text-sm font-medium truncate">{f.follower.name || 'Anonymous'}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-sm tabular-nums font-semibold">{f.allocationPct}%</span>
                              <span className="text-xs text-muted-foreground ml-2">{f.status}</span>
                              {f.declaredBalanceUsd ? (
                                <span className="text-xs text-muted-foreground ml-2 font-mono">${f.declaredBalanceUsd.toFixed(2)}</span>
                              ) : null}
                              <span className="text-[10px] text-muted-foreground ml-2">
                                {f.concurrentTradeCount} trades · ${(f.allocatedMarginUsd ?? 0).toFixed(0)} margin
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Play className="h-4 w-4 text-muted-foreground" /> Open master trades mirrored
                    </div>
                    {manager.openTrades.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No open mirrored trades yet. They appear live as the bot opens trades on the master account.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {manager.openTrades.map((t) => (
                          <div key={t.id} className="flex items-center justify-between gap-3 p-2 rounded-lg border bg-card/50">
                            <div className="flex items-center gap-2 min-w-0">
                              <Badge variant={t.direction === 'BUY' ? 'default' : 'destructive'} className="text-[10px]">{t.direction}</Badge>
                              <span className="text-sm font-medium">{t.symbol}</span>
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              <span className="font-mono">{t.size}</span> @ <span className="font-mono">{t.entryPrice}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-medium mb-2 flex items-center gap-2">
                      <History className="h-4 w-4 text-muted-foreground" /> Settlements
                    </div>
                    {manager.settlements.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No settlements yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {manager.settlements.map((s) => (
                          <div key={s.id} className="flex items-center justify-between p-2 rounded-lg border bg-card/50">
                            <div>
                              <div className="text-sm font-medium">
                                {s.grossProfit >= 0 ? '+' : ''}${s.grossProfit.toFixed(2)} gross profit
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {s.follower?.name || 'Follower'} · {new Date(s.createdAt).toLocaleDateString()}
                                {s.connection ? ` · ${s.connection.label}` : ''}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm tabular-nums text-emerald-600">+${s.providerAmount.toFixed(2)}</div>
                              <div className="text-xs text-muted-foreground capitalize">
                                {s.settledBy || 'manual'} · {s.status}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ─── Risk Events Log (Rule #5) ────────────────────────── */}
                  {manager.riskEvents && manager.riskEvents.length > 0 && (
                    <div>
                      <div className="text-sm font-medium mb-2 flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-amber-500" /> Risk Events
                      </div>
                      <div className="space-y-2">
                        {manager.riskEvents.map((ev) => (
                          <div key={ev.id} className={cn(
                            'flex items-center justify-between p-2 rounded-lg border',
                            ev.eventType.includes('hard_stop') ? 'bg-rose-500/5 border-rose-500/20' :
                            ev.eventType.includes('soft_pause') ? 'bg-amber-500/5 border-amber-500/20' :
                            'bg-card/50'
                          )}>
                            <div>
                              <div className="text-sm font-medium">
                                {ev.eventType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Drawdown: {ev.drawdownPct.toFixed(1)}% (threshold: {ev.thresholdPct}%)
                                {ev.symbol ? ` · ${ev.symbol}` : ''}
                                {' '}&middot;{' '}{new Date(ev.createdAt).toLocaleString()}
                              </div>
                            </div>
                            <Badge variant={ev.eventType.includes('hard_stop') ? 'destructive' : 'outline'} className="text-[10px]">
                              {ev.eventType.includes('resume') ? 'RESUMED' : ev.eventType.includes('hard_stop') ? 'HARD STOP' : 'PAUSED'}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-start gap-3">
                  <Wallet className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    With <span className="font-semibold">broker-settled</span> mode your broker credits the fee straight into your master account's balance (that's the classic PAMM/MAM payout). TOPTIER's platform fee is still tracked here and paid out through your payout account (Binance or bank). Switch it off to track your cut as <span className="font-mono">due</span> and settle manually.
                  </p>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <Landmark className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">
                  {connections.length === 0
                    ? 'Link a trading account on the Trading Bot page, then come back to activate PAMM/MAM.'
                    : 'Link one of your accounts as the MASTER above to enable managed copy trading.'}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {myProvider && (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-emerald-500" /> Your Copy Trader Profile
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-lg font-bold">@{myProvider.handle}</p>
                    <p className="text-xs text-muted-foreground">Handle</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-lg font-bold">{myProvider.totalFollowers}</p>
                    <p className="text-xs text-muted-foreground">Followers</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3 text-center">
                    <p className={cn('text-lg font-bold', myProvider.realizedPnl >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                      {myProvider.realizedPnl >= 0 ? '+' : ''}${myProvider.realizedPnl.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">Realized PnL</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-lg font-bold">${myProvider.brokerEarned.due.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">In your broker account (due)</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3 text-center">
                    <p className="text-lg font-bold">${myProvider.brokerEarned.paid.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">Settled to broker</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  You earn a <span className="font-semibold">{myProvider.copyFeePct}%</span> share of followers' take-profit profits only — never a share of their
                  losses. Your profit share is paid into your <span className="font-semibold">broker account</span>, not into Binance.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BadgePercent className="h-4 w-4 text-violet-500" /> Register as a Copy Trader
              </CardTitle>
              <CardDescription>
                Get discovered, grow followers, and earn a fee from every profitable copied trade.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cp-handle">Public handle</Label>
                <Input
                  id="cp-handle"
                  type="text"
                  placeholder="@swingtradermaestro"
                  value={pHandle}
                  onChange={(e) => setPHandle(e.target.value)}
                  disabled={savingProvider}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cp-bio">Short bio (optional)</Label>
                <Textarea
                  id="cp-bio"
                  placeholder="Tell followers about your strategy..."
                  value={pBio}
                  onChange={(e) => setPBio(e.target.value)}
                  disabled={savingProvider}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cp-fee">Your copy fee (% of followers' positive profits)</Label>
                <Input
                  id="cp-fee"
                  type="number"
                  min={0}
                  max={100}
                  value={pFee}
                  onChange={(e) => setPFee(e.target.value)}
                  disabled={savingProvider}
                />
                <p className="text-xs text-muted-foreground">
                  Example: follower closes a profitable copy at $100 profit → you earn ${((Number(pFee) || 0)).toFixed(0)}. Your share lands in your broker account, paid on every take-profit hit.
                </p>
              </div>
              <Button onClick={handleSaveProvider} disabled={savingProvider}>
                {savingProvider ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <UserCheck className="h-4 w-4 mr-1.5" />}
                {myProvider ? 'Update Profile' : 'Become a Copy Trader'}
              </Button>
            </CardContent>
          </Card>

          {myProvider && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4 text-violet-500" /> Settlements
                </CardTitle>
              </CardHeader>
              <CardContent>
                {settlements.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No settlements yet. They appear when followers close profitable copied trades.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {settlements.map((s) => (
                      <div key={s.id} className="flex items-center justify-between p-2 rounded-lg border bg-card/50">
                        <div>
                          <div className="text-sm font-medium">
                            {s.grossProfit >= 0 ? '+' : ''}${s.grossProfit.toFixed(2)} gross profit
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {s.follower?.name || 'Follower'} · {new Date(s.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm tabular-nums text-emerald-600">+${s.providerAmount.toFixed(2)}</div>
                          <div className="text-xs text-muted-foreground">
                            Platform fee ${s.platformAmount.toFixed(2)} · {s.status}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 flex items-start gap-3">
              <Wallet className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Copy-trading profit share is paid into your broker account (via the PAMM/MAM manager on the Manage tab) — it is never paid
                into Binance. Your copy-trading earnings are tracked here and on the Monetization page.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Unfollow Confirmation Dialog ─────────────────────────── */}
      {unfollowTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle className="text-lg">Unfollow Trader</CardTitle>
              <CardDescription>
                {unfollowTarget.openTrades > 0
                  ? `This trader has ${unfollowTarget.openTrades} open copied position${unfollowTarget.openTrades > 1 ? 's' : ''} on your account.`
                  : 'No open positions with this trader.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {unfollowTarget.openTrades > 0 && (
                <label className="flex items-start gap-2.5 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={closeOnUnfollow}
                    onChange={(e) => setCloseOnUnfollow(e.target.checked)}
                    className="mt-0.5 size-4 accent-rose-600"
                  />
                  <span>Close all open positions before unfollowing (positions will be settled at current market price)</span>
                </label>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setUnfollowTarget(null); setCloseOnUnfollow(false) }}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={() => handleUnfollow(unfollowTarget.traderId, closeOnUnfollow)}
                  disabled={acting === unfollowTarget.traderId}
                >
                  {acting === unfollowTarget.traderId ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <UserMinus className="h-4 w-4 mr-1.5" />}
                  {closeOnUnfollow ? 'Close & Unfollow' : 'Unfollow'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default CopyTradingPage
