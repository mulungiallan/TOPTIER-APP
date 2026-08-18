'use client'

import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Eye, EyeOff, Play } from 'lucide-react'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { PoweredBy } from '@/components/branding/powered-by'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { COUNTRIES } from '@/lib/countries'
import { toast } from 'sonner'

interface RegisterFormProps {
  onSwitchToLogin: () => void
}

export function RegisterForm({ onSwitchToLogin }: RegisterFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [country, setCountry] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { login } = useStore()

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref')
    if (ref) setReferralCode(ref)
  }, [])

  const handleDemoMode = () => {
    const demoUser: import('@/lib/store').User = {
      id: 'demo-user-001',
      email: 'demo@toptier.app',
      name: 'Demo Trader',
      role: 'user',
      subscriptionTier: 'pro',
      referralCode: 'DEMO2024',
      onboardingCompleted: true,
      onboardingStep: 7,
      darkMode: true,
      tradingStyle: 'swing',
      riskLevel: 'moderate',
      preferredMarkets: 'forex,crypto',
      preferredSessions: 'european,us',
      phone: null,
      profilePicture: null,
      dateOfBirth: '1995-06-15',
      country: 'Kenya',
      language: 'en',
      isEmailVerified: true,
      twoFactorEnabled: false,
      bio: 'Demo trader exploring AI-powered markets.',
      maxConcurrentSessions: 2,
      activeSessionCount: 1,
      privacy: {
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
      },
    }
    login(demoUser, 'demo-token-001')
  }

  const is18Plus = (dob: string): boolean => {
    if (!dob) return false
    const birthDate = new Date(dob)
    const today = new Date()
    const age = today.getFullYear() - birthDate.getFullYear()
    const monthDiff = today.getMonth() - birthDate.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      return age - 1 >= 18
    }
    return age >= 18
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('Please enter your full name')
      return
    }
    if (!email.trim()) {
      toast.error('Please enter your email')
      return
    }
    if (!password || password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (!dateOfBirth) {
      toast.error('Please enter your date of birth')
      return
    }
    if (!is18Plus(dateOfBirth)) {
      toast.error('You must be at least 18 years old to register')
      return
    }
    if (!country) {
      toast.error('Please select your country')
      return
    }
    if (!agreeTerms) {
      toast.error('You must agree to the Terms of Service')
      return
    }
    if (!acknowledgeRisk) {
      toast.error('You must acknowledge the risk disclaimer')
      return
    }

    setIsLoading(true)

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          name,
          email,
          password,
          dateOfBirth,
          country,
          referralCode: referralCode || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Registration failed')
        return
      }

      login(data.data.user, data.data.token)
      toast.success('Account created successfully! Welcome aboard!')
    } catch (error) {
      toast.error('Could not connect to server. Try Demo Mode or set up the database first.', {
        action: {
          label: 'Demo Mode',
          onClick: handleDemoMode,
        },
        duration: 6000,
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-2xl font-bold">Create Account</CardTitle>
          <CardDescription>
            Join thousands of traders using AI-powered signals
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {/* Full Name */}
            <div className="space-y-2">
              <Label htmlFor="reg-name">Full Name</Label>
              <Input
                id="reg-name"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="reg-email">Email</Label>
              <Input
                id="reg-email"
                type="email"
                placeholder="trader@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="reg-password">Password</Label>
              <div className="relative">
                <Input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="reg-confirm-password">Confirm Password</Label>
              <Input
                id="reg-confirm-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="new-password"
              />
            </div>

            {/* Date of Birth */}
            <div className="space-y-2">
              <Label htmlFor="reg-dob">Date of Birth</Label>
              <Input
                id="reg-dob"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                disabled={isLoading}
                max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}
              />
              <p className="text-xs text-muted-foreground">You must be at least 18 years old</p>
            </div>

            {/* Country */}
            <div className="space-y-2">
              <Label htmlFor="reg-country">Country</Label>
              <Select value={country} onValueChange={setCountry} disabled={isLoading}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select your country" />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Referral Code */}
            <div className="space-y-2">
              <Label htmlFor="reg-referral">Referral Code (optional)</Label>
              <Input
                id="reg-referral"
                type="text"
                placeholder="e.g. TRADER2026"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Invited by a friend? Enter their code to activate your referral link.
              </p>
            </div>

            {/* Terms Checkbox */}
            <div className="flex items-start gap-2 space-x-2">
              <Checkbox
                id="reg-terms"
                checked={agreeTerms}
                onCheckedChange={(checked) => setAgreeTerms(checked === true)}
                disabled={isLoading}
                className="mt-0.5"
              />
              <Label htmlFor="reg-terms" className="text-xs font-normal leading-relaxed cursor-pointer">
                I agree to the{' '}
                <span className="text-primary hover:underline cursor-pointer">Terms of Service</span>
                {' '}and{' '}
                <span className="text-primary hover:underline cursor-pointer">Privacy Policy</span>
              </Label>
            </div>

            {/* Risk Disclaimer Checkbox */}
            <div className="flex items-start gap-2 space-x-2">
              <Checkbox
                id="reg-risk"
                checked={acknowledgeRisk}
                onCheckedChange={(checked) => setAcknowledgeRisk(checked === true)}
                disabled={isLoading}
                className="mt-0.5"
              />
              <Label htmlFor="reg-risk" className="text-xs font-normal leading-relaxed cursor-pointer">
                I acknowledge the risk disclaimer: Trading involves substantial risk of loss and is not suitable for all investors. Past performance is not indicative of future results.
              </Label>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating Account...
                </>
              ) : (
                'Create Account'
              )}
            </Button>
            <div className="relative">
              <Separator className="my-4" />
              <div className="flex items-center justify-center">
                <span className="bg-card px-3 text-xs text-muted-foreground absolute -top-2.5">or</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={handleDemoMode}
            >
              <Play className="size-4" />
              Try Demo Mode
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              Already have an account?{' '}
              <button
                type="button"
                className="text-primary font-medium hover:underline"
                onClick={onSwitchToLogin}
              >
                Sign In
              </button>
            </p>
            <PoweredBy className="pt-2" />
          </CardFooter>
        </form>
      </Card>
    </motion.div>
  )
}
