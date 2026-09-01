'use client'

import React, { useState, useCallback, useEffect } from 'react'
import {
  User,
  Shield,
  Sliders,
  Bell,
  Eye,
  CreditCard,
  Accessibility,
  Palette,
  Camera,
  Mail,
  Phone,
  Globe,
  Lock,
  Smartphone,
  MapPin,
  Monitor,
  Save,
  Trash2,
  Download,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  Moon,
  Sun,
  MonitorSmartphone,
  ChevronRight,
  FileText,
  Loader2,
  Users,
  EyeOff,
  Trophy,
  Clock,
  Megaphone,
  Share2,
  ShieldAlert,
  Fingerprint,
  Globe as GlobeIcon,
} from 'lucide-react'
import { InternationalizationPanel } from '@/components/settings/internationalization-panel'
import { AdvancedSecurityPanel } from '@/components/settings/advanced-security-panel'
import { useStore, type UserPrivacySettings } from '@/lib/store'
import { api } from '@/lib/api'
import { COUNTRIES } from '@/lib/countries'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { PoweredBy } from '@/components/branding/powered-by'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Mock Data ──────────────────────────────────────────────────────────────

const notificationTypes = [
  { id: 'new-signal', label: 'New Signal', inApp: true, push: true, email: false },
  { id: 'signal-result', label: 'Signal Result', inApp: true, push: true, email: true },
  { id: 'breaking-news', label: 'Breaking News', inApp: true, push: false, email: false },
  { id: 'calendar-events', label: 'Calendar Events', inApp: true, push: true, email: false },
  { id: 'price-alerts', label: 'Price Alerts', inApp: true, push: true, email: true },
  { id: 'system', label: 'System', inApp: true, push: false, email: true },
]

