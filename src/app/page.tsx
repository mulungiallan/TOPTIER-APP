'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap,
  TrendingUp,
  Camera,
  BarChart3,
  Shield,
  ArrowRight,
  Medal,
  Trophy,
  Crown,
  ChevronRight,
  X,
} from 'lucide-react'
import { useStore, type Page } from '@/lib/store'
import { useBackButton } from '@/hooks/use-back-button'
import { useLiveMarket } from '@/hooks/use-live-market'
import { useTokenRefresh } from '@/hooks/use-token-refresh'
import dynamic from 'next/dynamic'
import { AppShell } from '@/components/layout/app-shell'
import { LoginForm } from '@/components/auth/login-form'
import { RegisterForm } from '@/components/auth/register-form'
import { OnboardingWizard } from '@/components/auth/onboarding'
import { FloatingSupportWidget } from '@/components/support/floating-support-widget'
import { PoweredBy } from '@/components/branding/powered-by'
import { BrandLogo } from '@/components/branding/brand-logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { initUsageTracking, trackEvent } from '@/lib/tracking'

const ScreenshotAnalyzer = dynamic(() => import('@/components/pages/screenshot-analyzer').then(m => m.ScreenshotAnalyzer), { ssr: false })
const ChatAnalyserPage = dynamic(() => import('@/components/pages/chat-analyser').then(m => m.ChatAnalyserPage), { ssr: false })
const WatchlistPage = dynamic(() => import('@/components/pages/watchlist').then(m => m.WatchlistPage), { ssr: false })
const DashboardPage = dynamic(() => import('@/components/pages/dashboard').then(m => m.DashboardPage), { ssr: false })
const SignalsPage = dynamic(() => import('@/components/pages/signals').then(m => m.SignalsPage), { ssr: false })
const PerformancePage = dynamic(() => import('@/components/pages/performance').then(m => m.PerformancePage), { ssr: false })
const SubscriptionsPage = dynamic(() => import('@/components/pages/subscriptions').then(m => m.SubscriptionsPage), { ssr: false })
const PricingPage = dynamic(() => import('@/components/pages/pricing').then(m => m.PricingPage), { ssr: false })
const PricingDashboardPage = dynamic(() => import('@/components/pages/pricing-dashboard').then(m => m.PricingDashboardPage), { ssr: false })
const SocialFeedPage = dynamic(() => import('@/components/pages/social-feed').then(m => m.SocialFeedPage), { ssr: false })
const LeaderboardsPage = dynamic(() => import('@/components/pages/leaderboards').then(m => m.LeaderboardsPage), { ssr: false })
const CompetitionsPage = dynamic(() => import('@/components/pages/competitions').then(m => m.CompetitionsPage), { ssr: false })
const MessagesPage = dynamic(() => import('@/components/pages/messages').then(m => m.MessagesPage), { ssr: false })
const GroupsPage = dynamic(() => import('@/components/pages/groups').then(m => m.GroupsPage), { ssr: false })
const CopyTradingPage = dynamic(() => import('@/components/pages/copy-trading').then(m => m.CopyTradingPage), { ssr: false })
const PaperTradingPage = dynamic(() => import('@/components/pages/paper-trading').then(m => m.PaperTradingPage), { ssr: false })
const TradingBotPage = dynamic(() => import('@/components/pages/trading-bot').then(m => m.TradingBotPage), { ssr: false })
const BacktestingPage = dynamic(() => import('@/components/pages/backtesting').then(m => m.BacktestingPage), { ssr: false })
const AIPredictionsPage = dynamic(() => import('@/components/pages/ai-predictions').then(m => m.AIPredictionsPage), { ssr: false })
const PatternRecognitionPage = dynamic(() => import('@/components/pages/pattern-recognition').then(m => m.PatternRecognitionPage), { ssr: false })
const StrategyBuilderPage = dynamic(() => import('@/components/pages/strategy-builder').then(m => m.StrategyBuilderPage), { ssr: false })
const TradingViewPage = dynamic(() => import('@/components/pages/tradingview-charts').then(m => m.TradingViewPage), { ssr: false })
const SettingsPage = dynamic(() => import('@/components/pages/settings').then(m => m.SettingsPage), { ssr: false })
const AlertsPage = dynamic(() => import('@/components/pages/alerts').then(m => m.AlertsPage), { ssr: false })
const CalendarPage = dynamic(() => import('@/components/pages/calendar').then(m => m.CalendarPage), { ssr: false })
const NewsPage = dynamic(() => import('@/components/pages/news').then(m => m.NewsPage), { ssr: false })
const CommunityPage = dynamic(() => import('@/components/pages/community'), { ssr: false })
const EducationPage = dynamic(() => import('@/components/pages/education'), { ssr: false })
const SupportPage = dynamic(() => import('@/components/pages/support'), { ssr: false })
const AdminPage = dynamic(() => import('@/components/pages/admin'), { ssr: false })
const PrivacyPolicyPage = dynamic(() => import('@/components/pages/legal').then(m => m.PrivacyPolicyPage), { ssr: false })
const TermsOfServicePage = dynamic(() => import('@/components/pages/legal').then(m => m.TermsOfServicePage), { ssr: false })
const UgcPolicyPage = dynamic(() => import('@/components/pages/legal').then(m => m.UgcPolicyPage), { ssr: false })
const ProfilePage = dynamic(() => import('@/components/pages/profile').then(m => m.ProfilePage), { ssr: false })
const StatsPage = dynamic(() => import('@/components/pages/stats').then(m => m.StatsPage), { ssr: false })
const MonetizationPage = dynamic(() => import('@/components/pages/monetization').then(m => m.MonetizationPage), { ssr: false })

