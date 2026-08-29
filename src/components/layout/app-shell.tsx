'use client'

import React from 'react'
import { useTheme } from 'next-themes'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  TrendingUp,
  Camera,
  Eye,
  Bell,
  Calendar,
  Newspaper,
  BarChart3,
  Activity,
  Users,
  GraduationCap,
  LifeBuoy,
  CreditCard,
  Settings,
  Shield,
  Sun,
  Moon,
  LogOut,
  Search,
  ChevronLeft,
  Menu,
  UserCircle,
  Wallet,
  Newspaper as NewspaperIcon,
  Trophy,
  Swords,
  MessageCircle,
  Users as UsersIcon,
  Copy,
  NotebookPen,
  Bot,
  FlaskConical,
  Brain,
  ScanLine,
  Cpu,
  LineChart,
} from 'lucide-react'
import { useStore, type Page } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PoweredBy } from '@/components/branding/powered-by'
import { BrandLogo } from '@/components/branding/brand-logo'
import { AdManager } from '@/components/ads'
import { TickerTape } from '@/components/layout/ticker-tape'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { t, isRTL, locales } from '@/lib/i18n/config'
import { toast } from 'sonner'

interface NavItem {
  id: Page
  labelKey: string
  icon: React.ElementType
  section?: string
}

const navItems: NavItem[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { id: 'signals', labelKey: 'nav.signals', icon: TrendingUp },
  { id: 'screenshot', labelKey: 'nav.screenshot', icon: Camera },
  { id: 'watchlist', labelKey: 'nav.watchlist', icon: Eye },
  { id: 'alerts', labelKey: 'nav.alerts', icon: Bell },
  { id: 'calendar', labelKey: 'nav.calendar', icon: Calendar },
  { id: 'news', labelKey: 'nav.news', icon: Newspaper },
  { id: 'performance', labelKey: 'nav.performance', icon: BarChart3 },
  { id: 'stats', labelKey: 'nav.stats', icon: Activity },
  { id: 'tradingview', labelKey: 'nav.tradingview', icon: LineChart },
  { id: 'social', labelKey: 'nav.social', icon: NewspaperIcon },
  { id: 'leaderboards', labelKey: 'nav.leaderboards', icon: Trophy },
  { id: 'competitions', labelKey: 'nav.competitions', icon: Swords },
  { id: 'messages', labelKey: 'nav.messages', icon: MessageCircle },
  { id: 'groups', labelKey: 'nav.groups', icon: UsersIcon },
  { id: 'copy-trading', labelKey: 'nav.copy-trading', icon: Copy },
  { id: 'paper-trading', labelKey: 'nav.paper-trading', icon: NotebookPen },
  { id: 'trading-bot', labelKey: 'nav.trading-bot', icon: Bot },
  { id: 'backtesting', labelKey: 'nav.backtesting', icon: FlaskConical },
  { id: 'ai-predictions', labelKey: 'nav.ai-predictions', icon: Brain },
  { id: 'patterns', labelKey: 'nav.patterns', icon: ScanLine },
  { id: 'strategy-builder', labelKey: 'nav.strategy-builder', icon: Cpu },
  { id: 'community', labelKey: 'nav.community', icon: Users },
  { id: 'education', labelKey: 'nav.education', icon: GraduationCap },
  { id: 'pricing', labelKey: 'nav.pricing', icon: CreditCard },
  { id: 'pricing-dashboard', labelKey: 'nav.pricing-dashboard', icon: Wallet },
  { id: 'support', labelKey: 'nav.support', icon: LifeBuoy },
  { id: 'subscriptions', labelKey: 'nav.subscriptions', icon: CreditCard },
  { id: 'profile', labelKey: 'nav.profile', icon: UserCircle },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
]

const adminItems: NavItem[] = [
  { id: 'admin', labelKey: 'nav.admin', icon: Shield, section: 'admin' },
  { id: 'monetization', labelKey: 'nav.monetization', icon: Wallet, section: 'admin' },
]

