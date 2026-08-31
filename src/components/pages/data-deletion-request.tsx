'use client'

import React from 'react'
import { Trash2, Mail, Loader2, CheckCircle2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type RequestType = 'delete' | 'export'

export function DataDeletionRequestPage() {
  const [email, setEmail] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [requestType, setRequestType] = React.useState<RequestType>('delete')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setDone(null)

    if (!email.trim()) {
      setError('Please enter the email address associated with your account.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/account/deletion-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          reason: reason.trim(),
          requestType,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to submit request')
      }
      setDone(json?.data?.message || 'Your request has been received.')
      setReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit request')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="space-y-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
            <Trash2 className="size-5 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Delete My Account &amp; Data</h1>
            <p className="text-sm text-muted-foreground">
              Request permanent deletion of your TOPTIER account and personal data
            </p>
          </div>
        </div>

        <div className="h-px bg-border" />

        <p className="text-sm text-muted-foreground leading-relaxed">
          You can request deletion of your account and personal data directly through this form. To do this
          yourself instantly, log in and go to <span className="font-medium text-foreground">Settings → Account</span> and
          select <span className="font-medium text-foreground">Delete Account</span>. Otherwise, submit the form below and we
          will process your request, confirm it, and permanently erase your personal data within 30 days, except where we are
          required to retain it by law (for example, financial transaction records, which may be retained for up to 7 years).
        </p>

        {done ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-600 leading-relaxed flex items-start gap-3">
            <CheckCircle2 className="size-5 shrink-0" />
            <div>
              <p className="font-medium">Request received</p>
              <p className="mt-1">{done}</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="dd-request-type">What would you like to do?</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setRequestType('delete')}
                  className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                    requestType === 'delete'
                      ? 'border-destructive/60 bg-destructive/5'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  <Trash2 className="size-5 shrink-0 text-destructive" />
                  <div>
                    <p className="text-sm font-medium">Delete my account &amp; data</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Permanently erase my account, profile, and personal data.
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setRequestType('export')}
                  className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                    requestType === 'export'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  <Download className="size-5 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Export my data</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Receive a copy of my personal data (data portability).
                    </p>
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dd-email" className="flex items-center gap-1.5">
                <Mail className="size-4" /> Email address associated with your account
              </Label>
              <Input
                id="dd-email"
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dd-reason">Additional details (optional)</Label>
              <Textarea
                id="dd-reason"
                placeholder="Any additional information to help us locate and verify your account…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                maxLength={2000}
              />
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={loading} variant={requestType === 'delete' ? 'destructive' : 'default'}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                {requestType === 'delete'
                  ? 'Submit deletion request'
                  : 'Submit data export request'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