const pageComponents: Record<Page, React.ReactNode> = {
  dashboard: <DashboardPage />,
  signals: <SignalsPage />,
  screenshot: <ScreenshotAnalyzer />,
  'chat-analyser': <ChatAnalyserPage />,
  watchlist: <WatchlistPage />,
  alerts: <AlertsPage />,
  calendar: <CalendarPage />,
  news: <NewsPage />,
  performance: <PerformancePage />,
  subscriptions: <SubscriptionsPage />,
  pricing: <PricingPage />,
  'pricing-dashboard': <PricingDashboardPage />,
  stats: <StatsPage />,
  monetization: <MonetizationPage />,
  social: <SocialFeedPage />,
  leaderboards: <LeaderboardsPage />,
  competitions: <CompetitionsPage />,
  messages: <MessagesPage />,
  groups: <GroupsPage />,
  'copy-trading': <CopyTradingPage />,
  'paper-trading': <PaperTradingPage />,
  'trading-bot': <TradingBotPage />,
  backtesting: <BacktestingPage />,
  'ai-predictions': <AIPredictionsPage />,
  patterns: <PatternRecognitionPage />,
  'strategy-builder': <StrategyBuilderPage />,
  tradingview: <TradingViewPage />,
  settings: <SettingsPage />,
  community: <CommunityPage />,
  education: <EducationPage />,
  support: <SupportPage />,
  admin: <AdminPage />,
  onboarding: <OnboardingWizard />,
  login: <LoginForm onSwitchToRegister={() => {}} />,
  register: <RegisterForm onSwitchToLogin={() => {}} />,
  privacy: <PrivacyPolicyPage />,
  terms: <TermsOfServicePage />,
  ugc: <UgcPolicyPage />,
  profile: <ProfilePage />,
}

// ─── Landing Page ──────────────────────────────────────────────────────────────

const TICKER = [
  { sym: 'EURUSD', price: '1.0842', change: '+0.12%', up: true },
  { sym: 'GBPUSD', price: '1.2671', change: '-0.08%', up: false },
  { sym: 'BTCUSD', price: '104,232', change: '+2.41%', up: true },
  { sym: 'ETHUSD', price: '3,892', change: '+1.73%', up: true },
  { sym: 'XAUUSD', price: '2,418.50', change: '+0.34%', up: true },
  { sym: 'USOIL', price: '78.42', change: '-1.12%', up: false },
  { sym: 'SPX500', price: '5,481.2', change: '+0.29%', up: true },
  { sym: 'NAS100', price: '19,778', change: '+0.55%', up: true },
  { sym: 'USDJPY', price: '157.84', change: '+0.09%', up: true },
  { sym: 'AUDUSD', price: '0.6619', change: '-0.04%', up: false },
]

