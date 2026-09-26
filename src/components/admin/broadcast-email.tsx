'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Mail, Pause, Play, Send, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Campaign {
  id: string
  subject: string
  body: string
  actionUrl: string | null
  actionLabel: string | null
  audience: string
  audienceLabel: string
  status: 'queued' | 'sending' | 'paused' | 'completed' | 'cancelled'
  total: number
  sent: number
  failed: number
  pending: number
  lastError: string | null
  createdAt: string
  completedAt: string | null
}

interface AudienceOption {
  value: string
  label: string
}

const FALLBACK_AUDIENCES: AudienceOption[] = [
  { value: 'all', label: 'All users' },
  { value: 'verified', label: 'Verified email only' },
  { value: 'premium', label: 'Paying subscribers' },
  { value: 'trial', label: 'Trial users' },
  { value: 'free', label: 'Free-tier users' },
  { value: 'signals', label: 'Signals subscribers' },
  { value: 'bot', label: 'Bot subscribers' },
  { value: 'joined_after', label: 'Joined after a date' },
]

const STATUS_BADGE: Record<Campaign['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  queued: { label: 'Queued', variant: 'secondary' },
  sending: { label: 'Sending', variant: 'default' },
  paused: { label: 'Paused', variant: 'outline' },
  completed: { label: 'Completed', variant: 'secondary' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
}

const emptyForm = { title: '', message: '', actionUrl: '', actionLabel: '' }

export function BroadcastEmailAdmin() {
  const [open, setOpen] = useState(false)
  const [audiences, setAudiences] = useState<AudienceOption[]>(FALLBACK_AUDIENCES)
  const [emailConfigured, setEmailConfigured] = useState(true)
  const [fromAddress, setFromAddress] = useState('')

  const [audience, setAudience] = useState('all')
  const [joinedAfter, setJoinedAfter] = useState('')
  const [preview, setPreview] = useState<{ matched: number; deliverable: number } | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const [form, setForm] = useState(emptyForm)
  const [sendingTest, setSendingTest] = useState(false)

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [failures, setFailures] = useState<{ email: string; error: string }[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const active = campaigns.find((c) => c.id === activeId) ?? null
  const inFlight = active?.status === 'sending' || active?.status === 'queued'

  const load = useCallback(async () => {
    try {
      const res = await api.get<{
        success: boolean
        data: {
          campaigns: Campaign[]
          config: { emailConfigured: boolean; from: string }
          audiences: AudienceOption[]
        }
      }>('/admin/broadcast')
      setCampaigns(res.data.campaigns || [])
      setEmailConfigured(res.data.config?.emailConfigured ?? true)
      if (res.data.config?.from) setFromAddress(res.data.config.from)
      if (res.data.audiences?.length) setAudiences(res.data.audiences)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load broadcasts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Refresh counts while a campaign is in flight so the table stays honest
  // even if this tab is the only thing driving it.
  useEffect(() => {
    if (!inFlight) return
    const id = setInterval(() => {
      load()
    }, 5000)
    return () => clearInterval(id)
  }, [inFlight, load])

  // Audience size preview — debounced so typing a date doesn't spam the API.
  useEffect(() => {
    if (!open) return
    const handle = setTimeout(async () => {
      setPreviewing(true)
      try {
        const qs = new URLSearchParams({ preview: '1', audience })
        if (audience === 'joined_after' && joinedAfter) qs.set('joinedAfter', joinedAfter)
        const res = await api.get<{ success: boolean; data: { matched: number; deliverable: number } }>(
          `/admin/broadcast?${qs.toString()}`
        )
        setPreview(res.data)
      } catch {
        setPreview(null)
      } finally {
        setPreviewing(false)
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [open, audience, joinedAfter])

  // Never leave a send loop running against an unmounted tab.
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const resetForm = () => {
    setForm(emptyForm)
    setFailures([])
  }

  const buildPayload = (extra: Record<string, unknown> = {}) => ({
    title: form.title.trim(),
    message: form.message.trim(),
    actionUrl: form.actionUrl.trim(),
    actionLabel: form.actionLabel.trim() || undefined,
    audience,
    joinedAfter: audience === 'joined_after' ? joinedAfter : undefined,
    ...extra,
  })

  const validateForm = () => {
    if (!form.title.trim() || !form.message.trim()) {
      toast.error('Subject and message are both required.')
      return false
    }
    if (audience === 'joined_after' && !joinedAfter) {
      toast.error('Pick the date users must have joined after.')
      return false
    }
    return true
  }

  const sendTest = async () => {
    if (!validateForm()) return
    setSendingTest(true)
    try {
      const res = await api.post<{ success: boolean; data: { sentTo: string } }>('/admin/broadcast', buildPayload({ testOnly: true }))
      toast.success(`Test email sent to ${res.data.sentTo}. Check your inbox.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test send failed')
    } finally {
      setSendingTest(false)
    }
  }

  /**
   * Drive a campaign to completion one chunk per request. Sequential on
   * purpose: a new request per chunk keeps each one short, and the recipient
   * rows are the source of truth so an interrupted loop is safe to restart.
   */
  const runCampaign = useCallback(
    async (id: string) => {
      const controller = new AbortController()
      abortRef.current = controller
      setWorking(true)
      try {
        for (;;) {
          if (controller.signal.aborted) return
          const res = await api.post<{
            success: boolean
            data: { status: string; sent: number; failed: number; pending: number; total: number; done: boolean }
          }>(`/admin/broadcast/${id}`, { action: 'process' })
          const data = res.data
          setCampaigns((prev) =>
            prev.map((c) =>
              c.id === id
                ? {
                    ...c,
                    status: data.status as Campaign['status'],
                    sent: data.sent,
                    failed: data.failed,
                    pending: data.pending,
                    total: data.total,
                  }
                : c
            )
          )
          if (data.done) {
            toast.success(`Broadcast finished — ${data.sent} delivered${data.failed ? `, ${data.failed} failed` : ''}.`)
            break
          }
        }
        // Pull the failure list once at the end rather than every chunk.
        const detail = await api.get<{ success: boolean; data: { failures: { email: string; error: string }[] } }>(
          `/admin/broadcast/${id}`
        )
        setFailures(detail.data.failures || [])
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        toast.error(err instanceof Error ? err.message : 'Broadcast stopped')
        await load()
      } finally {
        setWorking(false)
        abortRef.current = null
      }
    },
    [load]
  )

  const createAndSend = async () => {
    if (!validateForm()) return
    const count = preview?.deliverable ?? 0
    if (count === 0) {
      toast.error('That audience has no deliverable recipients.')
      return
    }
    if (
      !window.confirm(
        `This emails ${count} user(s) in the "${audiences.find((a) => a.value === audience)?.label ?? audience}" audience. It cannot be unsent. Continue?`
      )
    ) {
      return
    }

    setWorking(true)
    try {
      // Stable per-attempt key so a double-click or retry can't create two
      // campaigns for the same announcement.
      const idempotencyKey = `bc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      const res = await api.post<{ success: boolean; data: { campaign: Campaign; deduplicated?: boolean } }>(
        '/admin/broadcast',
        buildPayload({ idempotencyKey })
      )
      const campaign = res.data.campaign
      setCampaigns((prev) => [campaign, ...prev.filter((c) => c.id !== campaign.id)])
      setActiveId(campaign.id)
      resetForm()
      await runCampaign(campaign.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start the broadcast')
      setWorking(false)
    }
  }

  const cancel = async (id: string) => {
    abortRef.current?.abort()
    setWorking(false)
    try {
      const res = await api.post<{ success: boolean; data: { campaign: Campaign } }>(`/admin/broadcast/${id}`, {
        action: 'cancel',
      })
      setCampaigns((prev) => prev.map((c) => (c.id === id ? res.data.campaign : c)))
      toast.success('Campaign cancelled. Emails already sent cannot be recalled.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel')
    }
  }

  const resume = async (id: string) => {
    try {
      const res = await api.post<{ success: boolean; data: { campaign: Campaign } }>(`/admin/broadcast/${id}`, {
        action: 'resume',
      })
      setCampaigns((prev) => prev.map((c) => (c.id === id ? res.data.campaign : c)))
      await runCampaign(id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resume')
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Mail className="h-5 w-5" /> Email Broadcast
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Send an announcement to a targeted group of users.
            </CardDescription>
          </div>
          <Button
            size="sm"
            disabled={!emailConfigured}
            onClick={() => {
              resetForm()
              setFailures([])
              setOpen(true)
            }}
          >
            <Send className="h-4 w-4 mr-1" /> Compose Broadcast
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!emailConfigured ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Email delivery is not configured on this server. Set <code>RESEND_API_KEY</code> and a verified{' '}
                <code>EMAIL_FROM</code> domain, then redeploy — broadcasts are disabled until then.
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Sending as <span className="font-medium text-foreground">{fromAddress}</span>. Compose a test to your own
              address before going live.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send history</CardTitle>
          <CardDescription>Every campaign is recorded, including failures.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading campaigns…
            </div>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No broadcasts sent yet.</p>
          ) : (
            <div className="space-y-3">
              {campaigns.map((c) => {
                const badge = STATUS_BADGE[c.status] ?? STATUS_BADGE.queued
                const processed = c.sent + c.failed
                const pct = c.total > 0 ? Math.round((processed / c.total) * 100) : 0
                return (
                  <div key={c.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{c.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.audienceLabel} · {new Date(c.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {inFlight && c.id === activeId ? (
                          <Button size="sm" variant="outline" onClick={() => cancel(c.id)}>
                            <Pause className="h-3.5 w-3.5 mr-1" /> Stop
                          </Button>
                        ) : c.status === 'cancelled' || c.status === 'paused' ? (
                          <Button size="sm" variant="outline" onClick={() => resume(c.id)} disabled={working}>
                            <Play className="h-3.5 w-3.5 mr-1" /> Resume
                          </Button>
                        ) : c.status === 'queued' ? (
                          <Button size="sm" variant="outline" onClick={() => resume(c.id)} disabled={working}>
                            <Play className="h-3.5 w-3.5 mr-1" /> Send
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                    <p className="text-xs text-muted-foreground">
                      {c.sent} delivered · {c.failed} failed · {c.pending} pending of {c.total}
                    </p>
                    {c.id === activeId && failures.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">
                          Show {failures.length} failed recipient(s)
                        </summary>
                        <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                          {failures.map((f) => (
                            <li key={f.email} className="text-muted-foreground">
                              <span className="font-medium text-foreground">{f.email}</span> — {f.error}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Broadcast</DialogTitle>
            <DialogDescription>
              Pick an audience, send yourself a test, then send. Bodies support blank-line paragraphs, “- ” bullets,
              “1. ” lists and “# ” headings.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label>Audience</Label>
              <Select value={audience} onValueChange={setAudience}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {audiences.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {previewing
                  ? 'Counting recipients…'
                  : preview
                    ? `${preview.deliverable} deliverable recipient(s)${preview.matched > preview.deliverable ? ` (${preview.matched - preview.deliverable} skipped — invalid or duplicate address)` : ''}. Banned and deleted users are always excluded.`
                    : 'Banned and deleted users are always excluded.'}
              </p>
            </div>

            {audience === 'joined_after' && (
              <div className="space-y-1.5">
                <Label>Joined on or after</Label>
                <Input type="date" value={joinedAfter} onChange={(e) => setJoinedAfter(e.target.value)} />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Subject line</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="New e-books are live in the store"
                maxLength={140}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Message</Label>
              <textarea
                className="min-h-[180px] w-full rounded-lg border border-input bg-background p-3 text-sm"
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                placeholder={'# What’s new\n\nWe just shipped something you asked for.\n\n- First item\n- Second item'}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Button link (optional)</Label>
                <Input
                  value={form.actionUrl}
                  onChange={(e) => setForm((f) => ({ ...f, actionUrl: e.target.value }))}
                  placeholder="/ebooks"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Button label</Label>
                <Input
                  value={form.actionLabel}
                  onChange={(e) => setForm((f) => ({ ...f, actionLabel: e.target.value }))}
                  placeholder="View Now"
                />
              </div>
            </div>

            {active && inFlight && (
              <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Delivering “{active.subject}” — {active.sent} sent,{' '}
                  {active.pending} to go.
                </div>
                <Progress value={active.total ? ((active.sent + active.failed) / active.total) * 100 : 0} />
              </div>
            )}

            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" onClick={sendTest} disabled={sendingTest || working}>
                {sendingTest ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Mail className="size-4 mr-1" />}
                Send test to me
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={working}>
                Close
              </Button>
              <Button onClick={createAndSend} disabled={working || preview?.deliverable === 0}>
                {working ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Send className="size-4 mr-1" />}
                Send to {preview?.deliverable ?? 0} user(s)
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default BroadcastEmailAdmin
