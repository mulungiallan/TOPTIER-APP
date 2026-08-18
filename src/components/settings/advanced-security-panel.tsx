'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Fingerprint, Bell, Loader2, Check, Trash2, Shield, Smartphone } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { BiometricService, rememberCredential, forgetCredential } from '@/lib/security/biometric'
import { PushNotificationService } from '@/lib/services/push-notification'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface BiometricCred {
  id: string
  credentialId: string
  nickname: string | null
  deviceType: string | null
  createdAt: string
  lastUsedAt: string | null
}

export function AdvancedSecurityPanel() {
  const { user } = useStore()
  const [biometricSupported, setBiometricSupported] = useState(false)
  const [platformAuthAvailable, setPlatformAuthAvailable] = useState(false)
  const [creds, setCreds] = useState<BiometricCred[]>([])
  const [registering, setRegistering] = useState(false)
  const [nickname, setNickname] = useState('')
  const [pushSupported, setPushSupported] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [togglingPush, setTogglingPush] = useState(false)

  // Check feature support + load existing creds on mount
  useEffect(() => {
    setBiometricSupported(BiometricService.isSupported())
    BiometricService.isPlatformAuthenticatorAvailable().then(setPlatformAuthAvailable)
    setPushSupported(PushNotificationService.isSupported())
    PushNotificationService.getPermissionState().then(setPushPermission)
    fetchCreds()
  }, [])

  const fetchCreds = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: { credentials: BiometricCred[] } }>('/security/biometric')
      setCreds(res?.data?.credentials || [])
    } catch {
      setCreds([])
    }
  }, [])

  // ─── Biometric registration ────────────────────────────────────────────────
  const handleRegisterBiometric = async () => {
    if (!user?.id) {
      toast.error('Please sign in first')
      return
    }
    setRegistering(true)
    try {
      // 1. Get a server-issued, single-use challenge
      const begin = await api.post<{ success: boolean; data: { challenge: string } }>(
        '/security/biometric/register/begin',
        {}
      )
      const challenge = begin?.data?.challenge
      if (!challenge) {
        throw new Error('Server did not issue a challenge')
      }

      // 2. Create the credential in the browser with that challenge
      const result = await BiometricService.register(user.id, nickname || undefined, challenge)

      // 3. Send the public key + assertion data back for server-side verification
      await api.post('/security/biometric', result)
      rememberCredential(result.credentialId)

      toast.success('Biometric credential registered!')
      setNickname('')
      fetchCreds()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed'
      toast.error(msg)
    } finally {
      setRegistering(false)
    }
  }

  // ─── Test sign-in with a registered credential ───────────────────────────
  const [testing, setTesting] = useState(false)

  const handleTestBiometric = async () => {
    if (creds.length === 0) {
      toast.error('Register a credential first')
      return
    }
    setTesting(true)
    try {
      const begin = await api.post<{ success: boolean; data: { challenge: string } }>(
        '/security/biometric/authenticate/begin',
        { credentialId: creds[0].credentialId }
      )
      const assertion = await BiometricService.verify(creds[0].credentialId, begin?.data?.challenge)
      await api.post('/security/biometric/authenticate', assertion)
      toast.success('Biometric sign-in verified successfully!')
      fetchCreds()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Biometric verification failed'
      toast.error(msg)
    } finally {
      setTesting(false)
    }
  }

  const handleDeleteBiometric = async (id: string, credentialId: string) => {
    try {
      await api.delete(`/security/biometric?id=${id}`) as any
      forgetCredential(credentialId)
      toast.success('Credential removed')
      fetchCreds()
    } catch {
      toast.error('Failed to remove')
    }
  }

  // ─── Push notifications ────────────────────────────────────────────────────
  const handleTogglePush = async (enabled: boolean) => {
    setTogglingPush(true)
    try {
      if (enabled) {
        if (!user?.id) {
          toast.error('Please sign in first')
          return
        }
        const sub = await PushNotificationService.subscribe(user.id)
        if (sub) {
          setPushEnabled(true)
          toast.success('Push notifications enabled')
        } else {
          toast.error('Failed to enable push (check permissions)')
          return
        }
      } else {
        await PushNotificationService.unsubscribe()
        setPushEnabled(false)
        toast.success('Push notifications disabled')
      }
    } finally {
      setTogglingPush(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Biometric Auth */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Fingerprint className="h-4 w-4 text-emerald-500" /> Biometric Authentication</CardTitle>
          <CardDescription>
            Sign in faster with Touch ID, Face ID, Windows Hello, or a security key. Uses WebAuthn.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!biometricSupported ? (
            <div className="p-3 rounded-md bg-amber-500/5 border border-amber-500/30 text-sm">
              <Shield className="h-4 w-4 inline mr-1 text-amber-500" />
              WebAuthn is not supported in this browser.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                <div>
                  <div className="text-sm font-medium">Platform authenticator</div>
                  <div className="text-xs text-muted-foreground">
                    {platformAuthAvailable
                      ? 'Touch ID / Face ID / Windows Hello available'
                      : 'No platform authenticator detected — security keys will work'}
                  </div>
                </div>
                <Badge variant={platformAuthAvailable ? 'default' : 'outline'} className="text-[10px]">
                  {platformAuthAvailable ? 'Available' : 'Limited'}
                </Badge>
              </div>

              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label>Nickname (optional)</Label>
                  <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. MacBook Touch ID" />
                </div>
                <Button onClick={handleRegisterBiometric} disabled={registering}>
                  {registering ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Fingerprint className="h-4 w-4 mr-1.5" />}
                  Register
                </Button>
                {creds.length > 0 && (
                  <Button variant="outline" onClick={handleTestBiometric} disabled={testing} title="Prompt this device's authenticator and verify the signature server-side">
                    {testing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Shield className="h-4 w-4 mr-1.5" />}
                    Test Sign-In
                  </Button>
                )}
              </div>

              {creds.length > 0 && (
                <div className="space-y-2">
                  <Label>Registered credentials ({creds.length})</Label>
                  {creds.map((c) => (
                    <div key={c.id} className="flex items-center justify-between p-2 rounded-md border bg-card/50">
                      <div className="flex items-center gap-2">
                        <Smartphone className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium">{c.nickname || 'Unnamed authenticator'}</div>
                          <div className="text-xs text-muted-foreground">
                            Added {new Date(c.createdAt).toLocaleDateString()}
                            {c.lastUsedAt && ` · Last used ${new Date(c.lastUsedAt).toLocaleDateString()}`}
                          </div>
                        </div>
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => handleDeleteBiometric(c.id, c.credentialId)}>
                        <Trash2 className="h-4 w-4 text-rose-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Push Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4 text-emerald-500" /> Push Notifications</CardTitle>
          <CardDescription>
            Get notified about new signals, price alerts, and competition updates even when the app is closed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!pushSupported ? (
            <div className="p-3 rounded-md bg-amber-500/5 border border-amber-500/30 text-sm">
              Push notifications are not supported in this browser.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between p-3 rounded-md border bg-card/50">
                <div>
                  <div className="text-sm font-medium">Browser permission</div>
                  <div className="text-xs text-muted-foreground capitalize">Status: {pushPermission}</div>
                </div>
                <Badge variant={pushPermission === 'granted' ? 'default' : pushPermission === 'denied' ? 'destructive' : 'outline'} className="text-[10px] capitalize">
                  {pushPermission}
                </Badge>
              </div>

              <div className="flex items-center justify-between p-3 rounded-md border bg-card/50">
                <div>
                  <div className="text-sm font-medium">Enable push notifications</div>
                  <div className="text-xs text-muted-foreground">Subscribe this device to receive notifications</div>
                </div>
                <Switch
                  checked={pushEnabled}
                  onCheckedChange={handleTogglePush}
                  disabled={togglingPush || pushPermission === 'denied'}
                />
              </div>

              {pushPermission === 'denied' && (
                <div className="text-xs text-amber-600">
                  Push permission was blocked. Reset it in your browser's site settings to re-enable.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default AdvancedSecurityPanel
