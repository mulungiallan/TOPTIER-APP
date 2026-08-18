'use client'

import { useState, useCallback, useEffect } from 'react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Users,
  TrendingUp,
  DollarSign,
  Activity,
  Shield,
  Search,
  Eye,
  Ban,
  UserCheck,
  Plus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Settings,
  FileText,
  BarChart3,
  Cpu,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Crown,
  Zap,
  Tag,
  Trash2,
  Bell,
  Newspaper,
  CalendarDays,
  Bot,
  MessageSquare,
  Link2,
} from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts'
import { toast } from 'sonner'

// ─── Admin API helpers ────────────────────────────────────────────────────────

async function runAdminAction(action: string, body: Record<string, unknown>) {
  const res = await api.post<{ success: boolean; data?: unknown }>('/admin-actions', { action, ...body })
  return res?.data
}

// ─── Types (mirror /api/admin/overview) ───────────────────────────────────────

interface OverviewData {
  generatedAt: string
  admin: { id: string; email: string; name: string | null; role: string }
  platform: {
    paymentsEnabled: boolean
    stripe: boolean
    resend: boolean
    finnhub: boolean
    vapid: boolean
    gemini: boolean
    huggingface: boolean
    adminLocked: boolean
    nodeEnv: string
  }
  stats: {
    users: { total: number; premium: number; trial: number; activeToday: number; banned: number }
    signals: { total: number; active: number }
    revenue: {
      totalTransactions: number; pendingTransactions: number; totalRevenue: number
      summaryBySource: Array<{ source: string; total: number; available: number; paid: number }>
    }
    support: { openTickets: number }
    analyses: { total: number; today: number }
    bots: { connections: number; running: number }
    copyTrading: {
      traders: number
      followers: number
      masters: number
      brokerProfitShareDue: number
      brokerProfitSharePaid: number
      platformCopyFees: number
    }
    referralGate: { enabled: boolean; codeConfigured: boolean; urlConfigured: boolean }
    content: { news: number; coupons: number }
    engagement: Record<string, number>
  }
  revenueByMonth: Array<{ month: string; revenue: number; count: number }>
  userGrowth: Record<string, number>
  subscriptionDistribution: Array<{ tier: string; count: number }>
  signalPerformance: Array<{ status: string; count: number }>
  recentUsers: Array<Record<string, any>>
  recentPayments: Array<Record<string, any>>
  recentSignals: Array<Record<string, any>>
  recentNews: Array<Record<string, any>>
  upcomingEvents: Array<Record<string, any>>
  recentAnalyses: Array<Record<string, any>>
  recentTickets: Array<Record<string, any>>
  coupons: Array<Record<string, any>>
  auditLog: Array<Record<string, any>>
  activityFeed: Array<Record<string, any>>
  bots: Array<Record<string, any>>
  recentBotTrades: Array<Record<string, any>>
  copySettlements: Array<{
    id: string
    traderId: string
    grossProfit: number
    providerAmount: number
    platformAmount: number
    status: string
    dedicatedAt: string | null
    settledBy: string
    createdAt: string
    trader: { user: { id: string; name: string | null; email: string } | null }
    follower: { name: string | null; email: string } | null
  }>
}

interface AdminUser {
  id: string
  name: string | null
  email: string
  subscriptionTier: string
  plan: string
  role: string
  isBanned: boolean
  banReason: string | null
  referralCount: number
  createdAt: string
}

function toRow(u: AdminUser) {
  const tier = u.subscriptionTier || 'free'
  return {
    id: u.id,
    name: u.name || 'Unnamed',
    email: u.email,
    tier,
    status: u.isBanned ? 'suspended' : 'active',
    signals: 0,
    joined: new Date(u.createdAt).toLocaleDateString(),
    lastActive: '—',
    isBanned: u.isBanned,
    banReason: u.banReason || null,
  }
}

const PIE_COLORS = ['#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#64748b']

const fmtMoney = (n: number | undefined, currency = 'USD') =>
  n === undefined || n === null
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)