function LiveTicker() {
  const { prices, loading } = useLiveMarket({ overview: true, refreshMs: 30_000 })
  const items = prices.length > 0
    ? prices.map(p => ({
        sym: p.symbol.replace('/USD', 'USD').replace('BINANCE:', ''),
        price: p.price > 1000 ? p.price.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p.price.toFixed(p.price < 1 ? 4 : 2),
        change: `${p.changePercent >= 0 ? '+' : ''}${p.changePercent.toFixed(2)}%`,
        up: p.changePercent >= 0,
      }))
    : TICKER

  if (loading && prices.length === 0) {
    return (
      <div className="border-b border-border bg-white/70 dark:bg-[#0f2a4a]/60 backdrop-blur-sm overflow-hidden">
        <div className="flex whitespace-nowrap animate-[ticker_40s_linear_infinite] py-2">
          {TICKER.map((t, i) => (
            <span key={`${t.sym}-${i}`} className="inline-flex items-center gap-2 px-5 text-xs font-mono">
              <span className="font-semibold text-foreground">{t.sym}</span>
              <span className="text-muted-foreground">{t.price}</span>
              <span className={t.up ? 'text-profit' : 'text-loss'}>{t.change}</span>
            </span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="border-b border-border bg-white/70 dark:bg-[#0f2a4a]/60 backdrop-blur-sm overflow-hidden">
      <div className="flex whitespace-nowrap animate-[ticker_40s_linear_infinite] py-2">
        {[...items, ...items].map((t, i) => (
          <span key={`${t.sym}-${i}`} className="inline-flex items-center gap-2 px-5 text-xs font-mono">
            <span className="font-semibold text-foreground">{t.sym}</span>
            <span className="text-muted-foreground">{t.price}</span>
            <span className={t.up ? 'text-profit' : 'text-loss'}>{t.change}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

const TIERS = [
  {
    icon: Medal,
    name: 'Bronze',
    sub: 'Top up with small goals',
    daily: '5 signals',
    monthly: '120 signals',
    perks: ['Standard signal scoring', 'Community leaderboard', 'Weekly rank reset'],
    highlight: false,
  },
  {
    icon: Trophy,
    name: 'Silver',
    sub: 'Consistency earns more',
    daily: '10 signals',
    monthly: '250 signals',
    perks: ['Priority signal delivery', 'Bronze perks included', 'Monthly cashback offer'],
    highlight: false,
  },
  {
    icon: Crown,
    name: 'Gold',
    sub: 'Serious traders, serious limits',
    daily: '25 signals',
    monthly: '600 signals',
    perks: ['Advanced analytics suite', 'Silver perks included', 'Dedicated rank support'],
    highlight: true,
  },
  {
    icon: Crown,
    name: 'Top Tier',
    sub: 'VIP service, highest limits',
    daily: 'Unlimited',
    monthly: 'Unlimited',
    perks: ['Personal trading analyst', 'Gold perks included', 'Exclusive VIP community'],
    highlight: true,
  },
]

function LandingPage() {
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)

  const features = [
    {
      icon: TrendingUp,
      title: 'AI Trading Signals',
      description: 'Every signal is scored by confidence. Enter with clear stop-loss and take-profit levels.',
    },
    {
      icon: Camera,
      title: 'Screenshot Analysis',
      description: 'Upload any chart screenshot and receive instant AI-powered pattern recognition.',
    },
    {
      icon: BarChart3,
      title: 'Rank & Track',
      description: 'Every trader has a rank. Monitor your win rate, profit factor, and live leaderboard position.',
    },
    {
      icon: Shield,
      title: 'Risk Management',
      description: 'Built-in position sizing and risk tools keep you disciplined through every market move.',
    },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ─── Ticker strip ─────────────────────────────────────────────── */}
      <LiveTicker />

      {/* ─── Nav ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandLogo className="size-9 shrink-0" />
            <span className="font-display text-base sm:text-lg font-bold tracking-tight">
              TOP<span className="text-[#1b4f9c]">TIER</span>
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-muted-foreground">
            <button onClick={() => setAuthMode('register')} className="hover:text-foreground transition-colors">Signals</button>
            <button onClick={() => setAuthMode('register')} className="hover:text-foreground transition-colors">Analyzer</button>
            <button onClick={() => setAuthMode('register')} className="hover:text-foreground transition-colors">Community</button>
            <button onClick={() => setAuthMode('register')} className="hover:text-foreground transition-colors">Pricing</button>
          </nav>
          <div className="flex shrink-0 items-center gap-2.5">
            <Button
              variant="ghost"
              size="sm"
              className="px-2.5 sm:px-3"
              onClick={() => setAuthMode('login')}
            >
              Sign In
            </Button>
            <Button
              size="sm"
              className="bg-[#1b4f9c] hover:bg-[#16385e] text-white px-3 sm:px-4"
              onClick={() => setAuthMode('register')}
            >
              Get Started
            </Button>
          </div>
        </div>
      </header>

      <div className="relative">
        {/* Background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-32 size-[560px] rounded-full bg-[#1b4f9c]/8 blur-3xl" />
          <div className="absolute top-1/3 -left-40 size-[420px] rounded-full bg-[#1b4f9c]/6 blur-3xl" />
        </div>

        {/* ─── Hero ───────────────────────────────────────────────────── */}
        <section className="relative mx-auto max-w-7xl px-5 pt-6 pb-10 sm:px-6 lg:pt-10">
          <div className="grid items-center gap-8 sm:gap-12 lg:grid-cols-[1.1fr_1fr]">
            {/* Left — copy */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="min-w-0"
            >
              <Badge className="mb-5 bg-[#e8eff9] dark:bg-[#1b4f9c]/15 text-[#1b4f9c] border-[#1b4f9c]/20 hover:bg-[#e8eff9] dark:hover:bg-[#1b4f9c]/20 font-medium">
                <Zap className="size-3 mr-1" />
                AI-Powered Trading Platform
              </Badge>
              <h1 className="font-display text-[clamp(1.8rem,7vw,3.75rem)] font-bold leading-[1.08] tracking-tight break-words">
                Every signal is <span className="text-[#1b4f9c]">scored.</span>
                <br />
                Every trader has a <span className="text-[#1b4f9c]">rank.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base sm:text-lg text-muted-foreground leading-relaxed">
                TOPTIER scores every signal by confidence and ranks every trader on
                live proof — win rate, profit factor, and drawdown. No deleted
                losers. No fake results.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Button
                  size="lg"
                  className="gap-2 bg-[#1b4f9c] hover:bg-[#16385e] text-white w-full sm:w-auto"
                  onClick={() => setAuthMode('register')}
                >
                  Get Signals
                  <ArrowRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={() => setAuthMode('login')}
                >
                  View Live Rank
                </Button>
              </div>

              {/* Proof stats — fetched from /api/health or shown as placeholder */}
              <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-y-6 gap-x-10">
                {[
                  { value: 'AI-Powered', label: 'confidence scoring' },
                  { value: 'Transparent', label: 'no deleted results' },
                  { value: 'Live', label: 'proof-of-performance' },
                ].map((stat) => (
                  <div key={stat.label} className="min-w-0">
                    <p className="font-mono text-2xl sm:text-3xl font-bold text-foreground break-words">{stat.value}</p>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Right — tier ladder / auth */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="w-full"
            >
              <AnimatePresence mode="wait">
                {authMode ? (
                  <motion.div
                    key="auth"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.25 }}
                    className="relative"
                  >
                    <button
                      onClick={() => setAuthMode(null)}
                      aria-label="Close sign-in dialog"
                      className="absolute -top-3 -right-3 z-10 flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                    {authMode === 'login' ? (
                      <LoginForm
                        key="login"
                        onSwitchToRegister={() => setAuthMode('register')}
                      />
                    ) : (
                      <RegisterForm
                        key="register"
                        onSwitchToLogin={() => setAuthMode('login')}
                      />
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="ladder"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.25 }}
                    className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_40px_-12px_rgba(15,42,74,0.15)]"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-display text-lg font-bold">Rank Ladder</h3>
                      <span className="text-xs text-muted-foreground">Daily / Monthly signal limits</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-5">
                      Climb the ranks by proving your edge. Higher rank unlocks higher limits.
                    </p>
                    <div className="space-y-2.5">
                      {TIERS.map((tier) => (
                        <button
                          key={tier.name}
                          onClick={() => setAuthMode('register')}
                          className={`group flex w-full items-center gap-3.5 rounded-xl border p-3.5 text-left transition-all ${
                            tier.highlight
                              ? 'border-[#1b4f9c]/30 bg-[#e8eff9]/70 dark:bg-[#1b4f9c]/10 hover:bg-[#e8eff9] dark:hover:bg-[#1b4f9c]/15'
                              : 'border-border bg-white dark:bg-card hover:border-[#1b4f9c]/30'
                          }`}
                        >
                          <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
                            tier.name === 'Top Tier'
                              ? 'bg-[#1b4f9c] text-white'
                              : tier.highlight
                                ? 'bg-[#1b4f9c]/10 text-[#1b4f9c]'
                                : 'bg-secondary text-muted-foreground'
                          }`}>
                            <tier.icon className="size-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-display font-semibold text-sm">{tier.name}</span>
                              <span className="truncate text-xs text-muted-foreground">{tier.sub}</span>
                            </div>
                            <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                              {tier.daily} daily · {tier.monthly} monthly
                            </div>
                          </div>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-[#1b4f9c] transition-colors" />
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </section>

        {/* ─── Features ───────────────────────────────────────────────── */}
        <section className="mx-auto max-w-7xl px-5 sm:px-6 pb-20">
          <div className="text-center mb-12">
            <h2 className="font-display text-3xl font-bold tracking-tight">
              Everything You Need to Trade Smarter
            </h2>
            <p className="mt-2 text-muted-foreground max-w-2xl mx-auto">
              AI analysis, live data, and transparent rankings — combined into one professional workspace.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
              >
                <Card className="h-full border-border bg-card hover:border-[#1b4f9c]/30 transition-colors">
                  <CardContent className="p-6">
                    <div className="flex size-11 items-center justify-center rounded-lg bg-[#1b4f9c]/10 mb-4">
                      <feature.icon className="size-5 text-[#1b4f9c]" />
                    </div>
                    <h3 className="font-display font-semibold mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ─── Tier ladder section ────────────────────────────────────── */}
        <section className="mx-auto max-w-7xl px-5 sm:px-6 pb-20">
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 lg:p-12">
            <div className="text-center mb-10">
              <h2 className="font-display text-3xl font-bold tracking-tight">Choose Your Tier</h2>
              <p className="mt-2 text-muted-foreground max-w-xl mx-auto">
                Every tier is transparent about limits and rewards. Start small, prove your edge, climb the ladder.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {TIERS.map((tier, i) => (
                <motion.div
                  key={tier.name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.5 }}
                  className={`rounded-xl border p-6 ${
                    tier.highlight
                      ? 'border-[#1b4f9c]/40 bg-[#e8eff9]/60 dark:bg-[#1b4f9c]/10'
                      : 'border-border bg-white dark:bg-card'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`flex size-10 items-center justify-center rounded-lg ${
                      tier.name === 'Top Tier'
                        ? 'bg-[#1b4f9c] text-white'
                        : tier.highlight
                          ? 'bg-[#1b4f9c]/10 text-[#1b4f9c]'
                          : 'bg-secondary text-muted-foreground'
                    }`}>
                      <tier.icon className="size-5" />
                    </div>
                    <div>
                      <h3 className="font-display font-bold">{tier.name}</h3>
                      <p className="text-xs text-muted-foreground">{tier.sub}</p>
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2 mb-5">
                    <span className="font-mono text-2xl font-bold text-[#1b4f9c]">{tier.daily}</span>
                    <span className="text-xs text-muted-foreground">signal limit/day</span>
                  </div>
                  <ul className="space-y-2 mb-6">
                    {tier.perks.map((perk) => (
                      <li key={perk} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="mt-0.5 text-[#1b4f9c]">✓</span>
                        {perk}
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant={tier.highlight ? 'default' : 'outline'}
                    className={tier.highlight ? 'w-full bg-[#1b4f9c] hover:bg-[#16385e] text-white' : 'w-full'}
                    onClick={() => setAuthMode('register')}
                  >
                    Get {tier.name}
                  </Button>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Footer ─────────────────────────────────────────────────── */}
        <footer className="border-t border-border">
          <div className="mx-auto max-w-7xl px-5 sm:px-6 py-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-[#1b4f9c]" />
                <span className="font-display text-sm font-bold">TOPTIER</span>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => { useStore.getState().setPage('privacy') }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Privacy Policy</button>
                <button onClick={() => { useStore.getState().setPage('terms') }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Terms of Service</button>
                <button onClick={() => { useStore.getState().setPage('ugc') }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Community Content Policy</button>
              </div>
              <p className="text-xs text-muted-foreground">
                Trading involves substantial risk. Past performance is not indicative of future results.
              </p>
            </div>
            <div className="mt-5 pt-4 border-t border-border/60 flex flex-col sm:flex-row items-center justify-center gap-2">
              <PoweredBy />
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function Home() {
  const isAuthenticated = useStore((s) => s.isAuthenticated)
  const user = useStore((s) => s.user)
  const currentPage = useStore((s) => s.currentPage)
  const setPage = useStore((s) => s.setPage)
  const onboardingComplete = user?.onboardingCompleted ?? false

  useBackButton()
  useTokenRefresh()

  // Public pages that can be viewed without authentication
  const isPublicPage = currentPage === 'privacy' || currentPage === 'terms' || currentPage === 'ugc'

  // Usage tracking: start the session tracker once, then log every page view
  React.useEffect(() => {
    initUsageTracking()
  }, [])

  React.useEffect(() => {
    if (typeof window === 'undefined' || !isAuthenticated) return
    trackEvent(currentPage, 'view')
  }, [currentPage, isAuthenticated])

  // Parse ?page= shortcut for PWA deep-links (manifest shortcuts)
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const pageParam = params.get('page')
    if (pageParam && isAuthenticated) {
      // Validate the page param against known Page IDs (light validation)
      const valid: string[] = ['dashboard', 'signals', 'screenshot', 'chat-analyser', 'watchlist', 'alerts', 'calendar', 'news', 'performance', 'subscriptions', 'pricing', 'pricing-dashboard', 'social', 'leaderboards', 'competitions', 'messages', 'groups', 'copy-trading', 'paper-trading', 'trading-bot', 'backtesting', 'ai-predictions', 'patterns', 'strategy-builder', 'tradingview', 'settings', 'community', 'education', 'support', 'profile', 'stats', 'monetization']
      if (valid.includes(pageParam) && pageParam !== currentPage) {
        setPage(pageParam as any)
      }
      // Clean the URL
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [isAuthenticated, currentPage, setPage])

  // Not authenticated → Landing page with login/register (unless viewing public pages)
  if (!isAuthenticated) {
    if (isPublicPage) {
      return (
        <AppShell>
          {pageComponents[currentPage]}
        </AppShell>
      )
    }
    return <LandingPage />
  }

  // Authenticated but onboarding not complete → Onboarding wizard
  if (!onboardingComplete) {
    return <OnboardingWizard />
  }

  // Authenticated and onboarded → App Shell with page content
  // Hide the floating support widget on the Support page itself — the page
  // already has full support content, so showing the FAB there just overlaps
  // the page's own buttons (e.g. "Create Ticket") and creates confusion.
  const showFloatingSupport = currentPage !== 'support'

  return (
    <>
      <AppShell>
        {pageComponents[currentPage] || <DashboardPage />}
      </AppShell>
      {showFloatingSupport && <FloatingSupportWidget />}
    </>
  )
}
