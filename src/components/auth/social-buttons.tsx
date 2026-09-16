'use client'

import React, { useState, useCallback, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface SocialUser {
  id: string
  email: string
  name: string | null
  role: string
  subscriptionTier: string
  referralCode: string
  referralCount: number
  earnedPremiumDays: number
  onboardingCompleted: boolean
  onboardingStep: number
  darkMode: boolean
  tradingStyle: string | null
  riskLevel: string | null
  preferredMarkets: string | null
  preferredSessions: string | null
  phone: string | null
  profilePicture: string | null
  dateOfBirth: string | null
  country: string | null
  language: string
  isEmailVerified: boolean
  twoFactorEnabled: boolean
}

interface SocialButtonsProps {
  onSuccess: (user: SocialUser, token: string) => void
  disabled?: boolean
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void
          prompt: (callback?: (notification: { notDisplayed?: boolean; skippable?: boolean; moment?: string }) => void) => void
        }
      }
    }
    AppleID?: {
      auth: {
        signIn: () => Promise<{ authorization: { id_token: string }; user?: { name?: { firstName?: string; lastName?: string }; email?: string } }>
        init: (config: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }) => void
      }
    }
  }
}

function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) return resolve()
    const script = document.createElement('script')
    script.id = id
    script.src = src
    script.crossOrigin = 'anonymous'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
    document.head.appendChild(script)
  })
}

export function SocialButtons({ onSuccess, disabled = false }: SocialButtonsProps) {
  const [loading, setLoading] = useState<'google' | 'apple' | null>(null)
  const googleInitRef = useRef(false)

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
  const appleClientId = process.env.NEXT_PUBLIC_APPLE_CLIENT_ID || ''
  const showGoogle = !!googleClientId
  const showApple = !!appleClientId

  const handleSocialLogin = useCallback(async (provider: 'google' | 'apple', token: string, name?: string) => {
    setLoading(provider)
    try {
      const res = await fetch('/api/auth/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, token, name }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || `${provider} login failed`)
        return
      }

      onSuccess(data.data.user, data.data.token)
      toast.success(`Signed in with ${provider === 'google' ? 'Google' : 'Apple'}!`)
    } catch {
      toast.error('Could not connect to server. Please try again.')
    } finally {
      setLoading(null)
    }
  }, [onSuccess])

  const handleGoogleClick = useCallback(async () => {
    if (loading) return
    setLoading('google')
    try {
      await loadScript('https://accounts.google.com/gsi/client', 'google-signin-script')
      if (!window.google?.accounts?.id) {
        toast.error('Google Sign-In failed to load')
        setLoading(null)
        return
      }

      if (!googleInitRef.current) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response) => {
            if (response.credential) {
              const credentialPayload = response.credential.split('.')[1]
              const payload = JSON.parse(atob(credentialPayload)) as { name?: string }
              void handleSocialLogin('google', response.credential, payload.name)
            } else {
              setLoading(null)
            }
          },
        })
        googleInitRef.current = true
      }

      window.google.accounts.id.prompt()
    } catch {
      toast.error('Google Sign-In failed to load')
      setLoading(null)
    }
  }, [googleClientId, handleSocialLogin, loading])

  const handleAppleClick = useCallback(async () => {
    if (loading) return
    setLoading('apple')
    try {
      await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js', 'apple-signin-script')

      if (!window.AppleID) {
        toast.error('Apple Sign-In failed to load')
        setLoading(null)
        return
      }

      window.AppleID.auth.init({
        clientId: appleClientId,
        scope: 'name email',
        redirectURI: typeof window !== 'undefined' ? window.location.origin : '',
        usePopup: true,
      })

      const response = await window.AppleID.auth.signIn()
      const idToken = response.authorization?.id_token
      if (!idToken) {
        toast.error('Apple Sign-In did not return a token')
        setLoading(null)
        return
      }

      let appleName: string | undefined
      if (response.user?.name?.firstName || response.user?.name?.lastName) {
        appleName = [response.user.name.firstName, response.user.name.lastName].filter(Boolean).join(' ')
      }

      void handleSocialLogin('apple', idToken, appleName)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('popup_closed_by_user') || msg.includes('cancelled')) {
        setLoading(null)
        return
      }
      toast.error('Apple Sign-In failed')
      setLoading(null)
    }
  }, [appleClientId, handleSocialLogin, loading])

  if (!showGoogle && !showApple) return null

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or continue with</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {showGoogle && (
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            onClick={handleGoogleClick}
            disabled={disabled || loading !== null}
          >
            {loading === 'google' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            )}
            Google
          </Button>
        )}

        {showApple && (
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            onClick={handleAppleClick}
            disabled={disabled || loading !== null}
          >
            {loading === 'apple' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
            )}
            Apple
          </Button>
        )}
      </div>
    </div>
  )
}