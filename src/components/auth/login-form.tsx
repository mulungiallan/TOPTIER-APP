'use client'

import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Eye, EyeOff, Fingerprint } from 'lucide-react'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { PoweredBy } from '@/components/branding/powered-by'
import { BiometricService, getStoredCredentialIds } from '@/lib/security/biometric'
import { toast } from 'sonner'

interface LoginFormProps {
  onSwitchToRegister: () => void
}

export function LoginForm({ onSwitchToRegister }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [sendingReset, setSendingReset] = useState(false)
  const [biometricSigningIn, setBiometricSigningIn] = useState(false)
  const [hasBiometric, setHasBiometric] = useState(false)
  const login = useStore((s) => s.login)
  const setPage = useStore((s) => s.setPage)

  useEffect(() => {
    if (!BiometricService.isSupported()) return
    setHasBiometric(getStoredCredentialIds().length > 0)
  }, [])

  const handleBiometricLogin = async () => {
    const credentialIds = getStoredCredentialIds()
    if (credentialIds.length === 0) {
      toast.error('No biometric registered on this device. Sign in and register one in Settings → Biometric.')
      return
    }
    setBiometricSigningIn(true)
    try {
      const credentialId = credentialIds[0]
      const begin = await fetch('/api/security/biometric/authenticate/begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId }),
      })
      const beginData = await begin.json()
      if (!begin.ok) {
        toast.error(beginData.error || 'Biometric sign-in failed')
        return
      }

      const assertion = await BiometricService.verify(credentialId, beginData.data?.challenge)

      const res = await fetch('/api/security/biometric/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assertion),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Biometric sign-in failed')
        return
      }

      login(data.data.user, data.data.token)
      toast.success('Welcome back!')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Biometric sign-in failed')
    } finally {
      setBiometricSigningIn(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    const target = forgotEmail.trim()
    if (!target) {
      toast.error('Please enter your account email')
      return
    }
    setSendingReset(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to send reset link')
        return
      }
      toast.success('If an account exists for that email, a reset link has been sent.')
      setForgotOpen(false)
      setForgotEmail('')
    } catch {
      toast.error('Could not connect to the server. Please try again.')
    } finally {
      setSendingReset(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email.trim()) {
      toast.error('Please enter your email')
      return
    }
    if (!password.trim()) {
      toast.error('Please enter your password')
      return
    }

    setIsLoading(true)

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', email: email.trim(), password }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Login failed')
        return
      }

      login(data.data.user, data.data.token)
      toast.success('Welcome back!')
    } catch (error) {
      toast.error('Could not connect to server. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-2xl font-bold">Sign In</CardTitle>
          <CardDescription>
            Enter your credentials to access your account
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                placeholder="trader@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="login-password">Password</Label>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setForgotOpen(!forgotOpen)}
                >
                  Forgot password?
                </button>
              </div>
              {forgotOpen && (
                <form onSubmit={handleForgotPassword} className="space-y-2 rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    Enter your account email and we&apos;ll send a password reset link.
                  </p>
                  <Input
                    type="email"
                    placeholder="account@example.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    disabled={sendingReset}
                    autoComplete="email"
                  />
                  <Button type="submit" size="sm" className="w-full" disabled={sendingReset}>
                    {sendingReset ? <Loader2 className="size-3.5 animate-spin" /> : 'Send Reset Link'}
                  </Button>
                </form>
              )}
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  autoComplete="current-password"
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
                  Signing In...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
            {hasBiometric && (
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={handleBiometricLogin}
                disabled={biometricSigningIn}
              >
                {biometricSigningIn ? <Loader2 className="size-4 animate-spin" /> : <Fingerprint className="size-4" />}
                Sign in with Biometric
              </Button>
            )}
            <p className="text-sm text-muted-foreground text-center">
              Don&apos;t have an account?{' '}
              <button
                type="button"
                className="text-primary font-medium hover:underline"
                onClick={onSwitchToRegister}
              >
                Sign Up
              </button>
            </p>
            <PoweredBy className="pt-2" />
          </CardFooter>
        </form>
      </Card>
    </motion.div>
  )
}