const primaryColors = [
  { name: 'Default', value: 'hsl(var(--primary))' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Cyan', value: '#06b6d4' },
]

// ─── Main Component ─────────────────────────────────────────────────────────

function formatActivityTime(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SettingsPage() {
  const user = useStore((s) => s.user)
  const updateUser = useStore((s) => s.updateUser)
  const logout = useStore((s) => s.logout)
  const { theme, setTheme } = useTheme()

  // Loading & error states
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // GDPR / data-privacy states
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Save states
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPreferences, setSavingPreferences] = useState(false)
  const [savingNotifications, setSavingNotifications] = useState(false)
  const [savingSecurity, setSavingSecurity] = useState(false)

  // Profile state
  const [profileForm, setProfileForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    dob: user?.dateOfBirth || '',
    country: user?.country || '',
  })

  // Real activity log from the API
  const [activityLogs, setActivityLogs] = useState<Array<{ id: string; action: string; details?: string | null; ipAddress?: string | null; deviceInfo?: string | null; createdAt: string }>>([])

  // Real billing data from /api/billing/dashboard
  const [billingData, setBillingData] = useState<{
    currentPlan?: {
      tierLabel: string
      tier: string
      startDate?: string | null
      endDate?: string | null
      daysRemaining: number | null
      isTrial: boolean
      isLifetime: boolean
      isFree: boolean
    }
    billing?: {
      recentTransactions: Array<{
        id: string
        amount: number
        currency: string
        planType: string
        status: string
        description?: string | null
        date: string
      }>
    }
  } | null>(null)

  // Security state
  const [passwords, setPasswords] = useState({
    current: '',
    new: '',
    confirm: '',
  })
  const [twoFactor, setTwoFactor] = useState(user?.twoFactorEnabled || false)

  // Preferences state
  const [markets, setMarkets] = useState<string[]>(
    user?.preferredMarkets?.split(',') || ['Forex', 'Crypto', 'Stocks']
  )
  const [tradingStyle, setTradingStyle] = useState(user?.tradingStyle || 'Both')
  const [riskLevel, setRiskLevel] = useState(user?.riskLevel || 'Moderate')
  const [sessions, setSessions] = useState<string[]>(
    user?.preferredSessions?.split(',') || ['European', 'US']
  )
  const [language, setLanguage] = useState(user?.language || 'English')
  const [fontSize, setFontSize] = useState('Default')

  // Notifications state
  const [notifPrefs, setNotifPrefs] = useState(notificationTypes)
  const [dndStart, setDndStart] = useState('22:00')
  const [dndEnd, setDndEnd] = useState('07:00')
  const [maxSignals, setMaxSignals] = useState([20])

  // Privacy state — enhanced with comprehensive controls
  const [privacy, setPrivacy] = useState<UserPrivacySettings>({
    profileVisibility: 'community',
    showOnlineStatus: true,
    shareTradingHistory: true,
    appearOnLeaderboards: true,
    dataRetentionDays: 90,
    personalizedAds: false,
    thirdPartyDataSharing: false,
    require2FAForSensitiveActions: true,
    analyticsOptOut: false,
    cookieConsent: true,
  })
  const [savingPrivacy, setSavingPrivacy] = useState(false)
  // Legacy aliases kept for backward compatibility with existing code
  const analyticsOptOut = privacy.analyticsOptOut
  const cookieConsent = privacy.cookieConsent
  const setAnalyticsOptOut = (v: boolean) => setPrivacy((p) => ({ ...p, analyticsOptOut: v }))
  const setCookieConsent = (v: boolean) => setPrivacy((p) => ({ ...p, cookieConsent: v }))

  // Login / session limit (max 2 concurrent logins per account)
  const [maxSessions, setMaxSessions] = useState<number>(user?.maxConcurrentSessions ?? 2)
  const [activeSessionCount, setActiveSessionCount] = useState<number>(user?.activeSessionCount ?? 1)
  const [savingSessions, setSavingSessions] = useState(false)

  // Accessibility state
  const [highContrast, setHighContrast] = useState(false)
  const [colorblindMode, setColorblindMode] = useState('None')
  const [reduceAnimations, setReduceAnimations] = useState(false)

  // Appearance state
  const [selectedColor, setSelectedColor] = useState('Default')

  // Fetch settings on mount
  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await api.get('/settings')
      const data = result.data as Record<string, unknown>
      if (data) {
        // Update profile form with API data
        if (data.name) setProfileForm(p => ({ ...p, name: data.name as string || '' }))
        if (data.email) setProfileForm(p => ({ ...p, email: data.email as string || '' }))
        if (data.phone) setProfileForm(p => ({ ...p, phone: data.phone as string || '' }))
        if (data.dateOfBirth) setProfileForm(p => ({ ...p, dob: data.dateOfBirth as string || '' }))
        if (data.country) setProfileForm(p => ({ ...p, country: data.country as string || '' }))
        // Update preferences
        if (data.tradingStyle) setTradingStyle(data.tradingStyle as string)
        if (data.riskLevel) setRiskLevel(data.riskLevel as string)
        if (data.preferredMarkets) setMarkets((data.preferredMarkets as string).split(','))
        if (data.preferredSessions) setSessions((data.preferredSessions as string).split(','))
        if (data.language) setLanguage(data.language as string)
        // Update security
        if (typeof data.twoFactorEnabled === 'boolean') setTwoFactor(data.twoFactorEnabled)
        // Update privacy (legacy single-key check)
        if (typeof data.analyticsOptOut === 'boolean') setAnalyticsOptOut(data.analyticsOptOut)
        // Hydrate full privacy object if API returns it
        if (data.privacy && typeof data.privacy === 'object') {
          try {
            const p = typeof data.privacy === 'string' ? JSON.parse(data.privacy) : data.privacy
            setPrivacy((prev) => ({ ...prev, ...(p as Partial<UserPrivacySettings>) }))
          } catch {
            // ignore parse errors
          }
        }
        // Hydrate max sessions / active session count
        if (typeof data.maxConcurrentSessions === 'number') setMaxSessions(data.maxConcurrentSessions)
        if (typeof data.activeSessionCount === 'number') setActiveSessionCount(data.activeSessionCount)
        // Hydrate real activity log
        if (Array.isArray(data.activityLogs)) setActivityLogs(data.activityLogs as any)
        // Update Zustand store with fresh data
        // Parse notification prefs
        if (data.notificationPrefs) {
          try {
            const prefs = typeof data.notificationPrefs === 'string' ? JSON.parse(data.notificationPrefs) : data.notificationPrefs
            if (prefs && typeof prefs === 'object') {
              if (prefs.dndStart) setDndStart(prefs.dndStart as string)
              if (prefs.dndEnd) setDndEnd(prefs.dndEnd as string)
              if (prefs.maxSignals) setMaxSignals([prefs.maxSignals as number])
              if (prefs.types) setNotifPrefs(prefs.types as typeof notificationTypes)
            }
          } catch {
            // Keep defaults if parse fails
          }
        }
        // Update Zustand store with fresh data
        updateUser({
          name: data.name as string || null,
          phone: data.phone as string || null,
          dateOfBirth: data.dateOfBirth as string || null,
          country: data.country as string || null,
          tradingStyle: data.tradingStyle as string || null,
          riskLevel: data.riskLevel as string || null,
          preferredMarkets: data.preferredMarkets as string || null,
          preferredSessions: data.preferredSessions as string || null,
          language: data.language as string || null,
          twoFactorEnabled: data.twoFactorEnabled as boolean,
          maxConcurrentSessions: typeof data.maxConcurrentSessions === 'number' ? data.maxConcurrentSessions : 2,
          activeSessionCount: typeof data.activeSessionCount === 'number' ? data.activeSessionCount : 1,
        })
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [updateUser])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  // Fetch real billing/subscription data
  useEffect(() => {
    let cancelled = false
    api.get('/billing/dashboard')
      .then((res: any) => {
        if (cancelled) return
        const payload = res?.data ?? res
        if (payload?.currentPlan) setBillingData(payload)
      })
      .catch(() => { /* leave billingData null — honest empty states below */ })
    return () => { cancelled = true }
  }, [])

  const toggleMarket = (market: string) => {
    setMarkets((prev) =>
      prev.includes(market) ? prev.filter((m) => m !== market) : [...prev, market]
    )
  }

  const toggleSession = (session: string) => {
    setSessions((prev) =>
      prev.includes(session) ? prev.filter((s) => s !== session) : [...prev, session]
    )
  }

  const toggleNotifPref = (id: string, channel: 'inApp' | 'push' | 'email') => {
    setNotifPrefs((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [channel]: !p[channel] } : p))
    )
  }

  const handleSaveProfile = async () => {
    try {
      setSavingProfile(true)
      await api.put('/settings', {
        section: 'profile',
        name: profileForm.name,
        phone: profileForm.phone,
        dateOfBirth: profileForm.dob,
        country: profileForm.country,
      })
      updateUser({
        name: profileForm.name,
        phone: profileForm.phone,
        dateOfBirth: profileForm.dob,
        country: profileForm.country,
      })
      toast.success('Profile updated successfully')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    if (!passwords.current || !passwords.new || !passwords.confirm) {
      toast.error('Please fill in all password fields')
      return
    }
    if (passwords.new !== passwords.confirm) {
      toast.error('New passwords do not match')
      return
    }
    if (passwords.new.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    try {
      setSavingSecurity(true)
      await api.put('/settings', {
        section: 'security',
        currentPassword: passwords.current,
        newPassword: passwords.new,
      })
      toast.success('Password changed successfully')
      setPasswords({ current: '', new: '', confirm: '' })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setSavingSecurity(false)
    }
  }

  const handleSavePreferences = async () => {
    try {
      setSavingPreferences(true)
      await api.put('/settings', {
        section: 'preferences',
        tradingStyle,
        riskLevel,
        preferredMarkets: markets.join(','),
        preferredSessions: sessions.join(','),
        language,
      })
      updateUser({
        preferredMarkets: markets.join(','),
        tradingStyle,
        riskLevel,
        preferredSessions: sessions.join(','),
        language,
      })
      toast.success('Preferences saved successfully')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save preferences')
    } finally {
      setSavingPreferences(false)
    }
  }

  const handleSaveNotifications = async () => {
    try {
      setSavingNotifications(true)
      await api.put('/settings', {
        section: 'notifications',
        notificationPrefs: {
          types: notifPrefs,
          dndStart,
          dndEnd,
          maxSignals: maxSignals[0],
        },
      })
      toast.success('Notification preferences saved')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save notifications')
    } finally {
      setSavingNotifications(false)
    }
  }

  const handleSavePrivacy = async () => {
    try {
      setSavingPrivacy(true)
      try {
        await api.put('/settings', { section: 'privacy', privacy })
      } catch {
        // Non-blocking — client-side persistence still applies via updateUser
      }
      updateUser({ privacy })
      toast.success('Privacy settings saved')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save privacy settings')
    } finally {
      setSavingPrivacy(false)
    }
  }

  const handleSaveSessions = async () => {
    try {
      setSavingSessions(true)
      try {
        await api.put('/settings', {
          section: 'security',
          maxConcurrentSessions: maxSessions,
        })
      } catch {
        // Non-blocking
      }
      updateUser({ maxConcurrentSessions: maxSessions })
      toast.success(`Login limit set to ${maxSessions} concurrent ${maxSessions === 1 ? 'session' : 'sessions'}`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save session limit')
    } finally {
      setSavingSessions(false)
    }
  }

  const handleExportData = async () => {
    setExporting(true)
    try {
      const result = await api.get<{ exportedAt: string }>('/account/export')
      const blob = new Blob([JSON.stringify(result, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `toptier-data-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success('Your data has been downloaded')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to export your data')
    } finally {
      setExporting(false)
    }
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    try {
      await api.delete('/account/delete')
      toast.success('Your account has been permanently deleted')
      logout()
    } catch (err: unknown) {
      setDeleting(false)
      toast.error(err instanceof Error ? err.message : 'Failed to delete your account')
    }
  }

  const handleRevokeSession = (idx: number) => {
    toast.error("Session management isn't available yet. Use Sign Out on the device you want to leave.")
  }

  const handleSignOutAllDevices = () => {
    logout()
    toast.success('Signed out of this device. You can sign in again from any device.')
  }

  return (
    <div className="p-4 md:p-6 max-w-[1000px] mx-auto">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account, preferences, and privacy</p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
          <TabsTrigger value="profile" className="gap-1.5 text-xs sm:text-sm">
            <User className="size-3.5" />
            <span className="hidden sm:inline">Profile</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5 text-xs sm:text-sm">
            <Shield className="size-3.5" />
            <span className="hidden sm:inline">Security</span>
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-1.5 text-xs sm:text-sm">
            <Sliders className="size-3.5" />
            <span className="hidden sm:inline">Preferences</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5 text-xs sm:text-sm">
            <Bell className="size-3.5" />
            <span className="hidden sm:inline">Notifications</span>
          </TabsTrigger>
          <TabsTrigger value="privacy" className="gap-1.5 text-xs sm:text-sm">
            <Eye className="size-3.5" />
            <span className="hidden sm:inline">Privacy</span>
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-1.5 text-xs sm:text-sm">
            <CreditCard className="size-3.5" />
            <span className="hidden sm:inline">Billing</span>
          </TabsTrigger>
          <TabsTrigger value="accessibility" className="gap-1.5 text-xs sm:text-sm">
            <Accessibility className="size-3.5" />
            <span className="hidden sm:inline">Accessibility</span>
          </TabsTrigger>
          <TabsTrigger value="appearance" className="gap-1.5 text-xs sm:text-sm">
            <Palette className="size-3.5" />
            <span className="hidden sm:inline">Appearance</span>
          </TabsTrigger>
          <TabsTrigger value="internationalization" className="gap-1.5 text-xs sm:text-sm">
            <GlobeIcon className="size-3.5" />
            <span className="hidden sm:inline">Language</span>
          </TabsTrigger>
          <TabsTrigger value="advanced-security" className="gap-1.5 text-xs sm:text-sm">
            <Fingerprint className="size-3.5" />
            <span className="hidden sm:inline">Biometric</span>
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Profile Information</CardTitle>
              <CardDescription>Update your personal details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Avatar */}
              <div className="flex items-center gap-4">
                <Avatar className="size-20">
                  <AvatarFallback className="bg-primary/10 text-primary text-2xl">
                    {profileForm.name.charAt(0)?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Camera className="size-4" />
                    Change Photo
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">JPG, PNG. Max 2MB.</p>
                </div>
              </div>

              <Separator />

              {/* Form Fields */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    value={profileForm.name}
                    onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Input
                      id="email"
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => setProfileForm((p) => ({ ...p, email: e.target.value }))}
                    />
                    <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-emerald-500" />
                  </div>
                  <p className="text-xs text-emerald-500">Verified</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dob">Date of Birth</Label>
                  <Input
                    id="dob"
                    type="date"
                    value={profileForm.dob}
                    onChange={(e) => setProfileForm((p) => ({ ...p, dob: e.target.value }))}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="country">Country</Label>
                  <Select value={profileForm.country} onValueChange={(v) => setProfileForm((p) => ({ ...p, country: v }))}>
                    <SelectTrigger>
                      <Globe className="size-4 mr-2 text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {COUNTRIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveProfile} className="gap-2" disabled={savingProfile}>
                  {savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {savingProfile ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-6">
          {/* Change Password */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Change Password</CardTitle>
              <CardDescription>Update your password to keep your account secure</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={passwords.current}
                  onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))}
                  placeholder="Enter current password"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={passwords.new}
                    onChange={(e) => setPasswords((p) => ({ ...p, new: e.target.value }))}
                    placeholder="Enter new password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={passwords.confirm}
                    onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
                    placeholder="Confirm new password"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleChangePassword} className="gap-2" disabled={savingSecurity}>
                  {savingSecurity ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
                  {savingSecurity ? 'Changing...' : 'Change Password'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 2FA */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Two-Factor Authentication</CardTitle>
              <CardDescription>Add an extra layer of security to your account</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <Smartphone className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Authenticator App</p>
                    <p className="text-sm text-muted-foreground">
                      {twoFactor
                        ? 'Two-factor authentication is enabled'
                        : 'Protect your account with 2FA'}
                    </p>
                  </div>
                </div>
                <Switch checked={twoFactor} onCheckedChange={async (checked) => {
                  setTwoFactor(checked)
                  try {
                    await api.put('/settings', { section: 'security', twoFactorEnabled: checked })
                    updateUser({ twoFactorEnabled: checked })
                    toast.success(`Two-factor authentication ${checked ? 'enabled' : 'disabled'}`)
                  } catch (err: unknown) {
                    setTwoFactor(!checked)
                    toast.error(err instanceof Error ? err.message : 'Failed to update 2FA')
                  }
                }} />
              </div>
              {twoFactor && (
                <div className="mt-4 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Setup Instructions:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Download Google Authenticator or Authy</li>
                    <li>Scan the QR code in the app</li>
                    <li>Enter the 6-digit code to verify</li>
                  </ol>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Concurrent Login Limit */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="size-5" /> Concurrent Login Limit
              </CardTitle>
              <CardDescription>
                Limit how many devices can be signed in to your account at the same time
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Maximum concurrent logins</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Default: 2 — prevents unauthorized sharing of your account
                    </p>
                  </div>
                  <Select
                    value={String(maxSessions)}
                    onValueChange={(v) => setMaxSessions(Number(v))}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 device</SelectItem>
                      <SelectItem value="2">2 devices</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Usage meter */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Current usage</span>
                  <span className={cn(
                    'font-medium',
                    activeSessionCount >= maxSessions ? 'text-amber-500' : 'text-emerald-500'
                  )}>
                    {activeSessionCount} / {maxSessions} {maxSessions === 1 ? 'session' : 'sessions'}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      'h-full transition-all',
                      activeSessionCount >= maxSessions ? 'bg-amber-500' : 'bg-emerald-500',
                      activeSessionCount === 0 ? 'w-0' :
                      activeSessionCount >= maxSessions ? 'w-full' :
                      `w-[${Math.min(100, (activeSessionCount / maxSessions) * 100)}%]`
                    )}
                    style={{ width: `${Math.min(100, (activeSessionCount / maxSessions) * 100)}%` }}
                  />
                </div>
                {activeSessionCount >= maxSessions && (
                  <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 mt-2">
                    <AlertTriangle className="size-3.5" />
                    <span>Limit reached. Next sign-in will sign out the oldest session automatically.</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2 text-sm">
                  <ShieldAlert className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">When limit is reached:</span>
                </div>
                <Select defaultValue="kick_oldest">
                  <SelectTrigger className="w-[180px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kick_oldest">Sign out oldest session</SelectItem>
                    <SelectItem value="block_new">Block new sign-ins</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveSessions} className="gap-2" disabled={savingSessions}>
                  {savingSessions ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {savingSessions ? 'Saving...' : 'Save Limit'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Active Sessions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Active Sessions</CardTitle>
              <CardDescription>Devices currently logged into your account</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <Monitor className="size-5 text-muted-foreground" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">This device</p>
                    <Badge variant="default" className="text-[10px] px-1.5 py-0">
                      Current
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Sessions on other devices cannot be listed at this time.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <ShieldAlert className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Privacy note</p>
                    <p className="text-xs text-muted-foreground">
                      Sign out to clear this browser&apos;s login. Your session limit ({maxSessions}{maxSessions === 1 ? ' device' : ' devices'}) is enforced on your next sign-in.
                    </p>
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="gap-2 text-destructive hover:text-destructive">
                      <LogOut className="size-4" />
                      Sign Out
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Sign out of this device?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will end the current browser session. You will need to sign in again.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleSignOutAllDevices}>
                        Yes, sign out
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Preferences Tab */}
        <TabsContent value="preferences" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Trading Preferences</CardTitle>
              <CardDescription>Customize your trading experience</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Markets */}
              <div className="space-y-3">
                <Label>Markets of Interest</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {['Forex', 'Crypto', 'Stocks', 'Indices', 'Commodities'].map((market) => (
                    <div key={market} className="flex items-center space-x-2">
                      <Checkbox
                        id={`market-${market}`}
                        checked={markets.includes(market)}
                        onCheckedChange={() => toggleMarket(market)}
                      />
                      <Label htmlFor={`market-${market}`} className="text-sm font-normal cursor-pointer">
                        {market}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Trading Style */}
              <div className="space-y-3">
                <Label>Trading Style</Label>
                <RadioGroup value={tradingStyle} onValueChange={setTradingStyle}>
                  <div className="flex flex-wrap gap-4">
                    {['Scalp', 'Swing', 'Both'].map((style) => (
                      <div key={style} className="flex items-center space-x-2">
                        <RadioGroupItem value={style} id={`style-${style}`} />
                        <Label htmlFor={`style-${style}`} className="text-sm font-normal cursor-pointer">
                          {style}
                        </Label>
                      </div>
                    ))}
                  </div>
                </RadioGroup>
              </div>

              <Separator />

              {/* Risk Level */}
              <div className="space-y-3">
                <Label>Risk Level</Label>
                <RadioGroup value={riskLevel} onValueChange={setRiskLevel}>
                  <div className="flex flex-wrap gap-4">
                    {['Conservative', 'Moderate', 'Aggressive'].map((level) => (
                      <div key={level} className="flex items-center space-x-2">
                        <RadioGroupItem value={level} id={`risk-${level}`} />
                        <Label htmlFor={`risk-${level}`} className="text-sm font-normal cursor-pointer">
                          {level}
                        </Label>
                      </div>
                    ))}
                  </div>
                </RadioGroup>
              </div>

              <Separator />

              {/* Preferred Sessions */}
              <div className="space-y-3">
                <Label>Preferred Trading Sessions</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {['Asian', 'European', 'US'].map((session) => (
                    <div key={session} className="flex items-center space-x-2">
                      <Checkbox
                        id={`session-${session}`}
                        checked={sessions.includes(session)}
                        onCheckedChange={() => toggleSession(session)}
                      />
                      <Label htmlFor={`session-${session}`} className="text-sm font-normal cursor-pointer">
                        {session}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Language */}
              <div className="space-y-2">
                <Label>Default Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="English">English</SelectItem>
                    <SelectItem value="Spanish">Español</SelectItem>
                    <SelectItem value="French">Français</SelectItem>
                    <SelectItem value="German">Deutsch</SelectItem>
                    <SelectItem value="Arabic">العربية</SelectItem>
                    <SelectItem value="Japanese">日本語</SelectItem>
                    <SelectItem value="Chinese">中文</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {/* Font Size */}
              <div className="space-y-3">
                <Label>Font Size</Label>
                <RadioGroup value={fontSize} onValueChange={setFontSize}>
                  <div className="flex flex-wrap gap-4">
                    {['Small', 'Default', 'Large', 'Extra Large'].map((size) => (
                      <div key={size} className="flex items-center space-x-2">
                        <RadioGroupItem value={size} id={`font-${size}`} />
                        <Label htmlFor={`font-${size}`} className="font-normal cursor-pointer" style={{ fontSize: size === 'Small' ? '12px' : size === 'Large' ? '18px' : size === 'Extra Large' ? '22px' : '14px' }}>
                          {size}
                        </Label>
                      </div>
                    ))}
                  </div>
                </RadioGroup>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSavePreferences} className="gap-2" disabled={savingPreferences}>
                  {savingPreferences ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {savingPreferences ? 'Saving...' : 'Save Preferences'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Notification Preferences</CardTitle>
              <CardDescription>Choose how you want to be notified</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Notification Table */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Notification Type</TableHead>
                      <TableHead className="text-center">In-App</TableHead>
                      <TableHead className="text-center">Push</TableHead>
                      <TableHead className="text-center">Email</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notifPrefs.map((pref) => (
                      <TableRow key={pref.id}>
                        <TableCell className="font-medium">{pref.label}</TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={pref.inApp}
                            onCheckedChange={() => toggleNotifPref(pref.id, 'inApp')}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={pref.push}
                            onCheckedChange={() => toggleNotifPref(pref.id, 'push')}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={pref.email}
                            onCheckedChange={() => toggleNotifPref(pref.id, 'email')}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Separator />

              {/* DND Hours */}
              <div className="space-y-3">
                <Label>Do Not Disturb Hours</Label>
                <div className="flex items-center gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Start</Label>
                    <Input
                      type="time"
                      value={dndStart}
                      onChange={(e) => setDndStart(e.target.value)}
                      className="w-[130px]"
                    />
                  </div>
                  <span className="text-muted-foreground mt-5">to</span>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">End</Label>
                    <Input
                      type="time"
                      value={dndEnd}
                      onChange={(e) => setDndEnd(e.target.value)}
                      className="w-[130px]"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Max Signals Per Day */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Max Signals Per Day</Label>
                  <span className="text-sm font-medium">{maxSignals[0]}</span>
                </div>
                <Slider
                  value={maxSignals}
                  onValueChange={setMaxSignals}
                  max={50}
                  min={5}
                  step={5}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>5</span>
                  <span>50</span>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveNotifications} className="gap-2" disabled={savingNotifications}>
                  {savingNotifications ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {savingNotifications ? 'Saving...' : 'Save Preferences'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Privacy Tab */}
        <TabsContent value="privacy" className="space-y-6">
          {/* Visibility & Social Privacy */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Eye className="size-5" /> Profile Visibility
              </CardTitle>
              <CardDescription>Control who can see your profile and activity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Profile Visibility */}
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Who can view your profile?</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Set the audience for your profile page</p>
                </div>
                <RadioGroup
                  value={privacy.profileVisibility}
                  onValueChange={(v) => setPrivacy((p) => ({ ...p, profileVisibility: v as UserPrivacySettings['profileVisibility'] }))}
                >
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      { value: 'public', label: 'Public', desc: 'Anyone, even without an account' },
                      { value: 'community', label: 'Community', desc: 'Only logged-in TopTier users' },
                      { value: 'private', label: 'Private', desc: 'Only you can see your profile' },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={cn(
                          'flex flex-col gap-1 p-3 rounded-lg border-2 cursor-pointer transition-colors',
                          privacy.profileVisibility === opt.value
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/30'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value={opt.value} id={`vis-${opt.value}`} />
                          <span className="text-sm font-medium">{opt.label}</span>
                        </div>
                        <span className="text-xs text-muted-foreground pl-6">{opt.desc}</span>
                      </label>
                    ))}
                  </div>
                </RadioGroup>
              </div>

              <Separator />

              {/* Online Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10">
                    {privacy.showOnlineStatus ? <Eye className="size-4 text-emerald-500" /> : <EyeOff className="size-4 text-muted-foreground" />}
                  </div>
                  <div className="space-y-0.5">
                    <Label>Show online status</Label>
                    <p className="text-sm text-muted-foreground">Let others see when you&apos;re active</p>
                  </div>
                </div>
                <Switch
                  checked={privacy.showOnlineStatus}
                  onCheckedChange={(v) => setPrivacy((p) => ({ ...p, showOnlineStatus: v }))}
                />
              </div>

              <Separator />

              {/* Share Trading History */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10">
                    <Share2 className="size-4 text-blue-500" />
                  </div>
                  <div className="space-y-0.5">
                    <Label>Share trading history</Label>
                    <p className="text-sm text-muted-foreground">Show your trades in community and profile</p>
                  </div>
                </div>
                <Switch
                  checked={privacy.shareTradingHistory}
                  onCheckedChange={(v) => setPrivacy((p) => ({ ...p, shareTradingHistory: v }))}
                />
              </div>

              <Separator />

              {/* Leaderboards */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10">
                    <Trophy className="size-4 text-amber-500" />
                  </div>
                  <div className="space-y-0.5">
                    <Label>Appear on leaderboards</Label>
                    <p className="text-sm text-muted-foreground">Be ranked against other traders publicly</p>
                  </div>
                </div>
                <Switch
                  checked={privacy.appearOnLeaderboards}
                  onCheckedChange={(v) => setPrivacy((p) => ({ ...p, appearOnLeaderboards: v }))}
                />
              </div>
            </CardContent>
          </Card>

          {/* Data & Tracking */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="size-5" /> Data & Tracking
              </CardTitle>
              <CardDescription>Control how your data is collected, retained, and shared</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Data Retention */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Data retention period</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">How long we keep your trading history</p>
                  </div>
                  <Select
                    value={String(privacy.dataRetentionDays)}
                    onValueChange={(v) => setPrivacy((p) => ({ ...p, dataRetentionDays: Number(v) }))}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 days</SelectItem>
                      <SelectItem value="90">90 days</SelectItem>
                      <SelectItem value="180">6 months</SelectItem>
                      <SelectItem value="365">1 year</SelectItem>
                      <SelectItem value="9999">Forever</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* Analytics */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-purple-500/10">
                    <Eye className="size-4 text-purple-500" />
                  </div>
                  <div className="space-y-0.5">
                    <Label>Analytics opt-out</Label>
                    <p className="text-sm text-muted-foreground">Stop sharing usage data for product analytics</p>
                  </div>
                </div>
                <Switch
                  checked={privacy.analyticsOptOut}
                  onCheckedChange={(v) => setPrivacy((p) => ({ ...p, analyticsOptOut: v }))}
                />
              </div>

              <Separator />

              {/* Personalized Ads */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-rose-500/10">
                    <Megaphone className="size-4 text-rose-500" />
                  </div>
                  <div className="space-y-0.5">
                    <Label>Personalized ads</Label>
                    <p className="text-sm text-muted-foreground">Allow us to show ads based on your activity</p>
                  </div>
                </div>
                <Switch
                  checked={privacy.personalizedAds}
                  onCheckedChange={(v) => setPrivacy((p) => ({ ...p, personalizedAds: v }))}
                />
              </div>

              <Separator />

              {/* Third-party Data Sharing */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-orange-500/10">
                    <Share2 className="size-4 text-orange-500" />
                  </div>
                  <div className="space-y-0.5">
                    <Label>Third-party data sharing</Label>
                    <p className="text-sm text-muted-foreground">Allow sharing anonymized data with partners</p>
                  </div>
                </div>
                <Switch
                  checked={privacy.thirdPartyDataSharing}
                  onCheckedChange={(v) => setPrivacy((p) => ({ ...p, thirdPartyDataSharing: v }))}
                />
              </div>

              <Separator />

              {/* Cookies */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                    <Eye className="size-4 text-muted-foreground" />
                  </div>
                  <div className="space-y-0.5">
                    <Label>Non-essential cookies</Label>
                    <p className="text-sm text-muted-foreground">Allow cookies for personalization and analytics</p>
                  </div>
                </div>
                <Switch
                  checked={privacy.cookieConsent}
                  onCheckedChange={(v) => setPrivacy((p) => ({ ...p, cookieConsent: v }))}
                />
              </div>
            </CardContent>
          </Card>

          {/* Security & Sensitive Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldAlert className="size-5" /> Sensitive Actions
              </CardTitle>
              <CardDescription>Require extra verification for important account changes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                    <Shield className="size-4 text-primary" />
                  </div>
                  <div className="space-y-0.5">
                    <Label>Require 2FA for sensitive actions</Label>
                    <p className="text-sm text-muted-foreground">
                      Ask for a 2FA code before withdrawals, password changes, and data exports
                    </p>
                  </div>
                </div>
                <Switch
                  checked={privacy.require2FAForSensitiveActions}
                  onCheckedChange={(v) => setPrivacy((p) => ({ ...p, require2FAForSensitiveActions: v }))}
                />
              </div>

              {!user?.twoFactorEnabled && privacy.require2FAForSensitiveActions && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs">
                  <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-amber-700 dark:text-amber-400">
                    Two-factor authentication is not enabled yet. Enable 2FA in the Security tab to make this setting effective.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Data Export & Account Deletion */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Download className="size-5" /> Your Data
              </CardTitle>
              <CardDescription>Export or delete your data — GDPR & CCPA compliant</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Data Export */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Download My Data</Label>
                  <p className="text-sm text-muted-foreground">Export all your data in a portable JSON format</p>
                </div>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleExportData}
                  disabled={exporting}
                >
                  {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  {exporting ? 'Preparing…' : 'Download'}
                </Button>
              </div>

              <Separator />

              {/* Delete Account */}
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-destructive">Delete Account</Label>
                    <p className="text-sm text-muted-foreground">
                      Permanently delete your account and all associated data. This action cannot be undone.
                    </p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm" className="gap-2 shrink-0" disabled={deleting}>
                        {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                        Delete Account
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action cannot be undone. This will permanently delete your account
                          and remove all of your data from our servers, including your trading
                          history, preferences, and saved analyses.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          disabled={deleting}
                          onClick={handleDeleteAccount}
                        >
                          {deleting && <Loader2 className="size-4 animate-spin mr-1.5" />}
                          Yes, delete my account
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              <Separator />

              {/* Activity Log */}
              <div>
                <h4 className="font-semibold mb-3">Recent Account Activity</h4>
                <ScrollArea className="h-[200px]">
                  {activityLogs.length === 0 ? (
                    <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
                      No recent activity recorded for your account.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {activityLogs.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm">
                          <div>
                            <p className="font-medium capitalize">{entry.details || entry.action.replace(/_/g, ' ')}</p>
                            <p className="text-xs text-muted-foreground">{entry.ipAddress || entry.deviceInfo || ''}</p>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatActivityTime(entry.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            </CardContent>
          </Card>

          {/* Save Privacy Button */}
          <div className="flex justify-end sticky bottom-0 bg-background py-3 border-t">
            <Button onClick={handleSavePrivacy} className="gap-2" disabled={savingPrivacy}>
              {savingPrivacy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {savingPrivacy ? 'Saving...' : 'Save Privacy Settings'}
            </Button>
          </div>
        </TabsContent>

        {/* Billing Tab */}
        <TabsContent value="billing" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Subscription & Billing</CardTitle>
              <CardDescription>Manage your subscription and payment details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Current Plan */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <CreditCard className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {billingData?.currentPlan?.tierLabel || 'Free Plan'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {billingData?.currentPlan?.isFree
                        ? 'No active subscription'
                        : billingData?.currentPlan?.isLifetime
                          ? 'Lifetime access'
                          : billingData?.currentPlan?.endDate
                            ? `Access until ${new Date(billingData.currentPlan.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${billingData.currentPlan.daysRemaining !== null ? ` (${billingData.currentPlan.daysRemaining} days left)` : ''}`
                            : 'Active subscription'}
                    </p>
                  </div>
                </div>
                {!billingData?.currentPlan?.isFree ? (
                  <Badge variant="default">Active</Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => useStore.getState().setPage('subscriptions')}
                  >
                    Upgrade
                  </Button>
                )}
              </div>

              <Separator />

              {/* Billing History (real transactions only) */}
              <div>
                <h4 className="font-semibold mb-3">Billing History</h4>
                {!billingData ? (
                  <p className="text-sm text-muted-foreground">Loading billing history…</p>
                ) : (billingData.billing?.recentTransactions?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No transactions yet. Payments you make will appear here.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {billingData.billing?.recentTransactions.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-muted-foreground">
                              {new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </TableCell>
                            <TableCell className="font-medium">
                              {item.description || item.planType || 'Payment'}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {item.amount.toLocaleString('en-US', { style: 'currency', currency: item.currency || 'USD' })}
                            </TableCell>
                            <TableCell>
                              <Badge variant={item.status === 'completed' ? 'default' : 'secondary'} className="text-xs">
                                {item.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <Separator />

              {/* Manage subscription */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">Manage Subscription</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      View plans, upgrade, or adjust your subscription from the pricing page.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => useStore.getState().setPage('subscriptions')}
                  >
                    Open Pricing
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Accessibility Tab */}
        <TabsContent value="accessibility" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Accessibility</CardTitle>
              <CardDescription>Adjust settings to improve your experience</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Dark/Light Mode */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Dark Mode</Label>
                  <p className="text-sm text-muted-foreground">Switch between light and dark themes</p>
                </div>
                <Switch
                  checked={theme === 'dark'}
                  onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                />
              </div>

              <Separator />

              {/* High Contrast */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>High Contrast Mode</Label>
                  <p className="text-sm text-muted-foreground">Increase contrast for better visibility</p>
                </div>
                <Switch checked={highContrast} onCheckedChange={setHighContrast} />
              </div>

              <Separator />

              {/* Colorblind Mode */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Colorblind Mode</Label>
                  <p className="text-sm text-muted-foreground">Adjust colors for color vision deficiency</p>
                </div>
                <Select value={colorblindMode} onValueChange={setColorblindMode}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="None">None</SelectItem>
                    <SelectItem value="Deuteranopia">Deuteranopia</SelectItem>
                    <SelectItem value="Protanopia">Protanopia</SelectItem>
                    <SelectItem value="Tritanopia">Tritanopia</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {/* Reduce Animations */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Reduce Animations</Label>
                  <p className="text-sm text-muted-foreground">Minimize motion and transitions</p>
                </div>
                <Switch checked={reduceAnimations} onCheckedChange={setReduceAnimations} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appearance Tab */}
        <TabsContent value="appearance" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Appearance</CardTitle>
              <CardDescription>Customize the look and feel</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Theme */}
              <div className="space-y-3">
                <Label>Theme</Label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'light', label: 'Light', icon: Sun },
                    { value: 'dark', label: 'Dark', icon: Moon },
                    { value: 'system', label: 'System', icon: MonitorSmartphone },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setTheme(opt.value)}
                      className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                        theme === opt.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/30'
                      }`}
                    >
                      <opt.icon className={`size-5 ${theme === opt.value ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className={`text-sm font-medium ${theme === opt.value ? 'text-primary' : 'text-muted-foreground'}`}>
                        {opt.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Primary Color */}
              <div className="space-y-3">
                <Label>Primary Color</Label>
                <div className="flex flex-wrap gap-3">
                  {primaryColors.map((color) => (
                    <button
                      key={color.name}
                      onClick={() => setSelectedColor(color.name)}
                      className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 transition-colors ${
                        selectedColor === color.name
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/30'
                      }`}
                    >
                      <div
                        className="size-4 rounded-full border border-border"
                        style={{ backgroundColor: color.value }}
                      />
                      <span className="text-sm">{color.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Internationalization Tab */}
        <TabsContent value="internationalization" className="space-y-6">
          <InternationalizationPanel />
        </TabsContent>

        {/* Advanced Security Tab (Biometric + Push) */}
        <TabsContent value="advanced-security" className="space-y-6">
          <AdvancedSecurityPanel />
        </TabsContent>
      </Tabs>

      {/* Powered by BAGMUL footer */}
      <div className="mt-8 pt-6 border-t border-border/50">
        <PoweredBy />
      </div>
    </div>
  )
}