const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleString()
  } catch {
    return String(d)
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ title, value, icon: Icon, sub, change, changeType }: {
  title: string; value: string; icon: React.ElementType; sub?: string; change?: string; changeType?: 'up' | 'down'
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
        {change && (
          <div className="flex items-center gap-1 mt-1">
            {changeType === 'up' ? (
              <ArrowUpRight className="h-3 w-3 text-green-600" />
            ) : (
              <ArrowDownRight className="h-3 w-3 text-red-600" />
            )}
            <span className={`text-xs font-medium ${changeType === 'up' ? 'text-green-600' : 'text-red-600'}`}>{change}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function EmptyState({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="text-center py-10 text-muted-foreground">
      <Icon className="h-10 w-10 mx-auto mb-2 opacity-40" />
      <p className="text-sm">{text}</p>
    </div>
  )
}

function TierBadge({ tier }: { tier: string }) {
  const config: Record<string, string> = {
    free: 'bg-gray-100 text-gray-700 border-gray-200',
    premium: 'bg-amber-100 text-amber-700 border-amber-200',
    pro: 'bg-purple-100 text-purple-700 border-purple-200',
    trial: 'bg-blue-100 text-blue-700 border-blue-200',
    lifetime: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  }
  const c = config[tier] || config.free
  return <Badge variant="outline" className={`text-xs capitalize ${c}`}>{tier}</Badge>
}

function AdRevenueForm({ onLogged }: { onLogged: () => void }) {
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const submit = async () => {
    if (!amount || Number(amount) <= 0) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await runAdminAction('log_ad_revenue', {
        amount: Number(amount),
        reference: reference || undefined,
        description: description || undefined,
      }) as any
      setMsg(res?.message || 'Logged')
      setAmount(''); setReference(''); setDescription('')
      onLogged()
    } catch { setMsg('Failed') }
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Amount (USD)</label>
          <Input type="number" step="0.01" placeholder="e.g. 150.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">Reference (optional)</label>
          <Input placeholder="e.g. adsense_jan_2026" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium mb-1.5 block">Description (optional)</label>
        <Input placeholder="e.g. January AdSense payout" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={busy || !amount} onClick={submit}>{busy ? 'Logging...' : 'Log Ad Revenue'}</Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </div>
  )
}

function CreateCouponDialog({ onCreated }: { onCreated: () => void }) {
  const [code, setCode] = useState('')
  const [discount, setDiscount] = useState('')
  const [type, setType] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> Create Coupon</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Coupon</DialogTitle>
          <DialogDescription>Generate a discount coupon for users</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Code</label>
              <Input placeholder="e.g. SAVE20" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Discount</label>
              <Input placeholder="e.g. 20% or $10" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Type</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed Amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Max Uses</label>
              <Input type="number" placeholder="500" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Expires</label>
            <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
          <Button
            className="w-full"
            disabled={!code || !discount || !type || busy}
            onClick={async () => {
              setBusy(true)
              try {
                const amount = discount.replace(/[^0-9.]/g, '')
                if (!amount) throw new Error('Enter a valid discount amount')
                await runAdminAction('create_coupon', {
                  code,
                  discountType: type,
                  discountAmount: amount,
                  maxUses: maxUses || undefined,
                  expiresAt: expires ? new Date(expires).toISOString() : undefined,
                })
                toast.success(`Coupon ${code} created!`)
                setCode(''); setDiscount(''); setType(''); setMaxUses(''); setExpires('')
                onCreated()
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Failed to create coupon')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Creating...' : 'Create Coupon'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CreateSignalDialog({ onCreated }: { onCreated: () => void }) {
  const [asset, setAsset] = useState('EUR/USD')
  const [type, setType] = useState('BUY')
  const [entry, setEntry] = useState('')
  const [sl, setSl] = useState('')
  const [tp1, setTp1] = useState('')
  const [tp2, setTp2] = useState('')
  const [confidence, setConfidence] = useState('70')
  const [timeframe, setTimeframe] = useState('1H')
  const [marketType, setMarketType] = useState('forex')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> Publish Signal</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publish Signal</DialogTitle>
          <DialogDescription>Creates a real signal row broadcast to users</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Asset</label>
              <Input value={asset} onChange={(e) => setAsset(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Type</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUY">BUY</SelectItem>
                  <SelectItem value="SELL">SELL</SelectItem>
                  <SelectItem value="NEUTRAL">NEUTRAL</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Entry</label>
              <Input type="number" step="0.00001" value={entry} onChange={(e) => setEntry(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Stop Loss</label>
              <Input type="number" step="0.00001" value={sl} onChange={(e) => setSl(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">TP1</label>
              <Input type="number" step="0.00001" value={tp1} onChange={(e) => setTp1(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">TP2 (opt)</label>
              <Input type="number" step="0.00001" value={tp2} onChange={(e) => setTp2(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Confidence %</label>
              <Input type="number" value={confidence} onChange={(e) => setConfidence(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Timeframe</label>
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['5M', '15M', '1H', '4H', '1D'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Reason</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Analysis notes" />
          </div>
          <Button
            className="w-full"
            disabled={!asset || !entry || !sl || !tp1 || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await runAdminAction('generate_signal', {
                  asset, type, entryPrice: entry, stopLoss: sl, takeProfit1: tp1,
                  takeProfit2: tp2 || undefined, confidence, strategy: 'manual', timeframe, marketType,
                  reason: reason || `Admin-published signal for ${asset}`,
                })
                toast.success(`Signal ${type} ${asset} published`)
                onCreated()
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Failed to publish signal')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Publishing...' : 'Publish Signal'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CreateNewsDialog({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [source, setSource] = useState('TOPTIER Research')
  const [summary, setSummary] = useState('')
  const [sentiment, setSentiment] = useState('neutral')
  const [category, setCategory] = useState('')
  const [taggedAssets, setTaggedAssets] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> Add Article</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add News Article</DialogTitle>
          <DialogDescription>Creates a real article in the news feed</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Source</label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Sentiment</label>
              <Select value={sentiment} onValueChange={setSentiment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bullish">Bullish</SelectItem>
                  <SelectItem value="bearish">Bearish</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Summary</label>
            <Input value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Category</label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="central_banks" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Tagged assets</label>
              <Input value={taggedAssets} onChange={(e) => setTaggedAssets(e.target.value)} placeholder="EUR/USD,XAU/USD" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Source URL (optional)</label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <Button
            className="w-full"
            disabled={!title || !source || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await runAdminAction('create_news', { title, source, summary, sentiment, category, taggedAssets, url })
                toast.success('Article published')
                setTitle(''); setSummary(''); setCategory(''); setTaggedAssets(''); setUrl('')
                onCreated()
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Failed to publish article')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Publishing...' : 'Publish Article'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CreateEventDialog({ onCreated }: { onCreated: () => void }) {
  const [eventName, setEventName] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [impact, setImpact] = useState('medium')
  const [previous, setPrevious] = useState('')
  const [forecast, setForecast] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> Add Event</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Economic Event</DialogTitle>
          <DialogDescription>Creates a real entry in the economic calendar</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Event name</label>
            <Input value={eventName} onChange={(e) => setEventName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Date &amp; time</label>
              <Input type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Currency</label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Impact</label>
              <Select value={impact} onValueChange={setImpact}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Previous</label>
              <Input value={previous} onChange={(e) => setPrevious(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Forecast</label>
            <Input value={forecast} onChange={(e) => setForecast(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <Button
            className="w-full"
            disabled={!eventName || !eventDate || !currency || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await runAdminAction('create_event', {
                  eventName, eventDate: new Date(eventDate).toISOString(), currency,
                  impactLevel: impact, previousValue: previous || undefined,
                  forecastValue: forecast || undefined, description: description || undefined,
                })
                toast.success('Event added')
                setEventName(''); setEventDate(''); setPrevious(''); setForecast(''); setDescription('')
                onCreated()
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Failed to add event')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Adding...' : 'Add Event'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// User detail dialog backed by real /api/admin/users/[id] data
function UserDetailDialog({ user, onChanged }: { user: ReturnType<typeof toRow>; onChanged: () => void }) {
  const [detail, setDetail] = useState<Record<string, any> | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const loadDetail = async () => {
    setLoadingDetail(true)
    try {
      const res = await api.get<{ success: boolean; data: Record<string, any> }>(`/admin/users/${user.id}`)
      if (res?.success && res?.data) setDetail(res.data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load user details')
    } finally {
      setLoadingDetail(false)
    }
  }

  const act = async (action: string, body: Record<string, unknown>, okMsg: string) => {
    setBusy(action)
    try {
      await runAdminAction(action, { ...body, userId: user.id })
      toast.success(okMsg)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const u = detail?.user
  return (
    <Dialog onOpenChange={(open) => { if (open) loadDetail() }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"><Eye className="h-3 w-3" /> View</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
          <DialogDescription>{u?.name || user.name} — {u?.email || user.email}</DialogDescription>
        </DialogHeader>

        {loadingDetail && !detail ? (
          <div className="py-8 text-center text-muted-foreground">Loading real user data…</div>
        ) : !u ? (
          <div className="py-8 text-center text-muted-foreground">No details available.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Email verified</p>
                <p className="text-sm font-medium">{u.isEmailVerified ? 'Yes' : 'No'}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">2FA</p>
                <p className="text-sm font-medium">{u.twoFactorEnabled ? 'Enabled' : 'Disabled'}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Country</p>
                <p className="text-sm font-medium">{u.country || '—'}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Plan (packages)</p>
                <p className="text-sm font-medium capitalize">{u.plan || 'free'}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Analyses</p>
                <p className="text-sm font-medium">{u.analysesUsed ?? 0} / {u.analysesLimit === 0 ? '∞' : (u.analysesLimit ?? 5)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Referral code</p>
                <p className="text-sm font-medium font-mono">{u.referralCode || '—'}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Referrals</p>
                <p className="text-sm font-medium">{u.referralCount ?? 0}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Sub. expires</p>
                <p className="text-sm font-medium">{u.subscriptionEndDate ? new Date(u.subscriptionEndDate).toLocaleDateString() : '—'}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Joined</p>
                <p className="text-sm font-medium">{new Date(u.createdAt).toLocaleDateString()}</p>
              </div>
            </div>

            <div>
              <h4 className="font-medium text-sm mb-2">Payments (real)</h4>
              <div className="space-y-1.5">
                {detail.payments?.length === 0 && <p className="text-xs text-muted-foreground">No payments.</p>}
                {detail.payments?.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between text-sm p-2 rounded bg-muted/30">
                    <span>{p.planType?.replace(/_/g, ' ') || 'Subscription'}</span>
                    <span className="text-muted-foreground">{fmtDate(p.createdAt)}</span>
                    <Badge variant={p.status === 'completed' ? 'default' : p.status === 'pending' ? 'outline' : 'destructive'} className="text-xs">
                      {p.status} · {fmtMoney(p.amount, p.currency)}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-medium text-sm mb-2">Bot connections (real)</h4>
              <div className="space-y-1.5">
                {detail.botConnections?.length === 0 && <p className="text-xs text-muted-foreground">No bot connections.</p>}
                {detail.botConnections?.map((b: any) => (
                  <div key={b.id} className="flex items-center justify-between text-sm p-2 rounded bg-muted/30">
                    <span className="font-medium">{b.label || b.platform}</span>
                    <span className="text-muted-foreground">{b.platform} · {b.brokerName || '—'} · {b.login}</span>
                    <Badge variant={b.isActive ? 'default' : 'outline'} className="text-xs">{b.isActive ? 'active' : 'inactive'}</Badge>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-medium text-sm mb-2">Screenshot analyses (real)</h4>
              <div className="space-y-1.5">
                {detail.analyses?.length === 0 && <p className="text-xs text-muted-foreground">No analyses.</p>}
                {detail.analyses?.slice(0, 10).map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between text-sm p-2 rounded bg-muted/30">
                    <span>{a.detectedAsset || a.signalType || 'Analysis'}</span>
                    <span className="text-muted-foreground">{a.status}</span>
                    <span className="text-muted-foreground">{fmtDate(a.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-medium text-sm mb-2">Recent activity (real)</h4>
              <ScrollArea className="max-h-44">
                <div className="space-y-1.5">
                  {detail.activity?.length === 0 && <p className="text-xs text-muted-foreground">No activity.</p>}
                  {detail.activity?.map((a: any) => (
                    <div key={a.id} className="flex items-center gap-2 p-2 rounded bg-muted/30 text-xs">
                      <Activity className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span>{a.action}{a.details ? `: ${a.details}` : ''}</span>
                      <span className="ml-auto text-muted-foreground shrink-0">{fmtDate(a.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-1" disabled={busy === 'warn_user'}
                onClick={() => act('warn_user', { reason: 'Community guidelines violation' }, `Warning sent to ${user.name}`)}>
                <AlertTriangle className="h-3.5 w-3.5" /> Warn
              </Button>
              <Button variant="outline" size="sm" className="gap-1" disabled={busy === 'suspend_user'}
                onClick={() => act('suspend_user', { duration: '7', reason: 'Violation of terms' }, `${user.name} suspended for 7 days`)}>
                <Clock className="h-3.5 w-3.5" /> Suspend 7d
              </Button>
              <Button variant="destructive" size="sm" className="gap-1" disabled={busy === 'ban_user'}
                onClick={() => act('ban_user', { reason: 'Permanent ban' }, `${user.name} banned`)}>
                <Ban className="h-3.5 w-3.5" /> Ban
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminPage() {
  const user = useStore((s) => s.user)
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [overview, setOverview] = useState<OverviewData | null>(null)

  // Real list data from /api/admin/data
  const [adminUsers, setAdminUsers] = useState<ReturnType<typeof toRow>[]>([])
  const [adminSignals, setAdminSignals] = useState<any[]>([])
  const [adminCoupons, setAdminCoupons] = useState<any[]>([])
  const [adminTickets, setAdminTickets] = useState<any[]>([])
  const [adminAudit, setAdminAudit] = useState<any[]>([])

  const [userSearch, setUserSearch] = useState('')
  const [userTierFilter, setUserTierFilter] = useState('all')
  const [userStatusFilter, setUserStatusFilter] = useState('all')

  const [flags, setFlags] = useState<{ id: string; name: string; description: string; enabled: boolean }[]>([])
  const [appSettings, setAppSettings] = useState({
    trialLength: '7',
    premiumPrice: '29.99',
    proPrice: '59.99',
    maintenanceMode: false,
  })
  const [savingSettings, setSavingSettings] = useState(false)
  const [savingFlagId, setSavingFlagId] = useState<string | null>(null)

  const fetchAll = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      const [overviewRes, dataRes, settingsRes] = await Promise.all([
        api.get<{ success: boolean; data: OverviewData }>('/admin/overview', { signal }),
        api.get<{ success: boolean; data: { users?: any[]; signals?: any[]; coupons?: any[]; tickets?: any[]; auditLog?: any[] } }>('/admin/data', { signal }),
        api.get<{ success: boolean; data: { featureFlags?: any[]; appSettings?: any } }>('/admin/settings', { signal }),
      ])
      if (!signal?.aborted) {
        if (overviewRes?.success && overviewRes?.data) setOverview(overviewRes.data)
        if (dataRes?.data) {
          if (dataRes.data.users) setAdminUsers(dataRes.data.users.map(toRow))
          if (dataRes.data.signals) setAdminSignals(dataRes.data.signals)
          if (dataRes.data.coupons) setAdminCoupons(dataRes.data.coupons)
          if (dataRes.data.tickets) setAdminTickets(dataRes.data.tickets)
          if (dataRes.data.auditLog) setAdminAudit(dataRes.data.auditLog)
        }
        if (settingsRes?.data) {
          if (Array.isArray(settingsRes.data.featureFlags) && settingsRes.data.featureFlags.length) {
            setFlags(settingsRes.data.featureFlags)
          }
          if (settingsRes.data.appSettings && typeof settingsRes.data.appSettings === 'object') {
            setAppSettings((prev) => ({ ...prev, ...settingsRes.data.appSettings }))
          }
        }
      }
    } catch (err: unknown) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Failed to load admin data')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    const ctrl = new AbortController()
    fetchAll(ctrl.signal)
    return () => ctrl.abort()
  }, [isAdmin, fetchAll])

  const saveAppSettings = async () => {
    setSavingSettings(true)
    try {
      await api.put('/admin/settings', { appSettings })
      toast.success('Settings saved!')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSavingSettings(false)
    }
  }

  const toggleFlag = async (id: string, enabled: boolean) => {
    const prev = flags
    setFlags((fs) => fs.map((f) => (f.id === id ? { ...f, enabled } : f)))
    setSavingFlagId(id)
    try {
      await api.put('/admin/settings', { featureFlags: [{ id, enabled }] })
      const flag = prev.find((f) => f.id === id)
      toast.success(`${flag?.name || 'Feature'} ${enabled ? 'enabled' : 'disabled'}`)
    } catch (e) {
      setFlags(prev)
      toast.error(e instanceof Error ? e.message : 'Failed to update feature flag')
    } finally {
      setSavingFlagId(null)
    }
  }

  const toggleCoupon = async (coupon: any) => {
    try {
      const next = !(coupon.isActive !== undefined ? coupon.isActive : coupon.status === 'active')
      await runAdminAction('deactivate_coupon', { couponId: coupon.id, code: coupon.code, isActive: next })
      setAdminCoupons((cs) => cs.map((c) => (c.id === coupon.id ? { ...c, isActive: next, status: next ? 'active' : 'inactive' } : c)))
      toast.success(`Coupon ${coupon.code} ${next ? 'activated' : 'deactivated'}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update coupon')
    }
  }

  const closeSignal = async (sig: any) => {
    try {
      const next = sig.status === 'active' ? 'expired' : 'active'
      await runAdminAction('override_signal', { signalId: sig.id, status: next, reason: 'Admin override from panel' })
      toast.success(`Signal ${sig.id} ${next === 'expired' ? 'closed' : 'reactivated'}`)
      fetchAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Override failed')
    }
  }

  const deleteArticle = async (article: any) => {
    try {
      await runAdminAction('delete_news', { articleId: article.id })
      toast.success('Article deleted')
      fetchAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const deleteEvent = async (ev: any) => {
    try {
      await runAdminAction('delete_event', { eventId: ev.id })
      toast.success('Event deleted')
      fetchAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const dismissTicket = async (ticket: any) => {
    try {
      await runAdminAction('dismiss_report', { reportId: ticket.id, reason: 'Dismissed from admin panel' })
      toast.success('Ticket closed')
      fetchAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to close ticket')
    }
  }

  // Admin Check
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <Shield className="h-16 w-16 mx-auto text-red-500 mb-4" />
            <h2 className="text-xl font-bold mb-2">Access Denied</h2>
            <p className="text-muted-foreground text-sm">
              You do not have administrator privileges to access this page. This area is restricted.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const s = overview?.stats
  const revenueChartData = overview?.revenueByMonth || []
  const growthData = Object.entries(overview?.userGrowth || {}).map(([day, count]) => ({ day, count }))
  const subPie = (overview?.subscriptionDistribution || []).map((d) => ({ name: d.tier, value: d.count, color: PIE_COLORS[0] }))
  const perfBars = (overview?.signalPerformance || []).map((d) => ({ name: d.status, count: d.count }))

  const filteredUsers = adminUsers.filter((u) => {
    const matchesSearch = !userSearch || u.name.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase())
    const matchesTier = userTierFilter === 'all' || u.tier === userTierFilter
    const matchesStatus = userStatusFilter === 'all' || u.status === userStatusFilter
    return matchesSearch && matchesTier && matchesStatus
  })

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-7 w-7" />
            Admin Panel
          </h1>
          <p className="text-sm text-muted-foreground">
            Live monitoring — all figures come directly from the database{overview ? ` · generated ${fmtDate(overview.generatedAt)}` : ''}
          </p>
        </div>
        <Badge className="gap-1 bg-red-500 text-white">
          <Shield className="h-3 w-3" /> {overview?.admin?.email || 'Admin'}
        </Badge>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span className="text-destructive">{error}</span>
          <Button variant="outline" size="sm" onClick={() => fetchAll()}>Retry</Button>
        </div>
      )}

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex flex-wrap gap-1 h-auto p-1">
          <TabsTrigger value="overview" className="gap-1.5 text-xs">Overview</TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5 text-xs">Users</TabsTrigger>
          <TabsTrigger value="payments" className="gap-1.5 text-xs">Payments</TabsTrigger>
          <TabsTrigger value="signals" className="gap-1.5 text-xs">Signals</TabsTrigger>
          <TabsTrigger value="news" className="gap-1.5 text-xs">News</TabsTrigger>
          <TabsTrigger value="calendar" className="gap-1.5 text-xs">Calendar</TabsTrigger>
          <TabsTrigger value="bots" className="gap-1.5 text-xs">Bots</TabsTrigger>
          <TabsTrigger value="analyses" className="gap-1.5 text-xs">Analyses</TabsTrigger>
          <TabsTrigger value="content" className="gap-1.5 text-xs">Coupons &amp; Tickets</TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5 text-xs">Activity</TabsTrigger>
          <TabsTrigger value="system" className="gap-1.5 text-xs">System</TabsTrigger>
        </TabsList>

        {/* ─── Overview ─────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {loading && !overview ? (
            <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <Card key={i}><CardContent className="p-4"><div className="h-16 rounded bg-muted animate-pulse" /></CardContent></Card>
              ))}
            </div>
          ) : !s ? (
            <EmptyState icon={AlertTriangle} text="No data available." />
          ) : (
            <>
              <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                <StatCard title="Total Users" value={s.users.total.toLocaleString()} icon={Users} sub={`${s.users.activeToday} active today`} />
                <StatCard title="Premium" value={s.users.premium.toLocaleString()} icon={Crown} sub={`${s.users.trial} on trial`} />
                <StatCard title="Banned" value={s.users.banned.toLocaleString()} icon={Ban} />
                <StatCard title="Total Revenue" value={fmtMoney(s.revenue.totalRevenue)} icon={DollarSign} sub={`${s.revenue.totalTransactions} completed txs`} />
                <StatCard title="Pending Payments" value={s.revenue.pendingTransactions.toLocaleString()} icon={Clock} />
              </div>
              <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                <StatCard title="Active Signals" value={s.signals.active.toLocaleString()} icon={Zap} sub={`${s.signals.total} total`} />
                <StatCard title="Open Tickets" value={s.support.openTickets.toLocaleString()} icon={MessageSquare} />
                <StatCard title="Analyses" value={s.analyses.total.toLocaleString()} icon={Cpu} sub={`${s.analyses.today} today`} />
                <StatCard title="Bot Connections" value={s.bots.connections.toLocaleString()} icon={Bot} sub={`${s.bots.running} running`} />
                <StatCard title="News Articles" value={s.content.news.toLocaleString()} icon={Newspaper} />
              </div>

              {/* ─── Revenue by Source (pie chart + table) ────────────── */}
              {s.revenue.summaryBySource && s.revenue.summaryBySource.length > 0 && (() => {
                const REVENUE_SOURCE_MAP: Record<string, { label: string; color: string }> = {
                  premium_payment: { label: 'Premium Subscriptions', color: '#10b981' },
                  copy_fee: { label: 'Copy Trading Fees', color: '#8b5cf6' },
                  bot_profit_share: { label: 'Bot Profit Share', color: '#f59e0b' },
                  referral_revenue: { label: 'Referral Revenue', color: '#06b6d4' },
                  ads_revenue: { label: 'Ads Revenue', color: '#ec4899' },
                }
                const sources = s.revenue.summaryBySource.map((entry) => ({
                  ...entry,
                  ...(REVENUE_SOURCE_MAP[entry.source] || { label: entry.source, color: '#64748b' }),
                }))
                const pieData = sources.map((src) => ({ name: src.label, value: Math.round(src.total * 100) / 100 }))
                return (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Revenue by Source</CardTitle>
                        <CardDescription>Platform earnings grouped by revenue stream</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                {sources.map((src, i) => <Cell key={i} fill={src.color} />)}
                              </Pie>
                              <Tooltip formatter={(value: number) => [`$${Math.round(value).toLocaleString()}`, 'Total']} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Revenue Breakdown</CardTitle>
                        <CardDescription>Total / available / paid per source</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Source</TableHead>
                              <TableHead className="text-right">Total</TableHead>
                              <TableHead className="text-right">Available</TableHead>
                              <TableHead className="text-right">Paid</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sources.map((src) => (
                              <TableRow key={src.source}>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: src.color }} />
                                    <span className="text-sm font-medium">{src.label}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">{fmtMoney(src.total)}</TableCell>
                                <TableCell className="text-right font-mono text-sm">{fmtMoney(src.available)}</TableCell>
                                <TableCell className="text-right font-mono text-sm">{fmtMoney(src.paid)}</TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="border-t-2">
                              <TableCell className="font-bold">Total</TableCell>
                              <TableCell className="text-right font-mono text-sm font-bold">{fmtMoney(sources.reduce((a, r) => a + r.total, 0))}</TableCell>
                              <TableCell className="text-right font-mono text-sm font-bold">{fmtMoney(sources.reduce((a, r) => a + r.available, 0))}</TableCell>
                              <TableCell className="text-right font-mono text-sm font-bold">{fmtMoney(sources.reduce((a, r) => a + r.paid, 0))}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </div>
                )
              })()}

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Revenue by month</CardTitle>
                    <CardDescription>Completed payments, last 12 months</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64">
                      {revenueChartData.length === 0 ? (
                        <EmptyState icon={BarChart3} text="No completed payments yet." />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={revenueChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                            <Tooltip formatter={(value: number) => [`$${Math.round(value).toLocaleString()}`, 'Revenue']} />
                            <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">User growth (30 days)</CardTitle>
                    <CardDescription>New registrations per day</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64">
                      {growthData.length === 0 ? (
                        <EmptyState icon={Users} text="No new signups in the last 30 days." />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={growthData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={9} interval={4} />
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Subscription distribution</CardTitle>
                    <CardDescription>Real user tiers</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64">
                      {subPie.length === 0 ? (
                        <EmptyState icon={Crown} text="No users yet." />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={subPie} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                              {subPie.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Signal performance</CardTitle>
                    <CardDescription>Signals grouped by real outcome</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64">
                      {perfBars.length === 0 ? (
                        <EmptyState icon={Zap} text="No signals yet." />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={perfBars}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Engagement stats */}
              <Card>
                <CardHeader><CardTitle className="text-base">Platform engagement</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {Object.entries(s.engagement || {}).map(([key, val]) => (
                      <div key={key} className="rounded-lg border p-3">
                        <p className="text-lg font-bold">{Number(val).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ─── Users ────────────────────────────────────────────────── */}
        <TabsContent value="users" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">User Management</CardTitle>
              <CardDescription>Real accounts from the database</CardDescription>
              <div className="flex flex-col sm:flex-row gap-3 mt-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search by name or email..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="pl-9" />
                </div>
                <Select value={userTierFilter} onValueChange={setUserTierFilter}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Tier" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tiers</SelectItem>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                    <SelectItem value="lifetime">Lifetime</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={userStatusFilter} onValueChange={setUserStatusFilter}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {filteredUsers.length === 0 ? (
                <EmptyState icon={Users} text="No users found." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Name</TableHead>
                        <TableHead className="text-xs">Email</TableHead>
                        <TableHead className="text-xs">Tier</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Joined</TableHead>
                        <TableHead className="text-xs">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="text-sm font-medium whitespace-nowrap">{u.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{u.email}</TableCell>
                          <TableCell><TierBadge tier={u.tier} /></TableCell>
                          <TableCell>
                            <Badge variant={u.status === 'active' ? 'default' : 'destructive'} className="text-xs capitalize">{u.status}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{u.joined}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <UserDetailDialog user={u} onChanged={fetchAll} />
                              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive"
                                onClick={async () => {
                                  try {
                                    await runAdminAction('suspend_user', { userId: u.id, duration: '7', reason: 'Admin action' })
                                    toast.success(`${u.name} suspended for 7 days`)
                                    fetchAll()
                                  } catch (e) {
                                    toast.error(e instanceof Error ? e.message : 'Suspension failed')
                                  }
                                }}>
                                <Ban className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Banned users */}
          <Card>
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Suspended / Banned Users</CardTitle></CardHeader>
            <CardContent>
              {adminUsers.filter((u) => u.isBanned).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No banned users.</p>
              ) : (
                <div className="space-y-3">
                  {adminUsers.filter((u) => u.isBanned).map((flagged) => (
                    <div key={flagged.id} className="p-3 rounded-lg border flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{flagged.name}</span>
                          <Badge variant="destructive" className="text-xs capitalize">banned</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{flagged.email}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{flagged.banReason || 'No reason recorded'}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 text-xs"
                        onClick={async () => {
                          try {
                            await runAdminAction('unban_user', { userId: flagged.id })
                            toast.success(`${flagged.name} unbanned`)
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Failed to unban')
                          }
                          fetchAll()
                        }}>
                        <UserCheck className="h-3 w-3 mr-1" /> Unban
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Payments ─────────────────────────────────────────────── */}
        <TabsContent value="payments" className="space-y-4 mt-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard title="Completed" value={(overview?.stats.revenue.totalTransactions ?? 0).toLocaleString()} icon={CheckCircle2} />
            <StatCard title="Pending" value={(overview?.stats.revenue.pendingTransactions ?? 0).toLocaleString()} icon={Clock} />
            <StatCard title="Total Received" value={fmtMoney(overview?.stats.revenue.totalRevenue)} icon={DollarSign} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-lg">Log Ad Revenue</CardTitle><CardDescription>Manually record external ad income (e.g. Google AdSense payout)</CardDescription></CardHeader>
              <CardContent>
                <AdRevenueForm onLogged={fetchAll} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-lg">Export Revenue Data</CardTitle><CardDescription>Download earnings ledger as CSV</CardDescription></CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" onClick={async () => {
                  const res = await fetch('/api/admin/overview')
                  const data = await res.json()
                  const bySource = data.data?.stats?.revenue?.summaryBySource || []
                  const byMonth = data.data?.revenueByMonth || []
                  const lines = ['Source,Total,Available,Paid']
                  for (const r of bySource) lines.push(`${r.source},${r.total},${r.available},${r.paid}`)
                  lines.push('')
                  lines.push('Month,Revenue,Count')
                  for (const m of byMonth) lines.push(`${m.month},${m.revenue},${m.count}`)
                  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url; a.download = `revenue_${new Date().toISOString().slice(0,10)}.csv`; a.click()
                  URL.revokeObjectURL(url)
                }}>Download CSV</Button>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-lg">Recent Payments</CardTitle><CardDescription>Latest completed transactions</CardDescription></CardHeader>
            <CardContent>
              {!overview || overview.recentPayments.length === 0 ? (
                <EmptyState icon={DollarSign} text="No payments yet." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">User</TableHead>
                        <TableHead className="text-xs">Plan</TableHead>
                        <TableHead className="text-xs">Amount</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">When</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.recentPayments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-sm whitespace-nowrap">{p.user?.name || '—'}<span className="text-xs text-muted-foreground"> · {p.user?.email}</span></TableCell>
                          <TableCell className="text-sm capitalize">{p.planType?.replace(/_/g, ' ')}</TableCell>
                          <TableCell className="text-sm">{fmtMoney(p.amount, p.currency)}</TableCell>
                          <TableCell><Badge variant={p.status === 'completed' ? 'default' : 'outline'} className="text-xs capitalize">{p.status}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDate(p.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Signals ──────────────────────────────────────────────── */}
        <TabsContent value="signals" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div className="grid gap-4 sm:grid-cols-3 flex-1">
              <StatCard title="Active" value={(overview?.stats.signals.active ?? 0).toLocaleString()} icon={Zap} />
              <StatCard title="Total" value={(overview?.stats.signals.total ?? 0).toLocaleString()} icon={BarChart3} />
              <StatCard title="Avg Confidence" value={adminSignals.length ? `${Math.round(adminSignals.reduce((a, s) => a + (s.confidence || 0), 0) / adminSignals.length)}%` : '—'} icon={TrendingUp} />
            </div>
            <CreateSignalDialog onCreated={fetchAll} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-lg">Signal Management</CardTitle><CardDescription>Real signal rows</CardDescription></CardHeader>
            <CardContent>
              {adminSignals.length === 0 ? (
                <EmptyState icon={Zap} text="No signals yet." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Asset</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs">Entry</TableHead>
                        <TableHead className="text-xs">TP1 / SL</TableHead>
                        <TableHead className="text-xs">Confidence</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Created</TableHead>
                        <TableHead className="text-xs">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adminSignals.map((sig) => (
                        <TableRow key={sig.id}>
                          <TableCell className="text-sm font-medium">{sig.asset}</TableCell>
                          <TableCell>
                            <Badge variant={sig.type === 'BUY' ? 'default' : sig.type === 'SELL' ? 'destructive' : 'outline'} className="text-xs">{sig.type}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{sig.entryPrice}</TableCell>
                          <TableCell className="text-xs">{sig.takeProfit1} / {sig.stopLoss}</TableCell>
                          <TableCell className="text-sm">{sig.confidence ?? '—'}%</TableCell>
                          <TableCell><Badge variant={sig.status === 'active' ? 'default' : 'outline'} className="text-xs">{sig.status}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDate(sig.createdAt)}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => closeSignal(sig)}>
                              {sig.status === 'active' ? 'Close' : 'Reopen'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── News ─────────────────────────────────────────────────── */}
        <TabsContent value="news" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <StatCard title="Articles" value={(overview?.stats.content.news ?? 0).toLocaleString()} icon={Newspaper} />
            <CreateNewsDialog onCreated={fetchAll} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-lg">News Feed</CardTitle><CardDescription>Real articles in the news feed</CardDescription></CardHeader>
            <CardContent>
              {!overview || overview.recentNews.length === 0 ? (
                <EmptyState icon={Newspaper} text="No articles yet." />
              ) : (
                <div className="space-y-2">
                  {overview.recentNews.map((a) => (
                    <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{a.title}</span>
                          <Badge variant="outline" className="text-xs shrink-0">{a.source}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{a.summary || '—'}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 capitalize">{a.sentiment || 'neutral'} · {fmtDate(a.publishedAt)}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive shrink-0" onClick={() => deleteArticle(a)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Calendar ─────────────────────────────────────────────── */}
        <TabsContent value="calendar" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <StatCard title="Upcoming events" value={(overview?.upcomingEvents?.length ?? 0).toLocaleString()} icon={CalendarDays} />
            <CreateEventDialog onCreated={fetchAll} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-lg">Economic Calendar</CardTitle><CardDescription>Real upcoming events</CardDescription></CardHeader>
            <CardContent>
              {!overview || overview.upcomingEvents.length === 0 ? (
                <EmptyState icon={CalendarDays} text="No upcoming events." />
              ) : (
                <div className="space-y-2">
                  {overview.upcomingEvents.map((ev) => (
                    <div key={ev.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{ev.eventName}</span>
                          <Badge variant={ev.impactLevel === 'high' ? 'destructive' : ev.impactLevel === 'medium' ? 'default' : 'outline'} className="text-xs">{ev.impactLevel}</Badge>
                          <Badge variant="outline" className="text-xs">{ev.currency}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{ev.eventType || ''} · Prev: {ev.previousValue || '—'} · Fcst: {ev.forecastValue || '—'}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{fmtDate(ev.eventDate)}</span>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => deleteEvent(ev)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Bots ─────────────────────────────────────────────────── */}
        <TabsContent value="bots" className="space-y-4 mt-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard title="Active Connections" value={(overview?.stats.bots.connections ?? 0).toLocaleString()} icon={Bot} />
            <StatCard title="Running Instances" value={(overview?.stats.bots.running ?? 0).toLocaleString()} icon={Cpu} />
            <StatCard title="Recent Trades" value={(overview?.recentBotTrades?.length ?? 0).toLocaleString()} icon={TrendingUp} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-lg">Bot Connections</CardTitle><CardDescription>MT5/MT4 engine connections</CardDescription></CardHeader>
            <CardContent>
              {!overview || overview.bots.length === 0 ? (
                <EmptyState icon={Bot} text="No bot connections." />
              ) : (
                <div className="space-y-2">
                  {overview.bots.map((b) => (
                    <div key={b.id} className="p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{b.label || b.platform}</span>
                          <Badge variant={b.isActive ? 'default' : 'outline'} className="text-xs">{b.isActive ? 'active' : 'inactive'}</Badge>
                          <span className="text-xs text-muted-foreground">{b.platform} · {b.brokerName || '—'} · {b.login}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{b.user?.name || b.user?.email}</span>
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                        <span>Realized PnL: {fmtMoney(b.realizedPnl)} · Settled: {fmtMoney(b.settledProviderAmount)} · Due: {fmtMoney(b.dueAmount ?? Math.max(0, (b.grossProfit || 0) * ((b.providerSharePct || 30) / 100) - (b.settledProviderAmount || 0)))}</span>
                        <span>Connected {fmtDate(b.lastConnectedAt)}</span>
                      </div>
                      {b.instances?.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {b.instances.map((inst: any) => (
                            <Badge key={inst.id} variant={inst.status === 'running' ? 'default' : 'outline'} className="text-xs">
                              {inst.status}{inst.lastError ? ` · ${inst.lastError}` : ''}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-lg">Recent Bot Trades</CardTitle></CardHeader>
            <CardContent>
              {!overview || overview.recentBotTrades.length === 0 ? (
                <EmptyState icon={TrendingUp} text="No bot trades recorded." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Symbol</TableHead>
                        <TableHead className="text-xs">Dir</TableHead>
                        <TableHead className="text-xs">Lots</TableHead>
                        <TableHead className="text-xs">Entry</TableHead>
                        <TableHead className="text-xs">Profit</TableHead>
                        <TableHead className="text-xs">Result</TableHead>
                        <TableHead className="text-xs">Closed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.recentBotTrades.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="text-sm">{t.symbol}</TableCell>
                          <TableCell><Badge variant={t.direction === 'BUY' ? 'default' : 'destructive'} className="text-xs">{t.direction}</Badge></TableCell>
                          <TableCell className="text-sm">{t.lots}</TableCell>
                          <TableCell className="text-sm">{t.entryPrice}</TableCell>
                          <TableCell className={`text-sm ${t.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtMoney(t.profit)}</TableCell>
                          <TableCell className="text-sm">{t.result || '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDate(t.closedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ─── Copy Trading & Referral Gate ─────────────────────────── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Copy Traders" value={(overview?.stats.copyTrading.traders ?? 0).toLocaleString()} icon={UserCheck} sub="provider profiles" />
            <StatCard title="Active Followers" value={(overview?.stats.copyTrading.followers ?? 0).toLocaleString()} icon={Activity} sub="active copy follows" />
            <StatCard title="Linked Masters" value={(overview?.stats.copyTrading.masters ?? 0).toLocaleString()} icon={Link2} sub="bot accounts used as master" />
            <StatCard title="Broker Profit Share Due" value={fmtMoney(overview?.stats.copyTrading.brokerProfitShareDue)} icon={Shield} sub={`${fmtMoney(overview?.stats.copyTrading.brokerProfitSharePaid)} paid to brokers · ${fmtMoney(overview?.stats.copyTrading.platformCopyFees)} platform fees`} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-lg">Referral Gate</CardTitle><CardDescription>Invite-only access for bot trading & copy trading</CardDescription></CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={overview?.stats.referralGate.enabled ? 'default' : 'outline'} className="text-xs">
                  {overview?.stats.referralGate.enabled ? 'ENABLED' : 'DISABLED'}
                </Badge>
                <Badge variant={overview?.stats.referralGate.codeConfigured ? 'default' : 'destructive'} className="text-xs">
                  {overview?.stats.referralGate.codeConfigured ? 'LOCK CODE SET' : 'LOCK CODE MISSING'}
                </Badge>
                <Badge variant={overview?.stats.referralGate.urlConfigured ? 'default' : 'destructive'} className="text-xs">
                  {overview?.stats.referralGate.urlConfigured ? 'CTA URL SET' : 'CTA URL MISSING'}
                </Badge>
                {overview?.stats.referralGate.enabled && (!overview.stats.referralGate.codeConfigured || !overview.stats.referralGate.urlConfigured) && (
                  <span className="text-xs text-amber-600">
                    Set REFERRAL_LOCK_CODE and REFERRAL_LOCK_URL in .env — without a lock code the gate allows any referred user.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Shield className="h-5 w-5" /> Copy Profit Settlements</CardTitle>
              <CardDescription>Provider profit share — dedicated on take-profits, paid into the broker account (never Binance)</CardDescription>
            </CardHeader>
            <CardContent>
              {!overview || overview.copySettlements.length === 0 ? (
                <EmptyState icon={Shield} text="No copy settlements yet." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Provider</TableHead>
                        <TableHead className="text-xs">Follower</TableHead>
                        <TableHead className="text-xs">Gross</TableHead>
                        <TableHead className="text-xs">Provider Share</TableHead>
                        <TableHead className="text-xs">Platform</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Dedicated</TableHead>
                        <TableHead className="text-xs"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.copySettlements.map((s) => {
                        const providerName = s.trader?.user?.name || s.trader?.user?.email || '—'
                        const isDue = s.status === 'due'
                        return (
                          <TableRow key={s.id}>
                            <TableCell className="text-sm">{providerName}</TableCell>
                            <TableCell className="text-sm">{s.follower?.name || s.follower?.email || '—'}</TableCell>
                            <TableCell className="text-sm">{fmtMoney(s.grossProfit)}</TableCell>
                            <TableCell className="text-sm font-medium text-green-600">{fmtMoney(s.providerAmount)}</TableCell>
                            <TableCell className="text-sm">{fmtMoney(s.platformAmount)}</TableCell>
                            <TableCell>
                              <Badge variant={isDue ? 'destructive' : 'default'} className="text-xs">{s.status}{s.settledBy && s.settledBy !== 'manual' ? ` · ${s.settledBy}` : ''}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{s.dedicatedAt ? fmtDate(s.dedicatedAt) : '—'}</TableCell>
                            <TableCell>
                              {isDue && (
                                <Button variant="outline" size="sm" className="h-7 text-xs"
                                  onClick={async () => {
                                    try {
                                      const res = await runAdminAction('settle_broker_copy', { targetUserId: s.trader?.user?.id })
                                      const r = res as { settled?: number; amount?: number } | undefined
                                      toast.success(r?.settled ? `Settled ${fmtMoney(r.amount ?? 0)} to broker (${r.settled} settlements)` : 'Nothing due to settle')
                                    } catch (e) {
                                      toast.error(e instanceof Error ? e.message : 'Failed to settle')
                                    }
                                    fetchAll()
                                  }}>
                                  <Shield className="h-3 w-3 mr-1" /> Settle to broker
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="analyses" className="space-y-4 mt-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard title="Total" value={(overview?.stats.analyses.total ?? 0).toLocaleString()} icon={Cpu} />
            <StatCard title="Today" value={(overview?.stats.analyses.today ?? 0).toLocaleString()} icon={Activity} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-lg">Screenshot Analyses</CardTitle><CardDescription>Real AI analyses</CardDescription></CardHeader>
            <CardContent>
              {!overview || overview.recentAnalyses.length === 0 ? (
                <EmptyState icon={Cpu} text="No analyses yet." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">User</TableHead>
                        <TableHead className="text-xs">Asset</TableHead>
                        <TableHead className="text-xs">Signal</TableHead>
                        <TableHead className="text-xs">Confidence</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">When</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.recentAnalyses.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-sm whitespace-nowrap">{a.user?.name || a.user?.email || '—'}</TableCell>
                          <TableCell className="text-sm">{a.detectedAsset || '—'}</TableCell>
                          <TableCell><Badge variant={a.signalType === 'BUY' ? 'default' : a.signalType === 'SELL' ? 'destructive' : 'outline'} className="text-xs">{a.signalType || '—'}</Badge></TableCell>
                          <TableCell className="text-sm">{a.confidence != null ? `${a.confidence}%` : '—'}</TableCell>
                          <TableCell><Badge variant={a.status === 'completed' ? 'default' : a.status === 'failed' ? 'destructive' : 'outline'} className="text-xs">{a.status}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDate(a.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Content (coupons + tickets) ──────────────────────────── */}
        <TabsContent value="content" className="space-y-4 mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Coupon Codes</CardTitle>
                  <CardDescription>Real promo codes</CardDescription>
                </div>
                <CreateCouponDialog onCreated={fetchAll} />
              </CardHeader>
              <CardContent>
                {adminCoupons.length === 0 ? (
                  <EmptyState icon={Tag} text="No coupons yet." />
                ) : (
                  <div className="space-y-2">
                    {adminCoupons.map((coupon) => {
                      const isActive = coupon.isActive !== undefined ? coupon.isActive : coupon.status === 'active'
                      const discount = coupon.discountAmount !== undefined
                        ? (coupon.discountType === 'percentage' ? `${coupon.discountAmount}%` : `$${coupon.discountAmount}`)
                        : coupon.discount
                      const uses = coupon.usedCount ?? coupon.uses ?? 0
                      return (
                        <div key={coupon.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                          <div>
                            <div className="flex items-center gap-2">
                              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-sm font-mono font-medium">{coupon.code}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {discount} off · {uses}/{coupon.maxUses ?? '∞'} used · Exp: {coupon.expiresAt ? new Date(coupon.expiresAt).toLocaleDateString() : 'never'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={isActive ? 'default' : 'outline'} className="text-xs capitalize">{isActive ? 'active' : 'inactive'}</Badge>
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggleCoupon(coupon)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><MessageSquare className="h-5 w-5" /> Support Tickets</CardTitle><CardDescription>Real tickets</CardDescription></CardHeader>
              <CardContent>
                {adminTickets.length === 0 ? (
                  <EmptyState icon={MessageSquare} text="No tickets yet." />
                ) : (
                  <ScrollArea className="max-h-[420px]">
                    <div className="space-y-2">
                      {adminTickets.map((ticket) => (
                        <div key={ticket.id} className="p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">{ticket.category}</Badge>
                              <Badge variant={ticket.status === 'open' ? 'default' : 'outline'} className="text-xs">{ticket.status}</Badge>
                              <span className="text-sm font-medium">{ticket.user?.name || ticket.user?.email || 'User'}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">{fmtDate(ticket.createdAt)}</span>
                          </div>
                          <p className="text-sm mt-1">{ticket.subject}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ticket.description}</p>
                          <Button variant="ghost" size="sm" className="h-7 text-xs mt-2" onClick={() => dismissTicket(ticket)}>
                            <XCircle className="h-3 w-3 mr-1" /> Close
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Activity / Audit ─────────────────────────────────────── */}
        <TabsContent value="audit" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Activity className="h-5 w-5" /> Live Activity Feed</CardTitle><CardDescription>Most recent user activity (real)</CardDescription></CardHeader>
            <CardContent>
              {!overview || overview.activityFeed.length === 0 ? (
                <EmptyState icon={Activity} text="No activity yet." />
              ) : (
                <ScrollArea className="max-h-96">
                  <div className="space-y-1.5">
                    {overview.activityFeed.map((log) => (
                      <div key={log.id} className="flex items-center gap-2 p-2 rounded bg-muted/30 text-xs">
                        <span className="font-medium">{log.user?.name || log.user?.email || 'System'}</span>
                        <span className="text-muted-foreground">· {log.action}</span>
                        {log.details && <span className="text-muted-foreground truncate">· {log.details}</span>}
                        <span className="ml-auto text-muted-foreground shrink-0">{fmtDate(log.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><FileText className="h-5 w-5" /> Admin Audit Log</CardTitle><CardDescription>Administrative actions (real)</CardDescription></CardHeader>
            <CardContent>
              {adminAudit.length === 0 ? (
                <EmptyState icon={FileText} text="No admin actions yet." />
              ) : (
                <ScrollArea className="max-h-64">
                  <div className="space-y-2">
                    {adminAudit.map((log) => (
                      <div key={log.id} className="flex items-center justify-between p-3 rounded-lg border text-sm">
                        <div className="flex items-center gap-3">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium capitalize">{(log.action || '').toLowerCase().replace(/_/g, ' ')}</span>
                          <span className="text-muted-foreground">→ {log.target || '—'}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{log.adminId?.slice(0, 8)} · {fmtDate(log.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── System ───────────────────────────────────────────────── */}
        <TabsContent value="system" className="space-y-4 mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Settings className="h-5 w-5" /> Feature Flags</CardTitle><CardDescription>Toggle features on and off</CardDescription></CardHeader>
              <CardContent>
                {flags.length === 0 ? (
                  <EmptyState icon={Settings} text="No feature flags configured." />
                ) : (
                  <div className="space-y-3">
                    {flags.map((flag) => (
                      <div key={flag.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                        <div>
                          <p className="text-sm font-medium">{flag.name}</p>
                          <p className="text-xs text-muted-foreground">{flag.description}</p>
                        </div>
                        <Switch checked={flag.enabled} disabled={savingFlagId === flag.id} onCheckedChange={(checked) => toggleFlag(flag.id, checked)} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Settings className="h-5 w-5" /> App Settings</CardTitle><CardDescription>Configure application parameters</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Trial Length (days)</label>
                    <Input type="number" value={appSettings.trialLength} onChange={(e) => setAppSettings((s) => ({ ...s, trialLength: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Premium Price ($)</label>
                    <Input type="number" step="0.01" value={appSettings.premiumPrice} onChange={(e) => setAppSettings((s) => ({ ...s, premiumPrice: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Pro Price ($)</label>
                    <Input type="number" step="0.01" value={appSettings.proPrice} onChange={(e) => setAppSettings((s) => ({ ...s, proPrice: e.target.value }))} />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <p className="text-sm font-medium">Maintenance Mode</p>
                      <p className="text-xs text-muted-foreground">Show maintenance page to users</p>
                    </div>
                    <Switch checked={appSettings.maintenanceMode} onCheckedChange={(checked) => setAppSettings((s) => ({ ...s, maintenanceMode: checked }))} />
                  </div>
                </div>
                <Button className="w-full" disabled={savingSettings} onClick={saveAppSettings}>
                  {savingSettings ? 'Saving...' : 'Save Settings'}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Platform status (honest) */}
          <Card>
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Activity className="h-5 w-5" /> Platform Status</CardTitle><CardDescription>Honest service status — reports what is actually configured on the server</CardDescription></CardHeader>
            <CardContent>
              {!overview ? (
                <EmptyState icon={Activity} text="Loading platform status…" />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
                    {[
                      { name: 'Payments enabled', ok: overview.platform.paymentsEnabled, detail: overview.platform.paymentsEnabled ? 'Live' : 'Disabled' },
                      { name: 'Stripe', ok: overview.platform.stripe, detail: overview.platform.stripe ? 'Configured' : 'Not configured' },
                      { name: 'Email (Resend)', ok: overview.platform.resend, detail: overview.platform.resend ? 'Configured' : 'Not configured' },
                      { name: 'Market data (Finnhub)', ok: overview.platform.finnhub, detail: overview.platform.finnhub ? 'Configured' : 'Not configured' },
                      { name: 'Push (VAPID)', ok: overview.platform.vapid, detail: overview.platform.vapid ? 'Configured' : 'Not configured' },
                      { name: 'Gemini AI', ok: overview.platform.gemini, detail: overview.platform.gemini ? 'Configured' : 'Not configured' },
                      { name: 'HuggingFace AI', ok: overview.platform.huggingface, detail: overview.platform.huggingface ? 'Configured' : 'Not configured' },
                      { name: 'Admin email lock', ok: overview.platform.adminLocked, detail: overview.platform.adminLocked ? 'Restricted' : 'Role-based only' },
                    ].map((service) => (
                      <div key={service.name} className="rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          {service.ok ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                          <span className="text-sm font-medium">{service.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{service.detail}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Server environment: {overview.platform.nodeEnv}</p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
