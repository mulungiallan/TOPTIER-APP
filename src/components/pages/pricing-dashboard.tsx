'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import {
  CreditCard,
  Crown,
  Zap,
  Sparkles,
  TrendingUp,
  Infinity as InfinityIcon,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Calendar,
  Activity,
  Gift,
  Users,
  ArrowRight,
  ArrowUpRight,
  Check,
  X,
  Clock,
  Receipt,
  Wallet,
  Rocket,
  Copy,
  ChevronRight,
  History,
  Tag,
  ShieldCheck,
  BarChart3,
} from 'lucide-react'
import { useStore, type Page } from '@/lib/store'
import { api } from '@/lib/api'
import { PAYMENTS_ENABLED } from '@/lib/flags'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Types ──────────────────────────────────────────────────────────────────

interface BillingDashboardData {
  user: {
    id: string
    email: string
    name: string | null
    tier: string
    tierLabel: string
    plan: string
    createdAt: string
    referralCode: string
  }
  currentPlan: {
    tier: string
    tierLabel: string
    plan: string
    startDate: string | null
    endDate: string | null
    daysRemaining: number | null
    planDurationDays: number | null
    progressPct: number
    isTrial: boolean
    isLifetime: boolean
    isFree: boolean
    isPremium: boolean
    hasAds: boolean
  }
  usage: {
    analysesLimit: number
    analysesUsed: number
    analysesRemaining: number | null
    analysesPct: number
    analysesResetAt: string | null
    isUnlimited: boolean
  }
  trial: {
    isEligible: boolean
    isTrial: boolean
    hasUsed: boolean
    startDate: string | null
    endDate: string | null
    daysRemaining: number | null
  }
  referral: {
    code: string
    count: number
    earnedPremiumDays: number
    currentTier: { count: number; days: number; name: string; emoji: string } | null
    nextTier: { count: number; days: number; name: string; emoji: string } | null
    progressToNext: number
    recentRewards: Array<{
      id: string
      rewardType: string
      rewardAmount: number
      status: string
      reason: string | null
      createdAt: string
    }>
  }
  billing: {
    totalSpent: number
    lifetimeValue: number
    currency: string
    transactionCount: number
    monthlySpend: Array<{ month: string; amount: number }>
    planBreakdown: Array<{ plan: string; count: number; total: number }>
    recentTransactions: Array<{
      id: string
      amount: number
      currency: string
      planType: string
      paymentMethod: string | null
      paymentProvider: string | null
      status: string
      description: string | null
      invoiceUrl: string | null
      date: string
    }>
  }
  availablePlans: Array<{
    id: string
    name: string
    price: number
    currency: string
    interval: string | null
    color: string
    features: string[]
  }>
}

const PIE_COLORS = ['#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#64748b']