function NavItemButton({
  item,
  label,
  isActive,
  collapsed,
  onClick,
}: {
  item: NavItem
  label: string
  isActive: boolean
  collapsed: boolean
  onClick: () => void
}) {
  const Icon = item.icon

  const button = (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
        isActive
          ? 'bg-primary/10 text-primary shadow-sm'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        collapsed && 'justify-center px-2'
      )}
    >
      <Icon className={cn('shrink-0', collapsed ? 'size-5' : 'size-4')} />
      {!collapsed && (
        <span className="truncate">{label}</span>
      )}
      {isActive && !collapsed && (
        <motion.div
          layoutId="activeIndicator"
          className="ml-auto h-1.5 w-1.5 rounded-full bg-primary"
        />
      )}
    </button>
  )

  if (collapsed) {
    return (
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return button
}

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { currentPage, setPage, user, logout, toggleSidebarCollapsed, locale } = useStore()
  const { theme, setTheme } = useTheme()
  const isAdmin = user?.role === 'admin'

  const handleNavigate = (page: Page) => {
    setPage(page)
    onNavigate?.()
  }

  const handleLogout = () => {
    logout()
    toast.success(t('common.loggedOut', locale))
  }

  const handleThemeToggle = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const subscriptionBadge = user?.subscriptionTier === 'pro'
    ? 'Pro'
    : user?.subscriptionTier === 'premium'
    ? 'Premium'
    : 'Free'

  const subscriptionColor = user?.subscriptionTier === 'pro'
    ? 'bg-primary text-primary-foreground'
    : user?.subscriptionTier === 'premium'
    ? 'bg-yellow-500 text-yellow-950'
    : 'bg-secondary text-secondary-foreground'

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn('flex items-center border-b border-border px-4 py-4', collapsed && 'justify-center px-2')}>
        <div className="flex items-center gap-3">
          <BrandLogo className="size-9" />
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="overflow-hidden"
            >
              <h1 className="text-sm font-bold whitespace-nowrap tracking-tight">TOP<span className="text-primary">TIER</span></h1>
            </motion.div>
          )}
        </div>
        {!collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto hidden lg:flex size-7"
            onClick={toggleSidebarCollapsed}
          >
            <ChevronLeft className="size-4" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-3">
        <div className="space-y-1">
          {/* Core */}
          {!collapsed && (
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('section.trading', locale)}</p>
          )}
          {navItems.slice(0, 8).map((item) => (
            <NavItemButton
              key={item.id}
              item={item}
              label={t(item.labelKey, locale)}
              isActive={currentPage === item.id}
              collapsed={collapsed}
              onClick={() => handleNavigate(item.id)}
            />
          ))}

          <Separator className="my-3" />

          {/* Social */}
          {!collapsed && (
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('section.social', locale)}</p>
          )}
          {navItems.slice(8, 14).map((item) => (
            <NavItemButton
              key={item.id}
              item={item}
              label={t(item.labelKey, locale)}
              isActive={currentPage === item.id}
              collapsed={collapsed}
              onClick={() => handleNavigate(item.id)}
            />
          ))}

          <Separator className="my-3" />

          {/* AI & Advanced */}
          {!collapsed && (
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('section.ai', locale)}</p>
          )}
          {navItems.slice(14, 20).map((item) => (
            <NavItemButton
              key={item.id}
              item={item}
              label={t(item.labelKey, locale)}
              isActive={currentPage === item.id}
              collapsed={collapsed}
              onClick={() => handleNavigate(item.id)}
            />
          ))}

          <Separator className="my-3" />

          {/* Account */}
          {!collapsed && (
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('section.account', locale)}</p>
          )}
          {navItems.slice(20).map((item) => (
            <NavItemButton
              key={item.id}
              item={item}
              label={t(item.labelKey, locale)}
              isActive={currentPage === item.id}
              collapsed={collapsed}
              onClick={() => handleNavigate(item.id)}
            />
          ))}

          {/* Admin Section */}
          {isAdmin && (
            <>
              <Separator className="my-3" />
              {!collapsed && (
                <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('section.admin', locale)}
                </p>
              )}
              {adminItems.map((item) => (
                <NavItemButton
                  key={item.id}
                  item={item}
                  label={t(item.labelKey, locale)}
                  isActive={currentPage === item.id}
                  collapsed={collapsed}
                  onClick={() => handleNavigate(item.id)}
                />
              ))}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Bottom Section */}
      <div className="border-t border-border p-3">
        {/* Legal Links */}
        {!collapsed && (
          <div className="flex items-center gap-3 px-1 mb-2">
            <button onClick={() => handleNavigate('privacy')} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">{t('common.privacy', locale)}</button>
            <span className="text-[11px] text-muted-foreground">·</span>
            <button onClick={() => handleNavigate('terms')} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">{t('common.terms', locale)}</button>
          </div>
        )}

        {/* Theme Toggle */}
        <div className={cn('flex items-center mb-2', collapsed ? 'justify-center' : 'justify-between px-1')}>
          {!collapsed && (
            <span className="text-xs text-muted-foreground">{t('common.theme', locale)}</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={handleThemeToggle}
          >
            {theme === 'dark' ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </Button>
        </div>

        <Separator className="mb-2" />

        {/* User Info */}
        <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
          <button
            onClick={() => handleNavigate('profile')}
            className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
            aria-label="Open profile"
          >
            <Avatar className="size-8 shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {user?.name?.charAt(0)?.toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.name || t('common.user', locale)}</p>
                <Badge className={cn('text-[10px] px-1.5 py-0', subscriptionColor)}>
                  {subscriptionBadge}
                </Badge>
              </div>
            )}
          </button>
          {!collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="size-4" />
            </Button>
          )}
        </div>

        {/* Powered by BAGMUL */}
        <div className={cn('mt-3 pt-2 border-t border-border/50', collapsed && 'flex justify-center')}>
          {collapsed ? (
            <span className="text-[9px] font-bold tracking-wider text-muted-foreground/70">BAGMUL</span>
          ) : (
            <PoweredBy />
          )}
        </div>
      </div>
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { currentPage, sidebarOpen, setSidebarOpen, sidebarCollapsed, toggleSidebarCollapsed, notificationCount, setPage, locale } = useStore()
  const isMobile = useIsMobile()

  // Apply document language + direction (RTL for Arabic) to match the locale.
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = locales[locale]?.code || 'en'
    document.documentElement.dir = isRTL(locale) ? 'rtl' : 'ltr'
  }, [locale])

  const collapsed = !isMobile && sidebarCollapsed

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      {!isMobile && (
        <motion.aside
          initial={false}
          animate={{ width: collapsed ? 72 : 280 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="hidden lg:flex flex-col border-r border-border bg-card shrink-0 overflow-hidden"
        >
          <SidebarContent collapsed={collapsed} />
        </motion.aside>
      )}

      {/* Mobile Sidebar (Sheet) */}
      {isMobile && (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-[280px] p-0 bg-card">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation Menu</SheetTitle>
            </SheetHeader>
            <SidebarContent collapsed={false} onNavigate={() => setSidebarOpen(false)} />
          </SheetContent>
        </Sheet>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card px-4 lg:px-6">
          {/* Mobile menu toggle */}
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
          )}

          {/* Expand sidebar on desktop when collapsed */}
          {!isMobile && collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:flex"
              onClick={toggleSidebarCollapsed}
            >
              <Menu className="size-5" />
            </Button>
          )}

          {/* Page Title */}
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{t(`page.${currentPage}`, locale)}</h2>
          </div>

          {/* Search Bar */}
          <div className="ml-4 hidden md:flex flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t('common.searchPlaceholder', locale)}
                className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-4 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none transition-all"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const q = (e.target as HTMLInputElement).value.trim().toLowerCase()
                    if (!q) return
                    const searchPages: Record<string, Page> = {
                      signal: 'signals',
                      signals: 'signals',
                      watch: 'watchlist',
                      watchlist: 'watchlist',
                      alert: 'alerts',
                      alerts: 'alerts',
                      calendar: 'calendar',
                      news: 'news',
                      chart: 'screenshot',
                      screenshot: 'screenshot',
                      analysis: 'screenshot',
                      performance: 'performance',
                      stats: 'stats',
                      settings: 'settings',
                      setting: 'settings',
                      profile: 'profile',
                      community: 'community',
                      education: 'education',
                      pricing: 'pricing',
                      support: 'support',
                      bot: 'trading-bot',
                      trading: 'trading-bot',
                      paper: 'paper-trading',
                      backtest: 'backtesting',
                      predict: 'ai-predictions',
                      strategy: 'strategy-builder',
                    }
                    for (const [keyword, page] of Object.entries(searchPages)) {
                      if (q.includes(keyword)) {
                        setPage(page)
                        ;(e.target as HTMLInputElement).value = ''
                        return
                      }
                    }
                    setPage('signals')
                    ;(e.target as HTMLInputElement).value = ''
                  }
                }}
              />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Quick Action: Analyze Screenshot */}
            <Button
              size="sm"
              className="hidden sm:flex gap-2"
              onClick={() => setPage('screenshot')}
            >
              <Camera className="size-4" />
              {t('common.analyzeScreenshot', locale)}
            </Button>

            {/* Notification Bell */}
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={() => setPage('alerts')}
            >
              <Bell className="size-4" />
              {notificationCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                  {notificationCount > 9 ? '9+' : notificationCount}
                </span>
              )}
            </Button>
          </div>
        </header>

        {/* Ticker Tape */}
        <TickerTape />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="h-full"
            >
              {/* 
                Bottom padding: reserves space so the FloatingSupportWidget FAB
                (fixed bottom-right) never overlaps actionable content like
                "Create Ticket" buttons or footer CTAs. pb-24 on mobile gives
                the FAB breathing room; pb-6 on desktop is enough since the FAB
                is smaller and content is wider.
              */}
              <div className="h-full pb-24 lg:pb-6">
                <AdManager showNative={false}>{children}</AdManager>
              </div>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
