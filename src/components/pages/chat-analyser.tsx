'use client'

import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquareText,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  GitCompareArrows,
  Wand2,
  Bot,
  Brain,
  Layers,
  Zap,
} from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

interface HfSignal {
  label: string
  score: number
}

interface ChatSource {
  huggingface: {
    sentiment: HfSignal | null
    emotion: HfSignal | null
    toxicity: HfSignal | null
    entities: Array<{ text: string; type: string; score: number }>
    errors: Array<{ task: string; message: string }>
  }
  gemini: {
    intent?: string
    topic?: string
    key_facts?: string[]
    context_notes?: string
    requires_human_review?: boolean
  } | null
  gemini_error?: string
}

interface ChatResult {
  verdict: string
  confidence: number
  severity: 'none' | 'low' | 'medium' | 'high'
  evidence_spans: string[]
  model_agreement: 'agree' | 'partial' | 'disagree'
  reasoning: string
  recommended_action: string
  path: 'fast' | 'full'
  cached: boolean
  sources: ChatSource
}

interface ProviderStatus {
  huggingface: boolean
  gemini: boolean
  claude: boolean
}

const AGREEMENT_META: Record<string, { label: string; tone: string }> = {
  agree: { label: 'Models agree', tone: 'text-emerald-600 border-emerald-500/30 bg-emerald-500/10' },
  partial: { label: 'Partial agreement', tone: 'text-amber-600 border-amber-500/30 bg-amber-500/10' },
  disagree: { label: 'Models disagree', tone: 'text-rose-600 border-rose-500/30 bg-rose-500/10' },
}

const SEVERITY_META: Record<string, { label: string; tone: string }> = {
  none: { label: 'No risk flagged', tone: 'text-emerald-600 border-emerald-500/30 bg-emerald-500/10' },
  low: { label: 'Low severity', tone: 'text-amber-600 border-amber-500/30 bg-amber-500/10' },
  medium: { label: 'Medium severity', tone: 'text-orange-600 border-orange-500/30 bg-orange-500/10' },
  high: { label: 'High severity', tone: 'text-rose-600 border-rose-500/30 bg-rose-500/10' },
}

function fmtPct(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return `${Math.round(n * 100)}%`
}

