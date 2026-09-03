'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Lock, Fingerprint, Loader2, Smartphone, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  getConfig,
  setConfig,
  setPasscode,
  verifyPasscode,
  hasPasscode,
  disableAppLock,
  type AppLockConfig,
} from '@/lib/security/app-lock'
import { useAppLock } from '@/components/auth/app-lock-provider'
import { toast } from 'sonner'

const PIN_LENGTH = 4

export function AppLockPanel() {
  const { lockNow } = useAppLock()
  const [config, setConfigState] = useState<AppLockConfig>(() => getConfig())
  const [mode, setMode] = useState<'idle' | 'setup' | 'verify' | 'change'>('idle')
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [disabling, setDisabling] = useState(false)

  const refreshConfig = useCallback(() => {
    setConfigState(getConfig())
  }, [])

  useEffect(refreshConfig, [refreshConfig])

  const normalizedPin = (value: string) => value.replace(/\D/g, '').slice(0, PIN_LENGTH)

  const saveConfig = useCallback(
    (next: AppLockConfig) => {
      setConfig(next)
      setConfigState(next)
    },
    []
  )

  const handleToggle = async (enabled: boolean) => {
    if (enabled) {
      // Turning on — require a passcode to be set first (or keep existing).
      if (!hasPasscode()) {
        setMode('setup')
        setEnabling(true)
        return
      }
      // Already has a passcode — ask to verify ownership before re-enabling.
      setMode('verify')
      setEnabling(true)
      return
    }
    // Turning off — require verification before disabling.
    setMode('verify')
    setDisabling(true)
  }

  const handleVerify = async () => {
    if (confirmPin.length < PIN_LENGTH) {
      toast.error('Enter your 4-digit passcode')
      return
    }
    setSaving(true)
    try {
      const ok = await verifyPasscode(confirmPin)
      if (!ok) {
        toast.error('Incorrect passcode')
        setConfirmPin('')
        return
      }
      if (disabling) {
        disableAppLock()
        refreshConfig()
        saveConfig({ enabled: false, biometricEnabled: false, createdAt: null })
        toast.success('App lock disabled')
      } else if (enabling) {
        saveConfig({ ...getConfig(), enabled: true })
        toast.success('App lock enabled')
        lockNow()
      }
      setMode('idle')
      setConfirmPin('')
      setEnabling(false)
      setDisabling(false)
    } finally {
      setSaving(false)
    }
  }

  const handleSetup = async () => {
    if (pin1.length < PIN_LENGTH) {
      toast.error('Passcode must be 4 digits')
      return
    }
    if (pin1 !== pin2) {
      toast.error('Passcodes do not match')
      return
    }
    setSaving(true)
    try {
      const ok = await setPasscode(pin1)
      if (!ok) {
        toast.error('Could not save passcode')
        return
      }
      saveConfig({ enabled: true, biometricEnabled: false, createdAt: new Date().toISOString() })
      setPin1('')
      setPin2('')
      setMode('idle')
      toast.success('App lock enabled')
      lockNow()
    } finally {
      setSaving(false)
    }
  }

  const handleChange = async () => {
    if (confirmPin.length < PIN_LENGTH || pin1.length < PIN_LENGTH) {
      toast.error('Enter your current and new passcode')
      return
    }
    if (pin1 !== pin2) {
      toast.error('New passcodes do not match')
      return
    }
    setSaving(true)
    try {
      const ok = await verifyPasscode(confirmPin)
      if (!ok) {
        toast.error('Incorrect current passcode')
        setConfirmPin('')
        return
      }
      const saved = await setPasscode(pin1)
      if (!saved) {
        toast.error('Could not update passcode')
        return
      }
      setConfirmPin('')
      setPin1('')
      setPin2('')
      setMode('idle')
      toast.success('Passcode updated')
    } finally {
      setSaving(false)
    }
  }

  const toggleBiometric = (on: boolean) => {
    saveConfig({ ...getConfig(), biometricEnabled: on })
    toast.success(on ? 'Biometric unlock enabled' : 'Biometric unlock disabled')
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-primary/10">
            <Lock className="size-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">App Lock</CardTitle>
            <CardDescription>
              Lock this app with a passcode when it opens or returns from the background.
            </CardDescription>
          </div>
        </div>
        <Switch checked={config.enabled} onCheckedChange={handleToggle} aria-label="Enable app lock" />
      </CardHeader>

      <CardContent className="space-y-4">
        {config.enabled && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            App is protected. It will lock on every open and background.
          </div>
        )}

        {/* Biometric toggle — only meaningful when lock is enabled */}
        {config.enabled && (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <Fingerprint className="size-4 text-primary" />
              <div>
                <p className="text-sm font-medium">Unlock with biometric</p>
                <p className="text-xs text-muted-foreground">
                  Skip the passcode using your fingerprint / face
                </p>
              </div>
            </div>
            <Switch
              checked={config.biometricEnabled}
              onCheckedChange={toggleBiometric}
              aria-label="Enable biometric unlock"
            />
          </div>
        )}

        {/* Mode: setup / verify / change */}
        {mode === 'setup' && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-2">
              <Label>New passcode</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={PIN_LENGTH}
                placeholder="••••"
                value={pin1}
                onChange={(e) => setPin1(normalizedPin(e.target.value))}
                className="text-center text-lg tracking-[0.5em]"
              />
            </div>
            <div className="space-y-2">
              <Label>Confirm passcode</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={PIN_LENGTH}
                placeholder="••••"
                value={pin2}
                onChange={(e) => setPin2(normalizedPin(e.target.value))}
                className="text-center text-lg tracking-[0.5em]"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSetup} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="size-4 animate-spin" /> : 'Enable app lock'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setMode('idle')
                  setEnabling(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {mode === 'verify' && (
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              {disabling
                ? 'Enter your passcode to disable app lock.'
                : 'Enter your passcode to proceed.'}
            </p>
            <div className="space-y-2">
              <Label>Current passcode</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={PIN_LENGTH}
                placeholder="••••"
                value={confirmPin}
                onChange={(e) => setConfirmPin(normalizedPin(e.target.value))}
                className="text-center text-lg tracking-[0.5em]"
                onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleVerify} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="size-4 animate-spin" /> : 'Confirm'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setMode('idle')
                  setEnabling(false)
                  setDisabling(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {config.enabled && hasPasscode() && mode === 'idle' && (
          <Button variant="outline" onClick={() => setMode('change')}>
            Change passcode
          </Button>
        )}

        {mode === 'change' && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-2">
              <Label>Current passcode</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={PIN_LENGTH}
                placeholder="••••"
                value={confirmPin}
                onChange={(e) => setConfirmPin(normalizedPin(e.target.value))}
                className="text-center text-lg tracking-[0.5em]"
              />
            </div>
            <div className="space-y-2">
              <Label>New passcode</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={PIN_LENGTH}
                placeholder="••••"
                value={pin1}
                onChange={(e) => setPin1(normalizedPin(e.target.value))}
                className="text-center text-lg tracking-[0.5em]"
              />
            </div>
            <div className="space-y-2">
              <Label>Confirm new passcode</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={PIN_LENGTH}
                placeholder="••••"
                value={pin2}
                onChange={(e) => setPin2(normalizedPin(e.target.value))}
                className="text-center text-lg tracking-[0.5em]"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleChange} disabled={saving} className="flex-1">
                {saving ? <Loader2 className="size-4 animate-spin" /> : 'Update passcode'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setMode('idle')
                  setPin1('')
                  setPin2('')
                  setConfirmPin('')
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Smartphone className="size-3.5" />
          Stored securely on this device. Locked on open, return-from-background, and manual lock.
        </div>
      </CardContent>
    </Card>
  )
}