const PLAN_ICONS: Record<string, React.ElementType> = {
  free: Zap,
  trial: Clock,
  premium_monthly: Sparkles,
  premium_annual: Crown,
  lifetime: InfinityIcon,
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PricingDashboardPage() {
  const user = useStore((s) => s.user)
  const setPage = useStore((s) => s.setPage)
  const [data, setData] = useState<BillingDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [couponCode, setCouponCode] = useState('')
  const [applyingCoupon, setApplyingCoupon] = useState(false)
  const [startingTrial, setStartingTrial] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await api.get<{ success: boolean; data: BillingDashboardData }>('/billing/dashboard')
      if (res?.success && res?.data) {
        setData(res.data)
      } else {
        throw new Error('Invalid response from server')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load billing data'
      setError(msg)
      setData(buildFallbackData())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    api.get<{ success: boolean; data: BillingDashboardData }>('/billing/dashboard', { signal: ctrl.signal })
      .then((res) => {
        if (res?.success && res?.data) {
          setData(res.data)
        } else {
          throw new Error('Invalid response from server')
        }
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) {
          const msg = err instanceof Error ? err.message : 'Failed to load billing data'
          setError(msg)
          setData(buildFallbackData())
        }
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [])

  const handleStartTrial = async () => {
    if (!PAYMENTS_ENABLED) {
      try {
        await api.post('/interest', { packageId: 'trial' })
        toast.success("You're on the list — we'll email you when Premium is live.")
      } catch {
        toast.error('Failed to record your interest. Please try again.')
      }
      return
    }
    setStartingTrial(true)
    try {
      const res = await api.post<{ success: boolean; data?: { subscription?: { tier: string } }; error?: string }>('/subscriptions', { planType: 'trial' })
      if (res?.success) {
        toast.success('7-day free trial activated! Enjoy all Premium features.')
        fetchData()
      } else if (res?.error) {
        toast.error(res.error)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start trial'
      toast.error(msg)
    } finally {
      setStartingTrial(false)
    }
  }

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) {
      toast.error('Enter a coupon code first')
      return
    }
    if (!PAYMENTS_ENABLED) {
      toast.info('Coupons will be available when online payments are enabled.')
      return
    }
    setApplyingCoupon(true)
    try {
      const res = await api.post<{ success: boolean; data?: { valid: boolean; code: string; discountType: string; discountAmount: number }; error?: string }>('/coupons/validate', {
        code: couponCode.trim(),
      })
      if (res?.success && res?.data?.valid) {
        const { discountType, discountAmount } = res.data
        const label = discountType === 'percentage'
          ? `${discountAmount}% off`
          : `$${discountAmount.toFixed(2)} off`
        toast.success(`Coupon "${res.data.code}" is valid: ${label}. It is applied at checkout on the Subscriptions page.`)
        setCouponCode('')
      } else if (res?.error) {
        toast.error(res.error)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid or expired coupon code'
      toast.error(msg)
    } finally {
      setApplyingCoupon(false)
    }
  }

  const handleCopyReferral = () => {
    if (!data?.referral?.code) return
    const link = `${typeof window !== 'undefined' ? window.location.origin : 'https://toptier.app'}/?ref=${data.referral.code}`
    navigator.clipboard.writeText(link)
    toast.success('Referral link copied to clipboard!')
  }

  // ─── Loading state ──────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-24" />
        </div>
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-72 w-full rounded-2xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  // ─── Error state with fallback data ─────────────────────────────────────
  if (error && !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Alert variant="destructive" className="max-w-md">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to load</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <Button size="sm" className="mt-3" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </Alert>
      </div>
    )
  }

  if (!data) return null

  const { currentPlan, usage, trial, referral, billing, availablePlans } = data

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="h-7 w-7 text-emerald-500" />
            Pricing Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your subscription, track usage, view billing history, and unlock rewards.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setPage('pricing')}>
            <CreditCard className="h-4 w-4 mr-2" />
            View Plans
          </Button>
        </div>
      </motion.div>

      {/* ─── Current Plan Hero Card ──────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <Card className="overflow-hidden border-emerald-500/30">
          <div className="bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent">
            <CardContent className="p-6 md:p-8">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                {/* Left: plan identity */}
                <div className="flex items-start gap-4">
                  <div className={cn(
                    'inline-flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg',
                    currentPlan.isLifetime ? 'bg-gradient-to-br from-rose-500 to-pink-500'
                      : currentPlan.isTrial ? 'bg-gradient-to-br from-amber-500 to-orange-500'
                      : currentPlan.isFree ? 'bg-gradient-to-br from-slate-500 to-slate-600'
                      : 'bg-gradient-to-br from-emerald-500 to-teal-500'
                  )}>
                    {(() => {
                      const Icon = PLAN_ICONS[currentPlan.plan] || Sparkles
                      return <Icon className="h-7 w-7" />
                    })()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl md:text-2xl font-bold">{currentPlan.tierLabel}</h2>
                      {currentPlan.isTrial && (
                        <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                          <Clock className="h-3 w-3 mr-1" />
                          Trial
                        </Badge>
                      )}
                      {currentPlan.isLifetime && (
                        <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/30">
                          <Crown className="h-3 w-3 mr-1" />
                          Lifetime
                        </Badge>
                      )}
                      {currentPlan.hasAds && !currentPlan.isFree && (
                        <Badge variant="outline" className="text-xs">
                          With Ads
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {currentPlan.isFree
                        ? 'You are on the free plan. Upgrade to unlock all features.'
                        : currentPlan.isLifetime
                        ? 'Lifetime access — never expires.'
                        : currentPlan.endDate
                        ? `Active until ${new Date(currentPlan.endDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`
                        : 'Active subscription'}
                    </p>
                    {currentPlan.startDate && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Started {new Date(currentPlan.startDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right: countdown + CTA */}
                <div className="flex flex-col gap-3 lg:items-end">
                  {currentPlan.daysRemaining !== null && !currentPlan.isLifetime && (
                    <div className="text-center lg:text-right">
                      <div className="text-3xl font-bold tabular-nums">
                        {currentPlan.daysRemaining}
                      </div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">
                        days remaining
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {currentPlan.isFree && trial.isEligible && (
                      <Button
                        onClick={handleStartTrial}
                        disabled={startingTrial}
                        className="bg-gradient-to-r from-amber-500 to-orange-500 hover:opacity-90"
                      >
                        {startingTrial ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting...</>
                        ) : (
                          <><Rocket className="h-4 w-4 mr-2" /> {PAYMENTS_ENABLED ? 'Start 7-Day Trial' : 'Record Interest'}</>
                        )}
                      </Button>
                    )}
                    {(currentPlan.isFree || currentPlan.isTrial) && (
                      <Button onClick={() => setPage('pricing')}>
                        Upgrade Now
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    )}
                    {!currentPlan.isFree && !currentPlan.isLifetime && (
                      <Button variant="outline" onClick={() => setPage('subscriptions')}>
                        Manage Subscription
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              {!currentPlan.isLifetime && !currentPlan.isFree && currentPlan.planDurationDays && (
                <div className="mt-6">
                  <div className="flex justify-between text-xs text-muted-foreground mb-2">
                    <span>Subscription progress</span>
                    <span>{currentPlan.progressPct}% used</span>
                  </div>
                  <Progress value={currentPlan.progressPct} className="h-2" />
                </div>
              )}
            </CardContent>
          </div>
        </Card>
      </motion.div>

      {/* Trial alert (if eligible or active) */}
      {trial.isEligible && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
          <Alert className="border-amber-500/30 bg-amber-500/5">
            <Rocket className="h-4 w-4 text-amber-500" />
            <AlertTitle className="text-amber-700 dark:text-amber-400">
              Your 7-day Premium trial is available!
            </AlertTitle>
            <AlertDescription>
              Unlock all Premium features — unlimited signals, AI screenshot analysis, custom alerts — for free for 7 days.
              <Button
                size="sm"
                className="ml-2"
                onClick={handleStartTrial}
                disabled={startingTrial}
              >
                {startingTrial ? 'Starting...' : PAYMENTS_ENABLED ? 'Activate Trial' : 'Record Interest'}
              </Button>
            </AlertDescription>
          </Alert>
        </motion.div>
      )}

      {trial.isTrial && trial.daysRemaining !== null && trial.daysRemaining <= 2 && (
        <Alert className="border-rose-500/30 bg-rose-500/5">
          <AlertTriangle className="h-4 w-4 text-rose-500" />
          <AlertTitle className="text-rose-700 dark:text-rose-400">Trial ending soon</AlertTitle>
          <AlertDescription>
            Your trial ends in {trial.daysRemaining} day{trial.daysRemaining === 1 ? '' : 's'}. Upgrade now to keep all Premium features.
            <Button size="sm" className="ml-2" onClick={() => setPage('pricing')}>
              Upgrade <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ─── Usage Stats Grid ────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
      >
        {/* Analyses usage */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>AI Analyses</CardDescription>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </div>
            <CardTitle className="text-2xl tabular-nums">
              {usage.isUnlimited ? '∞' : `${usage.analysesUsed} / ${usage.analysesLimit}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {usage.isUnlimited ? (
              <p className="text-xs text-emerald-600 flex items-center gap-1">
                <Check className="h-3 w-3" /> Unlimited analyses
              </p>
            ) : (
              <>
                <Progress value={usage.analysesPct} className="h-1.5 mb-1.5" />
                <p className="text-xs text-muted-foreground">
                  {usage.analysesRemaining} remaining
                  {usage.analysesResetAt && (
                    <> · resets {new Date(usage.analysesResetAt).toLocaleDateString()}</>
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Days remaining */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>Days Remaining</CardDescription>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </div>
            <CardTitle className="text-2xl tabular-nums">
              {currentPlan.isLifetime ? '∞' : currentPlan.daysRemaining ?? '—'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {currentPlan.isLifetime
                ? 'Lifetime access'
                : currentPlan.isFree
                ? 'No active subscription'
                : currentPlan.endDate
                ? `Ends ${new Date(currentPlan.endDate).toLocaleDateString()}`
                : '—'}
            </p>
          </CardContent>
        </Card>

        {/* Total spent */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>Lifetime Spend</CardDescription>
              <Receipt className="h-4 w-4 text-muted-foreground" />
            </div>
            <CardTitle className="text-2xl tabular-nums">
              ${billing.totalSpent.toFixed(2)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {billing.transactionCount} transaction{billing.transactionCount === 1 ? '' : 's'}
            </p>
          </CardContent>
        </Card>

        {/* Referral count */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription>Referrals</CardDescription>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <CardTitle className="text-2xl tabular-nums">
              {referral.count}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {referral.earnedPremiumDays > 0
                ? `${referral.earnedPremiumDays} premium days earned`
                : 'Invite friends to earn rewards'}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── Quick Actions Row ───────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <QuickAction
          icon={CreditCard}
          label="Browse Plans"
          description="View all subscription options"
          onClick={() => setPage('pricing')}
        />
        <QuickAction
          icon={Tag}
          label="Redeem Coupon"
          description="Apply a discount code"
          onClick={() => document.getElementById('coupon-input')?.focus()}
        />
        <QuickAction
          icon={Gift}
          label="Refer Friends"
          description="Earn premium days"
          onClick={() => handleCopyReferral()}
        />
        <QuickAction
          icon={History}
          label="Billing History"
          description="View past invoices"
          onClick={() => document.getElementById('billing-history')?.scrollIntoView({ behavior: 'smooth' })}
        />
      </motion.div>

      {/* ─── Charts row ──────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Monthly spend chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="lg:col-span-3"
        >
          <Card className="h-full">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    Monthly Spend
                  </CardTitle>
                  <CardDescription>Last 6 months of completed transactions</CardDescription>
                </div>
                <Badge variant="secondary">{billing.currency}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={billing.monthlySpend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(v: number) => [`$${v.toFixed(2)}`, 'Spend']}
                    />
                    <Bar dataKey="amount" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Plan breakdown pie */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-2"
        >
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-violet-500" />
                Plan Breakdown
              </CardTitle>
              <CardDescription>By transaction count</CardDescription>
            </CardHeader>
            <CardContent>
              {billing.planBreakdown.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                  <Receipt className="h-10 w-10 mb-2 opacity-40" />
                  <p className="text-sm">No paid transactions yet</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => setPage('pricing')}>
                    Browse Plans
                  </Button>
                </div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={billing.planBreakdown}
                        dataKey="count"
                        nameKey="plan"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={40}
                        label={(entry: { plan: string; count: number }) => `${entry.plan} (${entry.count})`}
                        labelLine={false}
                      >
                        {billing.planBreakdown.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                        formatter={(v: number, _name, entry) => [`$${(entry?.payload?.total ?? 0).toFixed(2)} total`, `${v} tx`]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ─── Two-column: Billing history + referral panel ───────────────── */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Billing history */}
        <motion.div
          id="billing-history"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="lg:col-span-3"
        >
          <Card className="h-full">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <History className="h-4 w-4 text-emerald-500" />
                  Billing History
                </CardTitle>
                <Badge variant="secondary">{billing.recentTransactions.length}</Badge>
              </div>
              <CardDescription>Recent payment transactions</CardDescription>
            </CardHeader>
            <CardContent>
              {billing.recentTransactions.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  <Receipt className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No transactions yet</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => setPage('pricing')}>
                    Choose a Plan
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence>
                    {billing.recentTransactions.slice(0, 8).map((tx, idx) => (
                      <motion.div
                        key={tx.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.35 + idx * 0.03 }}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card/50 hover:bg-accent/40 transition"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={cn(
                            'inline-flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0',
                            tx.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' :
                            tx.status === 'failed' ? 'bg-rose-500/10 text-rose-500' :
                            tx.status === 'refunded' ? 'bg-amber-500/10 text-amber-500' :
                            'bg-slate-500/10 text-slate-500'
                          )}>
                            {tx.status === 'completed' ? <Check className="h-4 w-4" /> :
                             tx.status === 'failed' ? <X className="h-4 w-4" /> :
                             <Clock className="h-4 w-4" />}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate text-sm">
                              {tx.description || tx.planType.replace(/_/g, ' ')}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                              <span>{new Date(tx.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                              {tx.paymentProvider && (
                                <>
                                  <span>·</span>
                                  <span className="capitalize">{tx.paymentProvider}</span>
                                </>
                              )}
                              {tx.paymentMethod && (
                                <>
                                  <span>·</span>
                                  <span className="capitalize">{tx.paymentMethod}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="text-right">
                            <div className="font-semibold tabular-nums">
                              ${tx.amount.toFixed(2)}
                            </div>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] py-0 px-1.5',
                                tx.status === 'completed' ? 'border-emerald-500/30 text-emerald-600' :
                                tx.status === 'failed' ? 'border-rose-500/30 text-rose-600' :
                                tx.status === 'refunded' ? 'border-amber-500/30 text-amber-600' :
                                ''
                              )}
                            >
                              {tx.status}
                            </Badge>
                          </div>
                          {tx.invoiceUrl && (
                            <Button size="icon" variant="ghost" className="h-8 w-8" asChild>
                              <a href={tx.invoiceUrl} target="_blank" rel="noopener noreferrer">
                                <ArrowUpRight className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Referral panel + coupon */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="lg:col-span-2 space-y-4"
        >
          {/* Referral card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-violet-500" />
                Referral Program
              </CardTitle>
              <CardDescription>Earn premium days by inviting friends</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2 rounded-md border bg-muted/50 font-mono text-sm">
                  {referral.code}
                </div>
                <Button size="icon" variant="outline" onClick={handleCopyReferral}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>

              {/* Tier progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <span className="text-lg">{referral.currentTier?.emoji || '🎯'}</span>
                    <span className="font-medium">
                      {referral.currentTier?.name || 'Newcomer'}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {referral.count} / {referral.nextTier?.count || referral.count}
                  </span>
                </div>
                {referral.nextTier ? (
                  <>
                    <Progress value={referral.progressToNext} className="h-1.5" />
                    <p className="text-xs text-muted-foreground">
                      {referral.nextTier.count - referral.count} more to reach{' '}
                      <span className="font-medium">
                        {referral.nextTier.emoji} {referral.nextTier.name}
                      </span>{' '}
                      ({referral.nextTier.days === 36500 ? 'lifetime' : `${referral.nextTier.days} days`})
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-emerald-600 flex items-center gap-1">
                    <Crown className="h-3 w-3" /> Highest tier unlocked!
                  </p>
                )}
              </div>

              <Button variant="outline" size="sm" className="w-full" onClick={() => setPage('subscriptions')}>
                View All Rewards
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </CardContent>
          </Card>

          {/* Coupon card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-amber-500" />
                Redeem Coupon
              </CardTitle>
              <CardDescription>Apply a discount code to your plan</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <input
                  id="coupon-input"
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="ENTER CODE"
                  className="flex-1 px-3 py-2 rounded-md border bg-background text-sm font-mono uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
                <Button onClick={handleApplyCoupon} disabled={applyingCoupon}>
                  {applyingCoupon ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Coupons grant one-time discounts on eligible plans. Terms apply.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ─── Available plans quick view ──────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
      >
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-500" />
                  Available Plans
                </CardTitle>
                <CardDescription>Compare and switch plans anytime</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setPage('pricing')}>
                View Full Pricing
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {availablePlans.map((plan) => {
                const Icon = PLAN_ICONS[plan.id] || Sparkles
                const isCurrent = currentPlan.plan === plan.id || currentPlan.tier === plan.id
                return (
                  <div
                    key={plan.id}
                    className={cn(
                      'relative rounded-xl border p-4 transition-all',
                      isCurrent ? 'border-emerald-500 bg-emerald-500/5' : 'hover:border-emerald-500/40'
                    )}
                  >
                    {isCurrent && (
                      <Badge className="absolute -top-2 right-3 bg-emerald-500 text-white text-[10px] py-0">
                        Current
                      </Badge>
                    )}
                    <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white mb-2">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="font-semibold text-sm">{plan.name}</div>
                    <div className="mt-1">
                      <span className="text-lg font-bold tabular-nums">
                        ${plan.price.toFixed(2)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">
                        {plan.interval === 'lifetime' ? 'once' : plan.interval ? `/${plan.interval === '7_days' ? '7d' : plan.interval === 'monthly' ? 'mo' : 'yr'}` : 'free'}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {plan.features.slice(0, 3).map((f, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1">
                          <Check className="h-3 w-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                          <span className="truncate">{f}</span>
                        </li>
                      ))}
                    </ul>
                    {!isCurrent && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full mt-3 h-7 text-xs"
                        onClick={() => setPage('pricing')}
                      >
                        {plan.price === 0 ? 'Switch' : 'Choose'}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── Payment security footer ─────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground pt-2"
      >
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          Secure payments
        </div>
        <div className="flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-emerald-500" />
          7-day money-back guarantee
        </div>
        <div className="flex items-center gap-1.5">
          <X className="h-3.5 w-3.5 text-emerald-500" />
          Cancel anytime · No hidden fees
        </div>
      </motion.div>
    </div>
  )
}

// ─── QuickAction sub-component ──────────────────────────────────────────────

function QuickAction({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: React.ElementType
  label: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-3 p-4 rounded-xl border bg-card hover:border-emerald-500/40 hover:bg-accent/40 transition-all text-left"
    >
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500/20 transition">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm flex items-center gap-1">
          {label}
          <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition" />
        </div>
        <div className="text-xs text-muted-foreground truncate">{description}</div>
      </div>
    </button>
  )
}

// ─── Helper: BarChart3 icon is now imported from lucide-react ──────────────

// ─── Fallback data when API is unavailable ──────────────────────────────────

function buildFallbackData(): BillingDashboardData {
  const now = new Date()
  return {
    user: {
      id: 'demo',
      email: 'demo@toptier.app',
      name: 'Demo Trader',
      tier: 'free',
      tierLabel: 'Free',
      plan: 'free',
      createdAt: now.toISOString(),
      referralCode: 'DEMO2024',
    },
    currentPlan: {
      tier: 'free',
      tierLabel: 'Free',
      plan: 'free',
      startDate: null,
      endDate: null,
      daysRemaining: null,
      planDurationDays: null,
      progressPct: 0,
      isTrial: false,
      isLifetime: false,
      isFree: true,
      isPremium: false,
      hasAds: true,
    },
    usage: {
      analysesLimit: 5,
      analysesUsed: 2,
      analysesRemaining: 3,
      analysesPct: 40,
      analysesResetAt: null,
      isUnlimited: false,
    },
    trial: {
      isEligible: true,
      isTrial: false,
      hasUsed: false,
      startDate: null,
      endDate: null,
      daysRemaining: null,
    },
    referral: {
      code: 'DEMO2024',
      count: 0,
      earnedPremiumDays: 0,
      currentTier: null,
      nextTier: { count: 5, days: 1, name: 'Bronze', emoji: '🥉' },
      progressToNext: 0,
      recentRewards: [],
    },
    billing: {
      totalSpent: 0,
      lifetimeValue: 0,
      currency: 'USD',
      transactionCount: 0,
      monthlySpend: Array.from({ length: 6 }).map((_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
        return { month: d.toLocaleDateString('en-US', { month: 'short' }), amount: 0 }
      }),
      planBreakdown: [],
      recentTransactions: [],
    },
    availablePlans: [
      { id: 'free', name: 'Free', price: 0, currency: 'USD', interval: null, color: 'slate', features: ['3 signals per day', 'Basic market coverage', 'Community access', 'Economic calendar'] },
      { id: 'trial', name: '7-Day Trial', price: 0, currency: 'USD', interval: '7_days', color: 'amber', features: ['All premium features', 'Unlimited signals', 'Screenshot analysis', 'Custom alerts'] },
      { id: 'premium_monthly', name: 'Premium Monthly', price: 29.99, currency: 'USD', interval: 'monthly', color: 'emerald', features: ['Unlimited signals', 'All market coverage', 'AI screenshot analysis', 'No ads'] },
      { id: 'premium_annual', name: 'Premium Annual', price: 249.99, currency: 'USD', interval: 'annual', color: 'violet', features: ['Everything in Premium Monthly', '2 months free', 'Early access to features', 'Exclusive webinars'] },
      { id: 'lifetime', name: 'Lifetime Access', price: 499.99, currency: 'USD', interval: 'lifetime', color: 'rose', features: ['Everything in Premium', 'Lifetime access', 'One-time payment', 'VIP support'] },
    ],
  }
}

export default PricingDashboardPage
