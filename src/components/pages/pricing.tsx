'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check,
  Sparkles,
  Crown,
  Zap,
  Building2,
  Infinity as InfinityIcon,
  Loader2,
  TrendingUp,
  Shield,
  X,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { PAYMENTS_ENABLED } from '@/lib/flags'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Package {
  id: string
  name: string
  description: string | null
  duration: 'monthly' | 'annual'
  price: number
  analyses: number // 0 = unlimited
  splitRatio: number
  features: string[]
  isPopular: boolean
  isActive: boolean
}

interface UserPlan {
  plan: string
  analysesLimit: number
  analysesUsed: number
  planExpiresAt: string | null
}

// ─── Plan metadata (icon + color theme) ─────────────────────────────────────

const planMeta: Record<
  string,
  { icon: React.ElementType; gradient: string; ring: string; badge: string }
> = {
  starter: {
    icon: Zap,
    gradient: 'from-blue-500 to-cyan-500',
    ring: 'ring-blue-500/50',
    badge: 'bg-blue-500/10 text-blue-500',
  },
  premium: {
    icon: Sparkles,
    gradient: 'from-emerald-500 to-teal-500',
    ring: 'ring-emerald-500/50',
    badge: 'bg-emerald-500/10 text-emerald-500',
  },
  pro: {
    icon: TrendingUp,
    gradient: 'from-violet-500 to-purple-500',
    ring: 'ring-violet-500/50',
    badge: 'bg-violet-500/10 text-violet-500',
  },
  enterprise: {
    icon: Building2,
    gradient: 'from-amber-500 to-orange-500',
    ring: 'ring-amber-500/50',
    badge: 'bg-amber-500/10 text-amber-500',
  },
  unlimited: {
    icon: InfinityIcon,
    gradient: 'from-rose-500 to-pink-500',
    ring: 'ring-rose-500/50',
    badge: 'bg-rose-500/10 text-rose-500',
  },
}