export function ChatAnalyserPage() {
  const [message, setMessage] = useState(
    "I've waited three weeks for this order and support still hasn't gotten back to me. This is ridiculous."
  )
  const [historyText, setHistoryText] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ChatResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [providers, setProviders] = useState<ProviderStatus | null>(null)

  const checkProviders = useCallback(async () => {
    try {
      const res = await api.get<{ data: { providers: ProviderStatus } }>('/chat/analyze')
      setProviders(res?.data?.providers ?? null)
    } catch {
      setProviders(null)
    }
  }, [])

  React.useEffect(() => {
    checkProviders()
  }, [checkProviders])

  const providerBadge = (name: string, ok?: boolean) => {
    if (ok === undefined) return null
    return ok ? (
      <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
        <ShieldCheck className="h-3 w-3" /> {name} ready
      </Badge>
    ) : (
      <Badge variant="outline" className="gap-1 border-rose-500/30 bg-rose-500/10 text-rose-600">
        <ShieldAlert className="h-3 w-3" /> {name} missing key
      </Badge>
    )
  }

  const handleAnalyze = async () => {
    const text = message.trim()
    if (!text) {
      toast.error('Enter a message first.')
      return
    }

    const history = historyText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await api.post<{ success: boolean; data: { result: ChatResult } }>('/chat/analyze', {
        text,
        history,
      })
      const r = res?.data?.result
      if (!r) throw new Error('Analysis returned an empty result')
      setResult(r)
      toast.success(r.path === 'fast' ? 'Fast path — Hugging Face only' : 'Full 3-model analysis complete')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const severityTone =
    (result && SEVERITY_META[result.severity]) ||
    { label: 'No risk flagged', tone: 'text-emerald-600 border-emerald-500/30 bg-emerald-500/10' }
  const agreementTone =
    (result && AGREEMENT_META[result.model_agreement]) ||
    { label: '—', tone: 'border-border bg-muted text-muted-foreground' }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <MessageSquareText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">AI Chat Analyser</h1>
            <p className="text-sm text-muted-foreground">
              Three independent models cross-check a message — disagreement is shown, not hidden.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {providerBadge('HF', providers?.huggingface)}
          {providerBadge('Gemini', providers?.gemini)}
          {providerBadge('Claude', providers?.claude)}
        </div>
      </div>

      {/* Input card */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="chat-message">
              Chat message to analyze
            </label>
            <Textarea
              id="chat-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Paste the message you want analyzed…"
              className="resize-y"
            />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowHistory((s) => !s)}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              {showHistory ? '− hide prior thread context' : '+ add prior thread context'}
            </button>
          </div>

          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="space-y-1.5">
                  <label className="text-sm text-muted-foreground" htmlFor="chat-history">
                    Earlier messages in the thread, one per line, oldest first
                  </label>
                  <Textarea
                    id="chat-history"
                    value={historyText}
                    onChange={(e) => setHistoryText(e.target.value)}
                    rows={3}
                    placeholder={'Hi, my order #4471 hasn\'t arrived yet.\nIt\'s been two weeks now, any update?'}
                    className="resize-y"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleAnalyze} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? 'Analysing…' : 'Analyze message'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Hugging Face → Gemini → Claude
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-rose-600">
              <ShieldAlert className="h-4 w-4" />
              <span className="text-sm font-medium">{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading skeleton */}
      {loading && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="h-6 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Result */}
      <AnimatePresence>
        {result && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <Card className="border-primary/20">
              <CardContent className="space-y-4 pt-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-bold capitalize">
                        {(result.verdict || 'unknown').replace(/_/g, ' ')}
                      </h2>
                      <Badge variant="outline" className={cn('gap-1 border', severityTone.tone)}>
                        {result.severity === 'none' ? (
                          <ShieldCheck className="h-3 w-3" />
                        ) : (
                          <ShieldAlert className="h-3 w-3" />
                        )}
                        {severityTone.label}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className={cn('gap-1 border', agreementTone.tone)}>
                        <GitCompareArrows className="h-3 w-3" />
                        {agreementTone.label}
                      </Badge>
                      {result.cached && (
                        <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                          cached
                        </Badge>
                      )}
                      <Badge variant="outline" className="gap-1 border-border bg-muted text-muted-foreground">
                        <Zap className="h-3 w-3" /> {result.path === 'fast' ? 'fast path' : 'full pipeline'}
                      </Badge>
                    </div>
                  </div>
                  <div className="w-full sm:w-44">
                    <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Confidence</span>
                      <span className="font-semibold text-foreground">{fmtPct(result.confidence)}</span>
                    </div>
                    <Progress value={result.confidence * 100} />
                  </div>
                </div>

                <p className="text-sm leading-relaxed text-muted-foreground">{result.reasoning}</p>

                {result.evidence_spans.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Evidence
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {result.evidence_spans.map((span, i) => (
                        <span
                          key={i}
                          className="rounded-lg border border-primary/20 bg-primary/5 px-2 py-1 text-xs"
                        >
                          “{span}”
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2.5">
                  <Wand2 className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-xs text-muted-foreground">Recommended action:&nbsp;</span>
                  <span className="text-sm font-medium">{result.recommended_action || '—'}</span>
                </div>
              </CardContent>
            </Card>

            {/* Source transparency grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <SourceCard
                icon={<Layers className="h-5 w-5" />}
                title="Hugging Face"
                role="Specialist classifiers"
                status={result.sources.huggingface.errors.length ? 'degraded' : 'ok'}
              >
                <KV
                  label="Sentiment"
                  value={
                    result.sources.huggingface.sentiment
                      ? `${result.sources.huggingface.sentiment.label} (${fmtPct(result.sources.huggingface.sentiment.score)})`
                      : null
                  }
                />
                <KV
                  label="Emotion"
                  value={
                    result.sources.huggingface.emotion
                      ? `${result.sources.huggingface.emotion.label} (${fmtPct(result.sources.huggingface.emotion.score)})`
                      : null
                  }
                />
                <KV
                  label="Toxicity"
                  value={
                    result.sources.huggingface.toxicity
                      ? fmtPct(result.sources.huggingface.toxicity.score)
                      : null
                  }
                />
                <KV
                  label="Entities"
                  value={
                    result.sources.huggingface.entities?.length
                      ? result.sources.huggingface.entities.slice(0, 4).map((e) => e.text).join(', ')
                      : null
                  }
                />
                {result.sources.huggingface.errors?.length ? (
                  <KV label="Errors" value={result.sources.huggingface.errors.map((e) => e.task).join(', ')} />
                ) : null}
              </SourceCard>

              <SourceCard
                icon={<Brain className="h-5 w-5" />}
                title="Gemini"
                role="Structured extraction"
                status={result.sources.gemini ? 'ok' : result.sources.gemini_error ? 'degraded' : 'skipped'}
              >
                {result.sources.gemini ? (
                  <>
                    <KV label="Intent" value={result.sources.gemini.intent} />
                    <KV label="Topic" value={result.sources.gemini.topic} />
                    <KV
                      label="Key facts"
                      value={
                        result.sources.gemini.key_facts?.length
                          ? result.sources.gemini.key_facts.join('; ')
                          : null
                      }
                    />
                    <KV
                      label="Needs review"
                      value={
                        typeof result.sources.gemini.requires_human_review === 'boolean'
                          ? result.sources.gemini.requires_human_review ? 'yes' : 'no'
                          : null
                      }
                    />
                  </>
                ) : result.sources.gemini_error ? (
                  <KV label="Status" value="unavailable, skipped" />
                ) : (
                  <KV label="Status" value="not run (fast path)" />
                )}
              </SourceCard>

              <SourceCard
                icon={<Bot className="h-5 w-5" />}
                title="Claude"
                role="Fusion & explanation"
                status="ok"
              >
                <KV label="Verdict" value={result.verdict} />
                <KV
                  label="Agreement"
                  value={result.model_agreement ?? (result.path === 'fast' ? 'agree' : null)}
                />
                <KV label="Severity" value={result.severity} />
                <KV label="Confidence" value={fmtPct(result.confidence)} />
              </SourceCard>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              {result.path === 'fast'
                ? 'Fast path: Hugging Face signal was unambiguous, so Gemini and Claude were skipped to save time and cost.'
                : 'Full pipeline: Hugging Face, Gemini, and Claude all ran; Claude resolved and explained the final verdict.'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Small presentational helpers ───────────────────────────────────────────

function SourceCard({
  icon,
  title,
  role,
  status,
  children,
}: {
  icon: React.ReactNode
  title: string
  role: string
  status?: 'ok' | 'degraded' | 'skipped'
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-primary">{icon}</div>
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          {status === 'ok' && (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
              <ShieldCheck className="h-3 w-3" />
            </Badge>
          )}
          {(status === 'degraded' || status === 'skipped') && (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
              <ShieldAlert className="h-3 w-3" />
            </Badge>
          )}
        </div>
        <CardDescription>{role}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {children || <p className="text-muted-foreground">no data</p>}
      </CardContent>
    </Card>
  )
}

function KV({ label, value }: { label: string; value: string | null | undefined }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium break-words">{value}</div>
    </div>
  )
}
