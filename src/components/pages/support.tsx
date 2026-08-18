'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Bug,
  Lightbulb,
  CreditCard,
  MessageCircle,
  Search,
  ThumbsUp,
  ThumbsDown,
  Plus,
  Paperclip,
  Clock,
  Mail,
  Activity,
  HelpCircle,
  ChevronRight,
  Send,
  X,
  Loader2,
  Star,
  StarHalf,
  MessageSquareQuote,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fileToResizedDataUrl } from '@/lib/file-to-data-url'
import { PoweredBy } from '@/components/branding/powered-by'

const CATEGORY_TO_API: Record<string, string> = {
  bug: 'bug',
  feature: 'feature_request',
  billing: 'support',
  technical: 'support',
  other: 'support',
}

// --- Help Content ---

const faqCategories = [
  {
    name: 'Getting Started',
    articles: [
      { id: 'a1', title: 'How do I create an account?', content: 'To create an account, click the "Sign Up" button on the homepage. You can register using your email address or sign in with Google. After verifying your email, you can complete your profile and start your free trial of Premium features.' },
      { id: 'a2', title: 'What is included in the free plan?', content: 'The free plan includes a limited number of daily signals, basic analysis, and standard support. Upgrade to Premium for unlimited signals, full screenshot analysis, and priority support. See the Pricing page for the exact current limits.' },
      { id: 'a3', title: 'How to set up my trading preferences?', content: 'Go to Settings → Trading Preferences. Here you can set your preferred markets (Forex, Crypto, Stocks), trading style (Scalping, Day Trading, Swing Trading), risk level (Conservative, Moderate, Aggressive), and preferred trading sessions. These preferences help us deliver more relevant signals.' },
    ],
  },
  {
    name: 'Account & Security',
    articles: [
      { id: 'a4', title: 'How do I enable two-factor authentication?', content: 'Go to Settings → Security → Two-Factor Authentication. Click "Enable 2FA" and scan the QR code with your authenticator app (Google Authenticator, Authy, etc.). Enter the 6-digit code to verify. We strongly recommend enabling 2FA to protect your account.' },
      { id: 'a5', title: 'I forgot my password. How do I reset it?', content: 'Click "Forgot Password" on the login page. Enter your registered email address and we\'ll send a password reset link. The link expires in 30 minutes. If you don\'t receive the email, check your spam folder or contact support.' },
      { id: 'a6', title: 'How do I delete my account?', content: 'Go to Settings → Account → Delete Account. Please note this action is irreversible. All your data, including signal history, watchlists, and community posts will be permanently deleted. If you have an active subscription, cancel it first before deleting your account.' },
    ],
  },
  {
    name: 'Signals & Analysis',
    articles: [
      { id: 'a7', title: 'How are signals generated?', content: 'Signals are generated using a combination of technical analysis, market data, and AI-powered pattern recognition. Each signal includes entry price, stop loss, take profit, and a confidence level. Always apply your own risk management before acting on any signal.' },
      { id: 'a8', title: 'What does signal accuracy mean?', content: 'Signal accuracy represents the percentage of signals that hit the take profit target before the stop loss. Track your results in the Performance page. Note that past performance never guarantees future results, and you should always use proper risk management.' },
      { id: 'a9', title: 'How to use screenshot analysis?', content: 'Navigate to the Screenshot Analysis page and upload a screenshot of any trading chart. Our AI will analyze the chart and identify: support/resistance levels, chart patterns, trend direction, key technical levels, and potential trade setups. Premium users get unlimited analyses with detailed reports.' },
    ],
  },
  {
    name: 'Subscriptions & Billing',
    articles: [
      { id: 'a10', title: 'What are the subscription plans available?', content: 'We offer Free, Trial (7 days), Premium (monthly/annual), and Lifetime plans. Premium includes unlimited signals, advanced analytics, and priority support. See the Pricing page for current prices.' },
      { id: 'a11', title: 'How do I cancel my subscription?', content: 'Go to Settings → Subscription → Manage Plan. Your Premium features will remain active until the end of your current billing period. You can re-subscribe at any time without losing your preferences.' },
      { id: 'a12', title: 'Can I get a refund?', content: 'Refunds are handled on a case-by-case basis in line with applicable law and the payment provider\'s policies. Contact support with your payment reference and we\'ll review your request.' },
    ],
  },
  {
    name: 'Technical Issues',
    articles: [
      { id: 'a13', title: 'The app is not loading. What should I do?', content: 'First, check your internet connection. Try refreshing the page or clearing your browser cache. If the issue persists, check our system status page for any ongoing outages. You can also try using a different browser or device. If the problem continues, please create a support ticket.' },
      { id: 'a14', title: 'Push notifications are not working', content: 'Make sure notifications are enabled in your browser settings and in the app\'s notification preferences. On mobile, check that the app has notification permissions in your device settings. If using Safari, you may need to add the app to your home screen for reliable notifications.' },
      { id: 'a15', title: 'Chart data is not updating', content: 'Chart data refreshes every 15 seconds during market hours. If data appears stale: 1) Check your internet connection, 2) Refresh the page, 3) Clear browser cache, 4) Try a different browser. If the issue persists, it may be a data feed issue - please report it to support.' },
    ],
  },
]

