'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Lock, Fingerprint, Loader2, ShieldCheck } from 'lucide-react'
import { verifyPasscode, unlockWithBiometric } from '@/lib/security/app-lock'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

interface AppLockScreenProps {
  onUnlock: () => void
}

const PIN_LENGTH = 4

export function AppLockScreen({ onUnlock }: AppLockScreenProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [checking, setChecking] = useState(false)
  const [biometricRunning, setBiometricRunning] = useState(false)
  const [biometricAvailable, setBiometricAvailable] = useState(false)

  useEffect(() => {
    let mounted = true
    if (
      window.PublicKeyCredential &&
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    ) {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then((avail) => mounted && setBiometricAvailable(avail))
        .catch(() => mounted && setBiometricAvailable(false))
    }
    return () => {
      mounted = false
    }
  }, [])

  const handleBiometric = useCallback(async () => {
    if (biometricRunning) return
    setBiometricRunning(true)
    try {
      const ok = await unlockWithBiometric()
      if (ok) onUnlock()
      else toast.error('Biometric unlock cancelled')
    } finally {
      setBiometricRunning(false)
    }
  }, [biometricRunning, onUnlock])

  const submit = useCallback(async () => {
    const code = pin.trim()
    if (code.length < PIN_LENGTH) {
      toast.error('Enter your 4-digit passcode')
      return
    }
    setChecking(true)
    try {
      const ok = await verifyPasscode(code)
      if (ok) {
        setError(false)
        setAttempts(0)
        onUnlock()
      } else {
        setError(true)
        setAttempts((a) => a + 1)
        setPin('')
        toast.error('Incorrect passcode')
      }
    } finally {
      setChecking(false)
    }
  }, [pin, onUnlock])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') submit()
    },
    [submit]
  )

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="w-full max-w-xs space-y-8 px-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="flex size-16 items-center justify-center rounded-2xl bg-primary/10"
          >
            {error ? (
              <ShieldCheck className="size-8 text-destructive" />
            ) : (
              <Lock className="size-8 text-primary" />
            )}
          </motion.div>
          <h1 className="text-lg font-semibold">App Locked</h1>
          <p className="text-sm text-muted-foreground">
            {error ? (
              <>Incorrect passcode. {attempts >= 3 ? `${attempts} failed attempts.` : 'Try again.'}</>
            ) : (
              'Enter your passcode to unlock the app'
            )}
          </p>
        </div>

        <div className="space-y-4">
          <Input
            id="applock-input"
            type="password"
            inputMode="numeric"
            maxLength={PIN_LENGTH}
            placeholder="••••"
            autoFocus
            aria-label="4-digit passcode"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))
              setError(false)
            }}
            onKeyDown={handleKeyDown}
            disabled={checking}
            className={`text-center text-2xl tracking-[0.5em] ${error ? 'border-destructive' : ''}`}
          />
          <Button
            type="button"
            className="w-full"
            disabled={checking || pin.length < PIN_LENGTH}
            onClick={submit}
          >
            {checking ? <Loader2 className="size-4 animate-spin" /> : 'Unlock'}
          </Button>

          {biometricAvailable && (
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={handleBiometric}
              disabled={biometricRunning}
            >
              {biometricRunning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Fingerprint className="size-4" />
              )}
              Unlock with Biometric
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  )
}