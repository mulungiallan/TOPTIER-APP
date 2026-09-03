'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  User as UserIcon,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Globe,
  Camera,
  Edit3,
  Save,
  X,
  TrendingUp,
  Target,
  Award,
  Activity,
  Gift,
  Copy,
  Check,
  Shield,
  Settings as SettingsIcon,
  Crown,
  Loader2,
  BarChart3,
  Zap,
  Clock,
  BookOpen,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PoweredBy } from '@/components/branding/powered-by'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActivityEntry {
  id: string
  action: string
  detail: string | null
  time: string
}

interface AchievementEntry {
  id: string
  badgeType: string
  badgeName: string
  earnedAt: string
}

interface ProfileData {
  recentActivity: ActivityEntry[]
  achievements: AchievementEntry[]
  stats: { signalsTracked: number; winRate: number; trades: number; avgReturn: number }
  memberSince?: string | null
}

// ─── Helper Components ──────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  accent,
}: {
  label: string
  value: string
  sublabel?: string
  icon: React.ElementType
  accent: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {sublabel && <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>}
          </div>
          <div className={cn('flex size-9 items-center justify-center rounded-lg', accent)}>
            <Icon className="size-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ActivityDot({ action }: { action: string }) {
  const lower = action.toLowerCase()
  let type = 'info'
  if (lower.includes('signal') || lower.includes('trade') || lower.includes('close') || lower.includes('analy')) type = 'trade'
  else if (lower.includes('login') || lower.includes('logout') || lower.includes('password') || lower.includes('2fa') || lower.includes('security')) type = 'security'
  else if (lower.includes('profile') || lower.includes('settings') || lower.includes('avatar')) type = 'update'
  else if (lower.includes('payment') || lower.includes('subscription') || lower.includes('premium') || lower.includes('refer')) type = 'billing'

  const colors: Record<string, string> = {
    trade: 'bg-blue-500',
    security: 'bg-amber-500',
    update: 'bg-emerald-500',
    billing: 'bg-purple-500',
    info: 'bg-muted-foreground',
  }
  return <span className={cn('size-2 rounded-full', colors[type] || 'bg-muted-foreground')} />
}

function activityLabel(action: string): string {
  const map: Record<string, string> = {
    create_signal: 'Signal created',
    accept_signal: 'Signal tracked',
    close_signal: 'Signal closed',
    login: 'Logged in',
    logout: 'Logged out',
    password_change: 'Password changed',
    two_factor_enable: '2FA enabled',
    two_factor_disable: '2FA disabled',
    profile_update: 'Profile updated',
    avatar_upload: 'Profile photo updated',
    payment_success: 'Payment received',
    subscription_started: 'Subscription started',
    subscription_renewed: 'Subscription renewed',
    referral_earned: 'Referral reward earned',
    education_complete: 'Lesson completed',
    badge_awarded: 'Badge unlocked',
    signup: 'Account created',
  }
  return map[action] || action.replace(/_/g, ' ')
}

function badgeStyle(badgeType: string) {
  const styles: Record<string, { icon: React.ElementType; color: string }> = {
    education: { icon: BookOpen, color: 'bg-blue-500/10 text-blue-500' },
    performance: { icon: TrendingUp, color: 'bg-emerald-500/10 text-emerald-500' },
    community: { icon: Award, color: 'bg-amber-500/10 text-amber-500' },
    trader: { icon: Crown, color: 'bg-purple-500/10 text-purple-500' },
    streak: { icon: Zap, color: 'bg-orange-500/10 text-orange-500' },
  }
  return styles[badgeType] || { icon: Award, color: 'bg-muted text-muted-foreground' }
}

// ─── Main Profile Page ──────────────────────────────────────────────────────