interface SupportTicket {
  id: string
  subject: string
  status: string
  category: string
  priority: string
  createdAt: string
  description?: string | null
}

interface PlatformStats {
  traders: number
  countries: number
  totalSignals: number
  totalPosts: number
}

interface Review {
  id: string
  rating: number
  title: string | null
  comment: string | null
  category: string
  status: string
  createdAt: string
  user?: { name: string | null; profilePicture: string | null; country: string | null }
}

interface ReviewStats {
  average: number
  total: number
  distribution: Array<{ star: number; count: number }>
}

// --- Status Helpers ---

function TicketStatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string }> = {
    open: { color: 'bg-green-100 text-green-700 border-green-200', label: 'Open' },
    in_progress: { color: 'bg-amber-100 text-amber-700 border-amber-200', label: 'In Progress' },
    resolved: { color: 'bg-gray-100 text-gray-600 border-gray-200', label: 'Resolved' },
    closed: { color: 'bg-gray-100 text-gray-500 border-gray-200', label: 'Closed' },
  }
  const c = config[status] || config.open
  return <Badge variant="outline" className={`text-xs ${c.color}`}>{c.label}</Badge>
}

// --- Create Ticket Dialog ---

function CreateTicketDialog() {
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState('')
  const [description, setDescription] = useState('')
  const [attachments, setAttachments] = useState<{ name: string; dataUrl: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const attachInputRef = useRef<HTMLInputElement>(null)

  const handleAttach = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please attach an image file')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Image too large. Maximum size is 8MB.')
      return
    }
    try {
      const dataUrl = await fileToResizedDataUrl(file, 1200, 0.8)
      setAttachments((prev) => [...prev, { name: file.name, dataUrl }])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to read image')
    }
  }

  const resetForm = () => {
    setSubject('')
    setCategory('')
    setPriority('')
    setDescription('')
    setAttachments([])
  }

  const handleSubmit = async () => {
    if (!subject || !category || !description) {
      toast.error('Please fill in all required fields')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/support', {
        subject,
        description,
        category: CATEGORY_TO_API[category] || 'support',
        priority: priority || 'medium',
        attachments: attachments.map((a) => a.dataUrl),
      })
      toast.success('Ticket created! We\'ll respond within 24 hours.')
      resetForm()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create ticket')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Create Ticket
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Support Ticket</DialogTitle>
          <DialogDescription>Describe your issue and we&apos;ll get back to you as soon as possible</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Subject</label>
            <Input placeholder="Brief description of your issue" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bug">Bug</SelectItem>
                  <SelectItem value="feature">Feature Request</SelectItem>
                  <SelectItem value="billing">Billing</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Description</label>
            <Textarea
              placeholder="Please describe your issue in detail..."
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => attachInputRef.current?.click()}>
              <Paperclip className="h-4 w-4" />
              Attach Screenshot
            </Button>
            <input
              ref={attachInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files
                if (files) {
                  for (const file of Array.from(files).slice(0, 5)) handleAttach(file)
                }
                e.target.value = ''
              }}
            />
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att, i) => (
                  <div key={`${att.name}-${i}`} className="relative">
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      className="size-16 rounded-lg border object-cover"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute -top-1.5 -right-1.5 size-5 rounded-full"
                      onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                      title="Remove attachment"
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Button
            className="w-full gap-2"
            disabled={!subject || !category || !description || submitting}
            onClick={handleSubmit}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? 'Creating...' : 'Submit Ticket'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// --- Ticket Detail Dialog ---

function TicketDetailDialog({ ticket }: { ticket: SupportTicket }) {
  const created = ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : '—'
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-xs">
          <ChevronRight className="h-3 w-3" /> View
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ticket {ticket.id}</DialogTitle>
          <DialogDescription>{ticket.subject}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Status</p>
              <TicketStatusBadge status={ticket.status} />
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Category</p>
              <p className="text-sm font-medium capitalize">{ticket.category}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="text-sm font-medium">{created}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Priority</p>
              <p className="text-sm font-medium capitalize">{ticket.priority || 'Medium'}</p>
            </div>
          </div>
          <Separator />
          <div>
            <h4 className="font-medium text-sm mb-2">Description</h4>
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium">You</span>
                <span className="text-xs text-muted-foreground">{created}</span>
              </div>
              <p className="text-sm">{ticket.description || ticket.subject}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Our team will respond to your ticket by email. Replies appear in your inbox, not in this dialog.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// --- Reviews & Feedback ---

function StarRating({ rating, size = 'h-4 w-4' }: { rating: number; size?: string }) {
  const full = Math.floor(rating)
  const half = rating - full >= 0.5
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => {
        const idx = i + 1
        if (idx <= full) return <Star key={idx} className={`${size} fill-amber-400 text-amber-400`} />
        if (half && idx === full + 1) return <StarHalf key={idx} className={`${size} fill-amber-400 text-amber-400`} />
        return <Star key={idx} className={`${size} text-muted-foreground/40`} />
      })}
    </div>
  )
}

