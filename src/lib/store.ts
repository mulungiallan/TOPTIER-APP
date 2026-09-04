import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { detectUserLocale } from '@/lib/i18n/config'

export type Page =
  | 'dashboard'
  | 'signals'
  | 'screenshot'
  | 'chat-analyser'
  | 'watchlist'
  | 'alerts'
  | 'calendar'
  | 'news'
  | 'performance'
  | 'subscriptions'
  | 'pricing'
  | 'pricing-dashboard'
  | 'social'
  | 'leaderboards'
  | 'competitions'
  | 'messages'
  | 'groups'
  | 'copy-trading'
  | 'paper-trading'
  | 'trading-bot'
  | 'backtesting'
  | 'ai-predictions'
  | 'patterns'
  | 'strategy-builder'
  | 'tradingview'
  | 'stats'
  | 'settings'
  | 'community'
  | 'education'
  | 'support'
  | 'admin'
  | 'onboarding'
  | 'login'
  | 'privacy'
  | 'terms'
  | 'ugc'
  | 'register'
  | 'profile'
  | 'monetization'

export interface User {
  id: string
  email: string
  name: string | null
  role: string
  subscriptionTier: string
  plan?: string
  referralCode: string
  onboardingCompleted: boolean
  onboardingStep: number
  darkMode: boolean
  tradingStyle?: string | null
  riskLevel?: string | null
  preferredMarkets?: string | null
  preferredSessions?: string | null
  phone?: string | null
  profilePicture?: string | null
  dateOfBirth?: string | null
  country?: string | null
  language?: string | null
  isEmailVerified?: boolean
  twoFactorEnabled?: boolean
  bio?: string | null
  // Login / session limits
  maxConcurrentSessions?: number
  activeSessionCount?: number
  // Privacy settings (persisted client-side via settings API)
  privacy?: UserPrivacySettings
  // Referrals
  referralCount?: number
  earnedPremiumDays?: number
}

export interface UserPrivacySettings {
  profileVisibility: 'public' | 'community' | 'private'
  showOnlineStatus: boolean
  shareTradingHistory: boolean
  appearOnLeaderboards: boolean
  dataRetentionDays: number
  personalizedAds: boolean
  thirdPartyDataSharing: boolean
  require2FAForSensitiveActions: boolean
  analyticsOptOut: boolean
  cookieConsent: boolean
}

interface SignalFilters {
  marketType: string
  strategy: string
  timeframe: string
  minConfidence: number
}

interface AppState {
  // Auth
  isAuthenticated: boolean
  user: User | null
  authToken: string | null

  // Locale
  locale: string

  // Navigation
  currentPage: Page
  navHistory: Page[]
  sidebarOpen: boolean
  sidebarCollapsed: boolean

  // Notifications
  notificationCount: number

  // Signal Filters
  signalFilters: SignalFilters

  // Actions
  login: (user: User, token: string) => void
  logout: () => void
  setPage: (page: Page) => void
  goBack: () => void
  setIsAuthenticated: (value: boolean) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  toggleSidebarCollapsed: () => void
  setNotificationCount: (count: number) => void
  updateUser: (data: Partial<User>) => void
  setSignalFilters: (filters: Partial<SignalFilters>) => void
  setLocale: (locale: string) => void
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      // Auth
      isAuthenticated: false,
      user: null,
      authToken: null,

      // Locale
      locale: detectUserLocale(),

      // Navigation
      currentPage: 'dashboard',
      navHistory: [],
      sidebarOpen: false,
      sidebarCollapsed: false,

      // Notifications (real count is fetched from the server on load)
      notificationCount: 0,

      // Signal Filters
      signalFilters: {
        marketType: '',
        strategy: '',
        timeframe: '',
        minConfidence: 0,
      },

      // Actions
      login: (user, token) =>
        set({
          isAuthenticated: true,
          user,
          authToken: token,
          currentPage: user.onboardingCompleted ? 'dashboard' : 'onboarding',
          navHistory: [],
        }),

      logout: () => {
        // Reset in-memory state AND clear persisted storage so stale tokens /
        // user data don't linger (and a failed later persist can't resurrect them).
        try {
          useStore.persist.clearStorage();
        } catch {
          // storage may be unavailable (SSR / private mode)
        }
        set({
          isAuthenticated: false,
          user: null,
          authToken: null,
          currentPage: 'login',
          sidebarOpen: false,
        });
      },

      setPage: (page) =>
        set((state) => {
          if (page === state.currentPage) return state
          const MAX_HISTORY = 20
          const navHistory = [...state.navHistory, state.currentPage].slice(-MAX_HISTORY)
          return { currentPage: page, navHistory }
        }),

      goBack: () =>
        set((state) => {
          if (state.navHistory.length === 0) {
            return { currentPage: 'dashboard', navHistory: [] }
          }
          const prev = state.navHistory[state.navHistory.length - 1]
          const navHistory = state.navHistory.slice(0, -1)
          return { currentPage: prev, navHistory }
        }),

      setIsAuthenticated: (value) => set({ isAuthenticated: value }),

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      toggleSidebarCollapsed: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setNotificationCount: (count) => set({ notificationCount: count }),

      updateUser: (data) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...data } : null,
        })),

      setSignalFilters: (filters) =>
        set((state) => ({
          signalFilters: { ...state.signalFilters, ...filters },
        })),

      setLocale: (locale) => set({ locale }),
    }),
    {
      name: 'toptier-store',
      version: 2,
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        authToken: state.authToken,
        currentPage: state.currentPage,
        navHistory: state.navHistory,
        sidebarCollapsed: state.sidebarCollapsed,
        signalFilters: state.signalFilters,
        locale: state.locale,
      }),
    }
  )
)