export function ProfilePage() {
  const user = useStore((s) => s.user)
  const updateUser = useStore((s) => s.updateUser)
  const setPage = useStore((s) => s.setPage)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [profileForm, setProfileForm] = useState({
    name: user?.name || '',
    bio: user?.bio || '',
    phone: user?.phone || '',
    country: user?.country || '',
    dateOfBirth: user?.dateOfBirth || '',
  })
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.profilePicture || null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [profileData, setProfileData] = useState<ProfileData>({
    recentActivity: [],
    achievements: [],
    stats: { signalsTracked: 0, winRate: 0, trades: 0, avgReturn: 0 },
    memberSince: null,
  })
  const [profileDataLoading, setProfileDataLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api.get<{ success: boolean; data: ProfileData }>('/profile')
      .then((res) => {
        if (cancelled) return
        setProfileData(res.data)
      })
      .catch(() => {
        // Keep empty state
      })
      .finally(() => {
        if (!cancelled) setProfileDataLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const handleAvatarSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Image too large. Maximum size is 8MB.')
      return
    }

    setUploadingPhoto(true)
    try {
      // Resize to a small square so the base64 payload stays tiny.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const img = new Image()
        const objectUrl = URL.createObjectURL(file)
        img.onload = () => {
          const size = 256
          const canvas = document.createElement('canvas')
          canvas.width = size
          canvas.height = size
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            URL.revokeObjectURL(objectUrl)
            reject(new Error('Canvas not supported'))
            return
          }
          ctx.drawImage(img, 0, 0, size, size)
          URL.revokeObjectURL(objectUrl)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        }
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl)
          reject(new Error('Could not read image'))
        }
        img.src = objectUrl
      })

      setAvatarUrl(dataUrl)
      updateUser({ profilePicture: dataUrl })
      try {
        await api.put('/settings', { section: 'profile', profilePicture: dataUrl })
      } catch {
        // Persisted client-side via Zustand; non-blocking
      }
      toast.success('Profile photo updated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to upload photo')
    } finally {
      setUploadingPhoto(false)
    }
  }, [updateUser])

  // Sync local form when user changes (e.g. after fetching)
  useEffect(() => {
    setProfileForm({
      name: user?.name || '',
      bio: user?.bio || '',
      phone: user?.phone || '',
      country: user?.country || '',
      dateOfBirth: user?.dateOfBirth || '',
    })
  }, [user])

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

  const handleSave = async () => {
    try {
      setIsSaving(true)
      // Try to persist via API; fall back gracefully if API unavailable
      try {
        await api.put('/settings', {
          section: 'profile',
          name: profileForm.name,
          phone: profileForm.phone,
          dateOfBirth: profileForm.dateOfBirth,
          country: profileForm.country,
          bio: profileForm.bio,
        })
      } catch {
        // Persisted client-side via Zustand; non-blocking
      }
      updateUser({
        name: profileForm.name,
        bio: profileForm.bio,
        phone: profileForm.phone,
        country: profileForm.country,
        dateOfBirth: profileForm.dateOfBirth,
      })
      toast.success('Profile updated successfully')
      setIsEditing(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setProfileForm({
      name: user?.name || '',
      bio: user?.bio || '',
      phone: user?.phone || '',
      country: user?.country || '',
      dateOfBirth: user?.dateOfBirth || '',
    })
    setIsEditing(false)
  }

  const referralLink = () => {
    const code = user?.referralCode || ''
    if (typeof window !== 'undefined') return `${window.location.origin}/?ref=${encodeURIComponent(code)}`
    return `/?ref=${encodeURIComponent(code)}`
  }

  const handleCopyReferral = async () => {
    const link = referralLink()
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success('Referral link copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const memberSince = profileData.memberSince
    ? new Date(profileData.memberSince).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
    : '—'

  return (
    <div className="space-y-5 p-3 md:p-4 max-w-5xl mx-auto">
      {/* Header Banner */}
      <Card className="relative overflow-hidden">
        {/* Gradient Banner */}
        <div className="h-32 bg-gradient-to-br from-primary/30 via-primary/10 to-transparent" />
        <CardContent className="p-0">
          <div className="px-6 pb-6 -mt-12">
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
              {/* Avatar */}
              <div className="relative">
                <Avatar className="size-24 border-4 border-background shadow-lg">
                  {avatarUrl ? (
                    <AvatarImage src={avatarUrl} alt="Profile" className="object-cover" />
                  ) : (
                    <AvatarFallback className="bg-primary text-primary-foreground text-3xl font-bold">
                      {profileForm.name.charAt(0)?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  )}
                </Avatar>
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute bottom-0 right-0 size-7 rounded-full shadow-md"
                  disabled={uploadingPhoto}
                  onClick={() => avatarInputRef.current?.click()}
                  title="Upload profile photo"
                >
                  {uploadingPhoto ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
                </Button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleAvatarSelect(file)
                    e.target.value = ''
                  }}
                />
              </div>

              {/* Identity */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-2xl font-bold truncate">{profileForm.name || 'User'}</h2>
                  <Badge className={cn('text-xs', subscriptionColor)}>{subscriptionBadge}</Badge>
                  {user?.isEmailVerified && (
                    <Badge variant="outline" className="text-xs text-emerald-500 border-emerald-500/30">
                      <Check className="size-3 mr-1" /> Verified
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate mt-0.5">{user?.email}</p>
                {profileForm.bio && (
                  <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{profileForm.bio}</p>
                )}
                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                  {user?.country && (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" /> {user.country}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="size-3" /> Member since {memberSince}
                  </span>
                  <span className="flex items-center gap-1">
                    <Globe className="size-3" /> {(user?.language || 'en').toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                {!isEditing ? (
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsEditing(true)}>
                    <Edit3 className="size-4" /> Edit Profile
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" size="sm" className="gap-2" onClick={handleCancel} disabled={isSaving}>
                      <X className="size-4" /> Cancel
                    </Button>
                    <Button size="sm" className="gap-2" onClick={handleSave} disabled={isSaving}>
                      {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                      {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  onClick={() => setPage('settings')}
                >
                  <SettingsIcon className="size-4" /> Settings
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit Form (conditional) */}
      {isEditing && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Edit Profile Information</CardTitle>
            <CardDescription>Update your personal details and bio</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profile-name">Full Name</Label>
                <Input
                  id="profile-name"
                  value={profileForm.name}
                  onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-phone">Phone</Label>
                <Input
                  id="profile-phone"
                  type="tel"
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-dob">Date of Birth</Label>
                <Input
                  id="profile-dob"
                  type="date"
                  value={profileForm.dateOfBirth}
                  onChange={(e) => setProfileForm((p) => ({ ...p, dateOfBirth: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-country">Country</Label>
                <Input
                  id="profile-country"
                  value={profileForm.country}
                  onChange={(e) => setProfileForm((p) => ({ ...p, country: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-bio">Bio</Label>
              <Textarea
                id="profile-bio"
                rows={3}
                placeholder="Tell other traders a bit about yourself..."
                value={profileForm.bio}
                onChange={(e) => setProfileForm((p) => ({ ...p, bio: e.target.value }))}
                maxLength={280}
              />
              <p className="text-xs text-muted-foreground text-right">{profileForm.bio.length}/280</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Signals Tracked" value={String(profileData.stats.signalsTracked)} sublabel="Accepted signals" icon={TrendingUp} accent="bg-primary/10 text-primary" />
        <StatCard label="Win Rate" value={`${profileData.stats.winRate}%`} sublabel={`${profileData.stats.trades} closed trades`} icon={Target} accent="bg-emerald-500/10 text-emerald-500" />
        <StatCard label="Avg. Return / Trade" value={profileData.stats.avgReturn > 0 ? `+${profileData.stats.avgReturn}%` : `${profileData.stats.avgReturn}%`} sublabel="Closed trades" icon={BarChart3} accent="bg-blue-500/10 text-blue-500" />
        <StatCard label="Badges Unlocked" value={String(profileData.achievements.length)} sublabel="Achievements" icon={Award} accent="bg-amber-500/10 text-amber-500" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column - Account Details + Recent Activity */}
        <div className="lg:col-span-2 space-y-6">
          {/* Account Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <UserIcon className="size-5" /> Account Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <Mail className="size-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="text-sm font-medium truncate">{user?.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <Phone className="size-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="text-sm font-medium truncate">{user?.phone || 'Not set'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <Shield className="size-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">2FA</p>
                    <p className="text-sm font-medium">{user?.twoFactorEnabled ? 'Enabled' : 'Disabled'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <Crown className="size-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Plan</p>
                    <p className="text-sm font-medium capitalize">{user?.subscriptionTier || 'free'}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <Globe className="size-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Trading Preferences</p>
                  <p className="text-sm font-medium">
                    {[user?.tradingStyle, user?.riskLevel, user?.preferredMarkets?.split(',').join(' · ')]
                      .filter(Boolean)
                      .join(' · ') || 'Not configured'}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setPage('settings')}>
                  <SettingsIcon className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="size-5" /> Recent Activity
              </CardTitle>
              <CardDescription>Your latest trading actions and events</CardDescription>
            </CardHeader>
            <CardContent>
              {profileDataLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : profileData.recentActivity.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Activity className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No recent activity yet</p>
                </div>
              ) : (
              <div className="space-y-3">
                {profileData.recentActivity.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
                    <ActivityDot action={item.action} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium truncate">{activityLabel(item.action)}</p>
                        <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                          <Clock className="size-3" /> {new Date(item.time).toLocaleString()}
                        </span>
                      </div>
                      {item.detail && <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>}
                    </div>
                  </div>
                ))}
              </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column - Referral + Achievements + Privacy */}
        <div className="space-y-6">
          {/* Referral Code */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Gift className="size-5" /> Refer & Earn
              </CardTitle>
              <CardDescription>Share your code, get rewards</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Your referral link</p>
                <p className="text-sm font-semibold break-all text-primary">{referralLink()}</p>
                <p className="text-xl font-bold tracking-wider font-mono mt-2">{user?.referralCode || 'N/A'}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={handleCopyReferral}
              >
                {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
                {copied ? 'Copied!' : 'Copy Link'}
              </Button>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg border bg-card/50 p-2">
                  <p className="text-lg font-bold">{user?.referralCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Referrals</p>
                </div>
                <div className="rounded-lg border bg-card/50 p-2">
                  <p className="text-lg font-bold">{user?.earnedPremiumDays || 0}</p>
                  <p className="text-xs text-muted-foreground">Premium Days Earned</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Earn 7 free Premium days for every friend who registers with your link, plus 1 month free when they upgrade.
              </p>
            </CardContent>
          </Card>

          {/* Achievements */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Award className="size-5" /> Achievements
              </CardTitle>
              <CardDescription>
                {profileData.achievements.length} badge{profileData.achievements.length === 1 ? '' : 's'} unlocked
              </CardDescription>
            </CardHeader>
            <CardContent>
              {profileDataLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : profileData.achievements.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No badges yet. Complete lessons and hit milestones to earn badges.
                </p>
              ) : (
              <div className="grid grid-cols-3 gap-3">
                {profileData.achievements.map((ach) => {
                  const style = badgeStyle(ach.badgeType)
                  const Icon = style.icon
                  return (
                    <div
                      key={ach.id}
                      className="flex flex-col items-center gap-1 p-3 rounded-lg text-center bg-card border"
                      title={ach.badgeName}
                    >
                      <div className={cn('flex size-9 items-center justify-center rounded-full', style.color)}>
                        <Icon className="size-4" />
                      </div>
                      <span className="text-[10px] font-medium leading-tight">{ach.badgeName}</span>
                    </div>
                  )
                })}
              </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Privacy Snapshot */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="size-5" /> Privacy Snapshot
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Profile visibility</span>
                <Badge variant="outline" className="capitalize">{user?.privacy?.profileVisibility || 'community'}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Online status</span>
                <Badge variant="outline" className={user?.privacy?.showOnlineStatus ? 'text-emerald-500' : 'text-muted-foreground'}>
                  {user?.privacy?.showOnlineStatus ? 'Visible' : 'Hidden'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Leaderboards</span>
                <Badge variant="outline" className={user?.privacy?.appearOnLeaderboards ? 'text-emerald-500' : 'text-muted-foreground'}>
                  {user?.privacy?.appearOnLeaderboards ? 'On' : 'Off'}
                </Badge>
              </div>
              <Separator className="my-2" />
              <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => setPage('settings')}>
                Manage Privacy
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <div className="pt-4 border-t border-border/50">
        <PoweredBy />
      </div>
    </div>
  )
}

export default ProfilePage