function ReviewsTab() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [mine, setMine] = useState<Review[]>([])
  const [stats, setStats] = useState<ReviewStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('general')
  const [comment, setComment] = useState('')

  const fetchReviews = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get<{ data: { reviews: Review[]; mine: Review[]; stats: ReviewStats } }>('/reviews')
      setReviews(res?.data?.reviews || [])
      setMine(res?.data?.mine || [])
      setStats(res?.data?.stats || null)
    } catch {
      setReviews([])
      setMine([])
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReviews()
  }, [fetchReviews])

  const handleSubmit = async () => {
    if (rating < 1 || rating > 5) {
      toast.error('Please select a star rating')
      return
    }
    if (!title.trim() && !comment.trim()) {
      toast.error('Please add a title or a comment')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/reviews', {
        rating,
        title: title.trim(),
        comment: comment.trim(),
        category,
      })
      toast.success('Review submitted! It will appear once approved.')
      setRating(0)
      setTitle('')
      setComment('')
      setCategory('general')
      fetchReviews()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit review')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/reviews?id=${id}`)
      toast.success('Review deleted')
      fetchReviews()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete review')
    }
  }

  const maxCount = stats?.distribution?.reduce((m, d) => Math.max(m, d.count), 0) || 1
  const selectedStar = hoverRating || rating

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Summary */}
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-5xl font-bold tracking-tight">{stats?.average ? stats.average.toFixed(1) : '—'}</p>
            {stats?.average ? <StarRating rating={stats.average} size="h-5 w-5" /> : <StarRating rating={0} size="h-5 w-5" />}
            <p className="text-sm text-muted-foreground">Based on {stats?.total ?? 0} approved review{stats?.total === 1 ? '' : 's'}</p>
            <div className="space-y-1.5 pt-2">
              {(stats?.distribution || []).map((d) => (
                <div key={d.star} className="flex items-center gap-2 text-xs">
                  <span className="w-8 text-right text-muted-foreground shrink-0">{d.star} ★</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{ width: `${maxCount ? Math.round((d.count / maxCount) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="w-6 text-muted-foreground shrink-0">{d.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Write a review */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquareQuote className="h-5 w-5" /> Write a Review
            </CardTitle>
            <CardDescription>Tell us what you think about signals, analysis, or the app itself.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(star)}
                  className="p-0.5"
                  aria-label={`${star} star${star === 1 ? '' : 's'}`}
                >
                  <Star
                    className={`h-7 w-7 transition-colors ${star <= selectedStar ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`}
                  />
                </button>
              ))}
              <span className="text-sm text-muted-foreground ml-1">
                {selectedStar > 0 ? `${selectedStar}/5` : 'Select a rating'}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Title</label>
                <Input
                  placeholder="Short summary of your experience"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={100}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Category</label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="signals">Signals</SelectItem>
                    <SelectItem value="analysis">Screenshot Analysis</SelectItem>
                    <SelectItem value="support">Support</SelectItem>
                    <SelectItem value="app">App / Design</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Review</label>
              <Textarea
                placeholder="What do you like? What could be better?"
                rows={4}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={2000}
              />
            </div>
            <Button className="gap-2" disabled={submitting} onClick={handleSubmit}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
              {submitting ? 'Submitting...' : 'Submit Review'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Reviews are moderated. Once approved, your review appears publicly with your display name.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* My reviews */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Reviews</CardTitle>
        </CardHeader>
        <CardContent>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">You haven&apos;t written any reviews yet.</p>
          ) : (
            <ScrollArea className="max-h-72">
              <div className="space-y-3">
                {mine.map((r) => (
                  <div key={r.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StarRating rating={r.rating} />
                        <p className="text-sm font-medium truncate">{r.title || 'Review'}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant="outline"
                          className={
                            r.status === 'approved'
                              ? 'text-green-600 border-green-200 bg-green-50'
                              : r.status === 'rejected'
                                ? 'text-red-600 border-red-200 bg-red-50'
                                : 'text-amber-600 border-amber-200 bg-amber-50'
                          }
                        >
                          {r.status}
                        </Badge>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDelete(r.id)} aria-label="Delete review">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {r.comment && <p className="text-sm text-muted-foreground mt-1.5">{r.comment}</p>}
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {r.category} · {new Date(r.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Public reviews */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Community Reviews</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No approved reviews yet. Be the first to share your experience.
            </p>
          ) : (
            <ScrollArea className="max-h-96">
              <div className="space-y-3">
                {reviews.map((r) => (
                  <div key={r.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="size-8 shrink-0">
                          <AvatarImage src={r.user?.profilePicture || undefined} />
                          <AvatarFallback>{(r.user?.name || 'U').slice(0, 1).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{r.user?.name || 'TopTier User'}</p>
                            {r.user?.country && <span className="text-xs text-muted-foreground shrink-0">({r.user.country})</span>}
                          </div>
                          <p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="shrink-0">
                        <StarRating rating={r.rating} />
                      </div>
                    </div>
                    {r.title && <p className="text-sm font-medium mt-2">{r.title}</p>}
                    {r.comment && <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{r.comment}</p>}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// --- Main Component ---

export default function SupportPage() {
  const [activeTab, setActiveTab] = useState('help')
  const [faqSearch, setFaqSearch] = useState('')
  const [helpfulArticles, setHelpfulArticles] = useState<Record<string, 'up' | 'down' | null>>({})
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const [stats, setStats] = useState<PlatformStats | null>(null)

  const fetchTickets = useCallback(async () => {
    try {
      setTicketsLoading(true)
      const res = await api.get<{ data: { tickets: SupportTicket[] } }>('/support')
      setTickets(res?.data?.tickets || [])
    } catch {
      setTickets([])
    } finally {
      setTicketsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTickets()
    api.get<{ data: PlatformStats }>('/platform/stats')
      .then((res) => setStats(res?.data || null))
      .catch(() => setStats(null))
  }, [fetchTickets])

  const filteredCategories = faqCategories.map((cat) => ({
    ...cat,
    articles: cat.articles.filter(
      (a) =>
        !faqSearch ||
        a.title.toLowerCase().includes(faqSearch.toLowerCase()) ||
        a.content.toLowerCase().includes(faqSearch.toLowerCase())
    ),
  })).filter((cat) => cat.articles.length > 0)

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md mx-auto">
          <TabsTrigger value="help" className="gap-2">
            <MessageCircle className="h-4 w-4" /> Get Help
          </TabsTrigger>
          <TabsTrigger value="reviews" className="gap-2">
            <Star className="h-4 w-4" /> Reviews &amp; Feedback
          </TabsTrigger>
        </TabsList>

        <TabsContent value="help" className="space-y-6 mt-6">
      {/* Hero Header — visually distinct so users immediately know they're in Support */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 md:p-8">
        <div className="absolute -right-12 -top-12 size-40 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/20">
              <HelpCircle className="h-7 w-7 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  Support Center
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" /> All systems operational
                </span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                How can we help you?
              </h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                Search our help center, chat with our AI assistant, or create a support ticket.
                Our team is here to help you get the most out of TopTier.
              </p>
            </div>
          </div>
          <div className="flex md:flex-col gap-2 shrink-0">
            <CreateTicketDialog />
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => toast.info('Live chat is available from the chat bubble in the corner of your screen.')}
            >
              <MessageCircle className="h-4 w-4" /> Live Chat
            </Button>
          </div>
        </div>
      </div>

      {/* Quick Help Cards */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
        {[
          { title: 'Report a Bug', icon: Bug, color: 'text-red-500', bg: 'bg-red-500/10', desc: 'Found an issue? Let us know' },
          { title: 'Request a Feature', icon: Lightbulb, color: 'text-amber-500', bg: 'bg-amber-500/10', desc: 'Suggest improvements' },
          { title: 'Billing Question', icon: CreditCard, color: 'text-blue-500', bg: 'bg-blue-500/10', desc: 'Payment & subscription help' },
          { title: 'General Support', icon: MessageCircle, color: 'text-green-500', bg: 'bg-green-500/10', desc: 'Any other questions' },
          { title: 'Leave a Review', icon: Star, color: 'text-amber-500', bg: 'bg-amber-500/10', desc: 'Rate your experience', review: true },
        ].map((item) => (
          <Card
            key={item.title}
            className="cursor-pointer transition-all hover:shadow-md hover:border-primary/30"
            onClick={() => {
              if (item.review) setActiveTab('reviews')
              else toast.info(`${item.title} — Please create a support ticket below`)
            }}
          >
            <CardContent className="p-4 text-center space-y-2">
              <div className={`mx-auto w-10 h-10 rounded-full ${item.bg} flex items-center justify-center`}>
                <item.icon className={`h-5 w-5 ${item.color}`} />
              </div>
              <h3 className="font-semibold text-sm">{item.title}</h3>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* FAQ Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Help Center</CardTitle>
          <CardDescription>Browse our FAQ articles or search for answers</CardDescription>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search help articles..."
              value={faqSearch}
              onChange={(e) => setFaqSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full">
            {filteredCategories.map((category) => (
              <AccordionItem key={category.name} value={category.name}>
                <AccordionTrigger className="text-sm font-semibold hover:no-underline">
                  {category.name} ({category.articles.length})
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-1">
                    {category.articles.map((article) => (
                      <Accordion key={article.id} type="single" collapsible>
                        <AccordionItem value={article.id} className="border rounded-lg px-4">
                          <AccordionTrigger className="text-sm hover:no-underline py-3">
                            {article.title}
                          </AccordionTrigger>
                          <AccordionContent>
                            <p className="text-sm text-muted-foreground leading-relaxed">{article.content}</p>
                            <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                              <span className="text-xs text-muted-foreground">Was this helpful?</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className={`h-7 w-7 p-0 ${helpfulArticles[article.id] === 'up' ? 'text-green-600 bg-green-50' : ''}`}
                                onClick={() => {
                                  setHelpfulArticles((prev) => ({ ...prev, [article.id]: 'up' }))
                                  toast.success('Thanks for your feedback!')
                                }}
                              >
                                <ThumbsUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className={`h-7 w-7 p-0 ${helpfulArticles[article.id] === 'down' ? 'text-red-600 bg-red-50' : ''}`}
                                onClick={() => {
                                  setHelpfulArticles((prev) => ({ ...prev, [article.id]: 'down' }))
                                  toast.success('We\'ll work on improving this article.')
                                }}
                              >
                                <ThumbsDown className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          {filteredCategories.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p className="font-medium">No articles found</p>
              <p className="text-sm">Try different search terms or create a support ticket</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tickets Section */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* My Tickets */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">My Tickets</CardTitle>
              <CardDescription>Track and manage your support requests</CardDescription>
            </div>
            <CreateTicketDialog />
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-80">
              {ticketsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : tickets.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <MessageCircle className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="font-medium">No tickets yet</p>
                  <p className="text-sm">Create a ticket and it will appear here.</p>
                </div>
              ) : (
              <div className="space-y-2">
                {tickets.map((ticket) => (
                  <div key={ticket.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">{ticket.id.slice(0, 8)}</span>
                        <TicketStatusBadge status={ticket.status} />
                      </div>
                      <p className="text-sm font-medium mt-0.5 truncate">{ticket.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString() : '—'} · {ticket.category}
                      </p>
                    </div>
                    <TicketDetailDialog ticket={ticket} />
                  </div>
                ))}
              </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Live Platform Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Live Platform Stats
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold">{stats.traders.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Traders</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold">{stats.countries.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Countries</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold">{stats.totalSignals.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Signals</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold">{stats.totalPosts.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Community Posts</p>
                  </div>
                </div>
                <Separator />
                <p className="text-xs text-muted-foreground">Figures are fetched live from the database.</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Platform stats are currently unavailable.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Contact Info */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Email Support</p>
                <p className="text-sm text-muted-foreground">support@toptier.app</p>
              </div>
            </div>
            <Separator orientation="vertical" className="hidden sm:block h-10" />
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-sm">
                  <span className="font-medium">Premium:</span> <span className="text-muted-foreground">&lt; 4 hours</span>
                </p>
                <p className="text-sm">
                  <span className="font-medium">Free:</span> <span className="text-muted-foreground">&lt; 24 hours</span>
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

        </TabsContent>

        <TabsContent value="reviews" className="mt-6">
          <ReviewsTab />
        </TabsContent>
      </Tabs>

      <PoweredBy />
    </div>
  )
}