function getPlanKey(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('unlimited')) return 'unlimited'
  if (lower.includes('enterprise')) return 'enterprise'
  if (lower.includes('pro')) return 'pro'
  if (lower.includes('premium')) return 'premium'
  if (lower.includes('starter')) return 'starter'
  return 'premium'
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PricingPage() {
  const [packages, setPackages] = useState<Package[]>([])
  const [userPlan, setUserPlan] = useState<UserPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [subscribingTo, setSubscribingTo] = useState<string | null>(null)
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')

  const user = useStore((s) => s.user)
  const setPage = useStore((s) => s.setPage)

  const fetchPackages = useCallback(async () => {
    try {
      setLoading(true)
      // Get auth token
      let token: string | null = null
      try {
        const stored = localStorage.getItem('toptier-store')
        if (stored) {
          const parsed = JSON.parse(stored)
          token = parsed?.state?.authToken || null
        }
      } catch {
        // ignore
      }

      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/packages', { headers })
      const json = await res.json()
      if (json?.data?.packages) {
        setPackages(json.data.packages)
        setUserPlan(json.data.userPlan || null)
      }
    } catch (err) {
      console.error('Failed to fetch packages:', err)
      toast.error('Failed to load packages')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPackages()
  }, [fetchPackages])

  const handleSubscribe = async (packageId: string) => {
    if (!user) {
      setPage('login')
      toast.info('Please sign in to subscribe.')
      return
    }

    if (!PAYMENTS_ENABLED) {
      try {
        await api.post('/interest', { packageId })
        toast.success("You're on the list — we'll email you when online payments are enabled.")
      } catch {
        toast.error('Failed to record your interest. Please try again.')
      }
      return
    }

    setSubscribingTo(packageId)
    try {
      let token: string | null = null
      try {
        const stored = localStorage.getItem('toptier-store')
        if (stored) {
          token = JSON.parse(stored)?.state?.authToken || null
        }
      } catch {
        // ignore
      }

      const res = await fetch('/api/packages/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ packageId }),
      })

      const json = await res.json()
      if (json?.data?.url) {
        window.location.href = json.data.url
      } else if (json?.error) {
        toast.error(json.error)
      } else {
        toast.error('Failed to start checkout. Please try again.')
      }
    } catch (err) {
      console.error('Checkout failed:', err)
      toast.error('Checkout failed. Please try again.')
    } finally {
      setSubscribingTo(null)
    }
  }

  const filteredPackages = packages.filter((p) => p.duration === billingCycle)

  const analysesText = (n: number) => (n === 0 ? 'Unlimited analyses' : `${n.toLocaleString()} analyses / month`)

  const priceDisplay = (price: number, duration: string) =>
    duration === 'annual' ? `$${price.toFixed(2)} / year` : `$${price.toFixed(2)} / month`

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-8 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Subscriptions Paused Banner */}
      {!PAYMENTS_ENABLED && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex size-12 items-center justify-center rounded-xl bg-yellow-500/10">
                <Zap className="size-6 text-yellow-500" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-yellow-600 dark:text-yellow-400">Subscriptions Temporarily Paused</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Online payments are currently disabled. All existing subscribers retain full access. New subscriptions will reopen soon.
                </p>
              </div>
              <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 shrink-0">Paused</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-3"
      >
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Choose Your Plan
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Get AI-powered chart analysis with industry-leading accuracy. Cancel anytime — 7-day money-back guarantee.
        </p>

        {userPlan && userPlan.plan !== 'free' && (
          <Badge variant="secondary" className="text-sm py-1.5 px-3">
            <Crown className="h-3.5 w-3.5 mr-1.5" />
            Current plan: {userPlan.plan.replace(/_/g, ' ')}
            {userPlan.analysesLimit > 0 && (
              <span className="ml-2 text-muted-foreground">
                ({userPlan.analysesUsed} / {userPlan.analysesLimit} used)
              </span>
            )}
          </Badge>
        )}
      </motion.div>

      {/* Billing cycle toggle */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-lg border bg-card p-1 shadow-sm">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={cn(
              'px-5 py-2 text-sm font-medium rounded-md transition',
              billingCycle === 'monthly'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle('annual')}
            className={cn(
              'px-5 py-2 text-sm font-medium rounded-md transition',
              billingCycle === 'annual'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Annual
            <span className="ml-2 text-emerald-500 font-semibold">Save 20%</span>
          </button>
        </div>
      </div>

      {/* Pricing cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <AnimatePresence mode="popLayout">
          {filteredPackages.map((pkg, idx) => {
            const planKey = getPlanKey(pkg.name)
            const meta = planMeta[planKey] || planMeta.premium
            const Icon = meta.icon
            const isCurrentPlan =
              userPlan?.plan === pkg.name.toLowerCase().replace(/\s+/g, '_')

            return (
              <motion.div
                key={pkg.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card
                  className={cn(
                    'relative h-full overflow-hidden transition-all',
                    pkg.isPopular
                      ? 'ring-2 ring-primary shadow-lg shadow-primary/10'
                      : 'hover:shadow-md hover:border-primary/30'
                  )}
                >
                  {pkg.isPopular && (
                    <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-bl-lg">
                      Most Popular
                    </div>
                  )}

                  <CardHeader className="pb-4">
                    <div
                      className={cn(
                        'inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br text-white mb-2',
                        meta.gradient
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-xl">{pkg.name}</CardTitle>
                    <CardDescription className="min-h-[40px]">
                      {pkg.description}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {/* Price */}
                    <div>
                      <span className="text-3xl font-bold">
                        ${pkg.price.toFixed(2)}
                      </span>
                      <span className="text-sm text-muted-foreground ml-1">
                        / {pkg.duration === 'annual' ? 'year' : 'month'}
                      </span>
                    </div>

                    {/* Analyses + split */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Analyses</span>
                        <span className="font-medium">
                          {pkg.analyses === 0 ? 'Unlimited' : pkg.analyses.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">API split</span>
                        <span className="font-mono">
                          {pkg.splitRatio}% premium / {100 - pkg.splitRatio}% free
                        </span>
                      </div>
                    </div>

                    <Separator />

                    {/* Features */}
                    <ul className="space-y-2 text-sm">
                      {pkg.features.slice(0, 6).map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                          <span className="text-muted-foreground">{f}</span>
                        </li>
                      ))}
                      {pkg.features.length > 6 && (
                        <li className="text-xs text-muted-foreground pl-6">
                          + {pkg.features.length - 6} more
                        </li>
                      )}
                    </ul>
                  </CardContent>

                  <CardFooter className="flex flex-col gap-2">
                    <Button
                      onClick={() => handleSubscribe(pkg.id)}
                      disabled={subscribingTo === pkg.id || isCurrentPlan}
                      className="w-full"
                      variant={pkg.isPopular ? 'default' : 'outline'}
                    >
                      {subscribingTo === pkg.id ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {PAYMENTS_ENABLED ? 'Redirecting...' : 'Recording...'}
                        </>
                      ) : isCurrentPlan ? (
                        'Current Plan'
                      ) : !PAYMENTS_ENABLED ? (
                        'Notify Me'
                      ) : (
                        'Subscribe Now'
                      )}
                    </Button>
                    <p className="text-[10px] text-muted-foreground text-center">
                      {PAYMENTS_ENABLED
                        ? 'Cancel anytime · 7-day money-back'
                        : "Online payments are temporarily off — we'll email you when they're enabled."}
                    </p>
                  </CardFooter>
                </Card>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Trust signals */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground pt-4"
      >
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-emerald-500" />
          Secure payments via Stripe
        </div>
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 text-emerald-500" />
          7-day money-back guarantee
        </div>
        <div className="flex items-center gap-2">
          <X className="h-4 w-4 text-emerald-500" />
          Cancel anytime · No hidden fees
        </div>
      </motion.div>

      {/* Disclaimer */}
      <div className="text-center text-xs text-muted-foreground max-w-2xl mx-auto pt-4 border-t">
        AI analysis is for educational purposes only and does not constitute financial advice.
        Past performance does not guarantee future results. Trading involves substantial risk of loss.
      </div>
    </div>
  )
}

export default PricingPage
