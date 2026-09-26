'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Capacitor } from '@capacitor/core'
import {
  BookOpen,
  BookMarked,
  Lock,
  Check,
  X,
  Loader2,
  Wallet,
  Smartphone,
  CreditCard,
  Phone,
  Building,
  ShieldCheck,
  ArrowLeft,
  ExternalLink,
  BadgeCheck,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { PAYMENTS_ENABLED } from '@/lib/flags'
import { isAdminRole } from '@/lib/admin-permissions'
import { toast } from 'sonner'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { enableScreenSecurity, disableScreenSecurity } from '@/lib/screen-security'

interface EBookInfo {
  id: string
  slug: string
  title: string
  author: string
  coverColor: string
  emoji: string | null
  description: string
  category: string
  level: string
  price: number
  isActive: boolean
  owned: boolean
  updatedAt: string
}

interface EBookFull extends EBookInfo {
  content: string
}

interface PaymentProviderInfo {
  id: string
  name: string
  icon: string
  description: string
  supportedCurrencies: string[]
  supportedCountries: string[]
  isAvailable: boolean
  checkoutConfig?: Record<string, string>
}

const providerIcons: Record<string, React.ReactNode> = {
  'credit-card': <CreditCard className="size-5" />,
  smartphone: <Smartphone className="size-5" />,
  phone: <Phone className="size-5" />,
  building: <Building className="size-5" />,
  wallet: <Wallet className="size-5" />,
}

const COVER_STYLES: Record<string, string> = {
  indigo: 'from-indigo-500 via-indigo-600 to-indigo-800',
  cyan: 'from-cyan-400 via-sky-500 to-blue-700',
  emerald: 'from-emerald-400 via-emerald-500 to-teal-700',
  amber: 'from-amber-400 via-orange-500 to-rose-600',
  rose: 'from-rose-400 via-rose-500 to-red-700',
  slate: 'from-slate-400 via-slate-500 to-slate-700',
}

const LEVEL_COLORS: Record<string, string> = {
  beginner: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  intermediate: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  advanced: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
}

function formatInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-slate-50">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return (
        <em key={i} className="italic text-slate-300">
          {part.slice(1, -1)}
        </em>
      )
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}

function renderMarkdown(content: string): React.ReactNode[] {
  const lines = content.split('\n')
  const out: React.ReactNode[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null
  let paragraph: string[] = []

  const flushParagraph = (key: number) => {
    if (paragraph.length > 0) {
      out.push(
        <p key={key} className="text-[15px] leading-relaxed text-slate-300">
          {formatInline(paragraph.join(' '))}
        </p>
      )
      paragraph = []
    }
  }
  const flushList = (key: number) => {
    if (list) {
      const Tag = list.type === 'ol' ? 'ol' : 'ul'
      out.push(
        <Tag key={key} className={cn('space-y-1.5 text-[15px] text-slate-300', list.type === 'ol' ? 'list-decimal' : 'list-disc')}>
          {list.items.map((item, i) => (
            <li key={i} className="ml-5">
              {formatInline(item)}
            </li>
          ))}
        </Tag>
      )
      list = null
    }
  }

  let key = 0
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushParagraph(key++)
      flushList(key++)
      continue
    }
    if (line.startsWith('## ')) {
      flushParagraph(key++)
      flushList(key++)
      out.push(
        <h2 key={key++} className="mt-8 mb-3 font-display text-xl font-bold text-slate-50">
          {formatInline(line.slice(3))}
        </h2>
      )
      continue
    }
    if (line.startsWith('# ')) {
      flushParagraph(key++)
      flushList(key++)
      out.push(
        <h1 key={key++} className="mt-2 mb-4 font-display text-2xl font-bold text-slate-50">
          {formatInline(line.slice(2))}
        </h1>
      )
      continue
    }
    if (/^[-•]\s/.test(line)) {
      flushParagraph(key++)
      if (!list) list = { type: 'ul', items: [] }
      if (list.type !== 'ul') {
        flushList(key++)
        list = { type: 'ul', items: [] }
      }
      list.items.push(line.replace(/^[-•]\s/, ''))
      continue
    }
    if (/^\d+\.\s/.test(line)) {
      flushParagraph(key++)
      if (!list) list = { type: 'ol', items: [] }
      if (list.type !== 'ol') {
        flushList(key++)
        list = { type: 'ol', items: [] }
      }
      list.items.push(line.replace(/^\d+\.\s/, ''))
      continue
    }
    flushList(key++)
    paragraph.push(line)
  }
  flushParagraph(key++)
  flushList(key++)
  return out
}

export function EBooksPage() {
  const user = useStore((s) => s.user)
  const setPage = useStore((s) => s.setPage)

  const isAdmin = isAdminRole(user?.role || '')

  const [books, setBooks] = useState<EBookInfo[]>([])
  const [loading, setLoading] = useState(true)

  const [target, setTarget] = useState<EBookInfo | null>(null)
  const [providers, setProviders] = useState<PaymentProviderInfo[]>([])
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [walletBalance, setWalletBalance] = useState(0)
  const [payPhone, setPayPhone] = useState('')
  const [payBank, setPayBank] = useState('')
  const [payReference, setPayReference] = useState('')
  const [processingPayment, setProcessingPayment] = useState(false)
  const [pesapalCheckoutUrl, setPesapalCheckoutUrl] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const [reader, setReader] = useState<EBookFull | null>(null)
  const [reading, setReading] = useState(false)

  const loadBooks = useCallback(async () => {
    try {
      const res = await api.get('/ebooks')
      const data = res as { books: EBookInfo[] }
      setBooks(data.books || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load e-books')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchProviders = useCallback(async () => {
    try {
      const result = await api.get('/payments/providers')
      const data = result as { providers: PaymentProviderInfo[]; walletBalanceUSD?: number }
      if (data?.providers) {
        setProviders(data.providers)
        setWalletBalance(typeof data.walletBalanceUSD === 'number' ? data.walletBalanceUSD : 0)
      }
    } catch {
      // Silently fail — providers stay empty
    }
  }, [])

  useEffect(() => {
    loadBooks()
    fetchProviders()
    return () => {
      cancelledRef.current = true
    }
  }, [loadBooks, fetchProviders])

  const openReader = useCallback(
    async (bookId: string) => {
      setReading(true)
      try {
        const res = await api.get(`/ebooks/${bookId}`)
        const data = res as { book: EBookFull; locked?: boolean; owned?: boolean }
        if (data.locked && !data.owned) {
          toast.error('You have not purchased this e-book yet.')
          return
        }
        setReader(data.book)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to open the e-book')
      } finally {
        setReading(false)
      }
    },
    []
  )

  // DRM: block text selection, copy/paste/print hotkeys and the context menu
  // while a book is open — plus native FLAG_SECURE on Android.
  useEffect(() => {
    if (reader) {
      enableScreenSecurity()
    } else {
      disableScreenSecurity()
    }
    return () => {
      disableScreenSecurity()
    }
  }, [reader])

  useEffect(() => {
    if (!reader) return
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && ['c', 'x', 'p', 's', 'a', 'u'].includes(k)) {
        e.preventDefault()
      }
      if (e.key === 'PrintScreen' || e.key === 'F12' || e.keyCode === 44) {
        e.preventDefault()
      }
    }
    const noCopy = (e: Event) => e.preventDefault()
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('contextmenu', noCopy)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('contextmenu', noCopy)
    }
  }, [reader])

  // Poll /api/ebooks/:id until the book unlocks (PesaPal, M-Pesa, manual).
  const pollForUnlock = useCallback(
    async (bookId: string) => {
      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise((r) => setTimeout(r, 4000))
        if (cancelledRef.current) return
        try {
          const res = await api.get(`/ebooks/${bookId}`)
          const data = res as { owned?: boolean }
          if (data.owned) {
            toast.success('Payment confirmed — your e-book is unlocked!')
            setPesapalCheckoutUrl(null)
            setTarget(null)
            setSelectedProvider(null)
            loadBooks()
            openReader(bookId)
            return
          }
        } catch {
          // keep polling
        }
      }
    },
    [loadBooks, openReader]
  )

  const handleCheckout = async () => {
    if (!target || !selectedProvider) return
    if (!PAYMENTS_ENABLED) {
      toast.info('Online payments are temporarily disabled. Please try again later.')
      return
    }
    const IN_APP_MANUAL = ['bank', 'airtel', 'mtn']
    const MOBILE = ['mpesa', 'airtel', 'mtn']
    const metadata: Record<string, string> = { book: target.slug }
    if (MOBILE.includes(selectedProvider)) {
      const digits = payPhone.replace(/[^0-9]/g, '')
      if (digits.length < 9) {
        toast.error('Please enter a valid phone number')
        return
      }
      metadata.phone = payPhone.trim()
    } else if (selectedProvider === 'bank') {
      if (!payBank) {
        toast.error('Please select your bank')
        return
      }
      if (!payReference.trim()) {
        toast.error('Please enter the payment reference')
        return
      }
      metadata.bank = payBank
      metadata.reference = payReference.trim()
    }
    setProcessingPayment(true)
    try {
      const result = await api.post('/payments/init', {
        provider: selectedProvider,
        planType: 'ebook',
        couponCode: undefined,
        metadata,
      })
      const data = result as Record<string, unknown>
      const payment = data.payment as Record<string, unknown> | undefined

      if (selectedProvider === 'wallet') {
        setTarget(null)
        setSelectedProvider(null)
        toast.success('Payment successful — your e-book is unlocked!')
        loadBooks()
        openReader(target.id)
      } else if (payment?.checkoutUrl && ![...IN_APP_MANUAL, 'mpesa'].includes(selectedProvider)) {
        if (Capacitor.isNativePlatform()) {
          window.open(payment.checkoutUrl as string, '_system')
          toast.info('Opening the payment page — your e-book unlocks automatically once payment is confirmed.')
          pollForUnlock(target.id)
        } else {
          setPesapalCheckoutUrl(payment.checkoutUrl as string)
          pollForUnlock(target.id)
        }
      } else if (selectedProvider === 'bank') {
        toast.success('Request received! Your e-book unlocks once your transfer is confirmed.')
        setTarget(null)
        setSelectedProvider(null)
        setPayPhone('')
        setPayBank('')
        setPayReference('')
        pollForUnlock(target.id)
      } else if (MOBILE.includes(selectedProvider) && selectedProvider !== 'mpesa') {
        toast.success(
          `Request received! Complete the payment on your ${selectedProvider === 'airtel' ? 'Airtel Money' : 'MTN MoMo'} phone, and your e-book unlocks once it is confirmed.`
        )
        setTarget(null)
        setSelectedProvider(null)
        setPayPhone('')
        pollForUnlock(target.id)
      } else {
        toast.success('Payment prompt sent! Enter your M-Pesa PIN on your phone to approve.')
        setTarget(null)
        setSelectedProvider(null)
        setPayPhone('')
        pollForUnlock(target.id)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to initiate payment')
    } finally {
      setProcessingPayment(false)
    }
  }

  const selectedProviderInfo = providers.find((p) => p.id === selectedProvider)
  const bankDetails = selectedProviderInfo?.checkoutConfig || {}
  let banks: string[] = []
  try {
    const parsed = bankDetails.banks ? JSON.parse(bankDetails.banks) : []
    banks = Array.isArray(parsed) ? parsed : []
  } catch {
    banks = []
  }

  const ownedBooks = books.filter((b) => b.owned)
  const catalog = isAdmin ? books.filter((b) => !b.owned) : books.filter((b) => !b.owned)
  const email = user?.email || 'Guest'
  const watermark = Array.from({ length: 30 }, (_, idx) => idx)

  return (
    <div className="p-4 md:p-6 space-y-8 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold">TOPTIER E-Books</h1>
            <Badge className="bg-[#1b4f9c]/10 text-[#1b4f9c] border-[#1b4f9c]/20">Library</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Pro trading guides you own forever — $1.50 per book, unlocked instantly, read inside the app.
          </p>
        </div>
        <Badge variant="outline" className="w-fit gap-1 text-xs">
          <ShieldCheck className="size-3.5 text-emerald-500" /> Licensed copies · protected against screenshots & sharing
        </Badge>
      </div>

      {/* My Library */}
      {ownedBooks.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <BookMarked className="size-5 text-[#1b4f9c]" />
            <h2 className="font-display text-lg font-bold">My Library</h2>
            <span className="text-xs text-muted-foreground">({ownedBooks.length})</span>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {ownedBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                admin={isAdmin}
                onBuy={() => {}}
                onRead={() => openReader(book.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Catalog */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen className="size-5 text-[#1b4f9c]" />
          <h2 className="font-display text-lg font-bold">Browse Titles</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin mr-2" /> Loading library…
          </div>
        ) : catalog.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            {isAdmin ? 'No un-owned books in the catalog yet.' : 'New titles are on the way. Your library is up to date.'}
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                admin={isAdmin}
                onBuy={() => {
                  cancelledRef.current = false
                  setTarget(book)
                  setSelectedProvider(null)
                  setPesapalCheckoutUrl(null)
                }}
                onRead={() => openReader(book.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Purchase modal */}
      {target && !pesapalCheckoutUrl && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Buy “{target.title}”</h3>
                <button
                  onClick={() => {
                    cancelledRef.current = true
                    setTarget(null)
                    setSelectedProvider(null)
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                One-time <span className="font-semibold text-foreground">${target.price.toFixed(2)} USD</span> — you keep the book forever in your library.
              </p>

              {!PAYMENTS_ENABLED && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400">
                  Online payments are temporarily disabled. Please check back shortly.
                </div>
              )}

              {PAYMENTS_ENABLED && (
                <div className="space-y-2">
                  {providers.map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => setSelectedProvider(provider.id)}
                      disabled={!provider.isAvailable}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                        selectedProvider === provider.id
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                          : provider.isAvailable
                          ? 'border-border hover:border-primary/30 hover:bg-muted/50'
                          : 'border-border/50 opacity-50 cursor-not-allowed'
                      )}
                    >
                      <div
                        className={cn(
                          'flex size-10 items-center justify-center rounded-lg',
                          selectedProvider === provider.id ? 'bg-primary/10' : 'bg-muted'
                        )}
                      >
                        {providerIcons[provider.icon] || <CreditCard className="size-5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{provider.name}</p>
                          {!provider.isAvailable && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              Coming Soon
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {provider.description}
                          {provider.id === 'wallet' && (
                            <span className="mt-1 block font-medium text-emerald-500/90">
                              Balance: ${walletBalance.toFixed(2)} USD
                            </span>
                          )}
                        </p>
                      </div>
                      {selectedProvider === provider.id && <BadgeCheck className="size-5 text-primary shrink-0" />}
                    </button>
                  ))}
                </div>
              )}

              {selectedProvider === 'mpesa' && (
                <div className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-4">
                  <div className="space-y-1.5">
                    <Label>M-Pesa phone number</Label>
                    <Input type="tel" placeholder="07XXXXXXXX" value={payPhone} onChange={(e) => setPayPhone(e.target.value)} />
                    <p className="text-xs text-muted-foreground">
                      We’ll send a payment prompt to this phone — approve it with your M-Pesa PIN. No external site is opened.
                    </p>
                  </div>
                </div>
              )}

              {(selectedProvider === 'airtel' || selectedProvider === 'mtn') && (
                <div className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-4">
                  <div className="space-y-1.5">
                    <Label>{selectedProvider === 'airtel' ? 'Airtel Money' : 'MTN MoMo'} phone number</Label>
                    <Input type="tel" placeholder="07XXXXXXXX" value={payPhone} onChange={(e) => setPayPhone(e.target.value)} />
                    <p className="text-xs text-muted-foreground">
                      Pay from your {selectedProvider === 'airtel' ? 'Airtel Money' : 'MTN MoMo'} wallet, then your e-book unlocks once we confirm.
                    </p>
                  </div>
                </div>
              )}

              {selectedProvider === 'bank' && (
                <div className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-4">
                  <div className="space-y-1.5">
                    <Label>Send money from this bank</Label>
                    <select
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      value={payBank}
                      onChange={(e) => setPayBank(e.target.value)}
                    >
                      <option value="">Select your bank…</option>
                      {banks.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                  {Object.keys(bankDetails).length > 0 && (
                    <div className="rounded-lg border bg-background p-3 text-xs">
                      <p className="mb-1 font-medium">Send to:</p>
                      {bankDetails.accountName && <p>{bankDetails.accountName}</p>}
                      {bankDetails.accountNumber && <p>Account: {bankDetails.accountNumber}</p>}
                      {bankDetails.bankName && <p>Bank: {bankDetails.bankName}</p>}
                      {bankDetails.tillNumber && <p>M-Pesa Till / Paybill: {bankDetails.tillNumber}</p>}
                      {bankDetails.phone && <p>Confirm with us: {bankDetails.phone}</p>}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label>Payment reference</Label>
                    <Input
                      placeholder="Reference / code from your transfer"
                      value={payReference}
                      onChange={(e) => setPayReference(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {selectedProvider === 'wallet' && (
                <div className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Wallet balance</Label>
                      <span className="text-sm font-semibold text-emerald-500">${walletBalance.toFixed(2)} USD</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      We’ll deduct ${target.price.toFixed(2)} instantly from your wallet.
                      {walletBalance < target.price ? (
                        <span className="text-amber-500"> You need more balance — top up your wallet or pick another method.</span>
                      ) : (
                        <span> Your e-book unlocks immediately.</span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    cancelledRef.current = true
                    setTarget(null)
                    setSelectedProvider(null)
                  }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={
                    !selectedProvider ||
                    processingPayment ||
                    !PAYMENTS_ENABLED ||
                    (selectedProvider === 'wallet' && walletBalance < target.price)
                  }
                  onClick={handleCheckout}
                >
                  {processingPayment ? (
                    <>
                      <Loader2 className="size-4 mr-1 animate-spin" /> Processing…
                    </>
                  ) : selectedProvider === 'wallet' ? (
                    <>
                      <Wallet className="size-4 mr-1" /> Pay from Wallet
                    </>
                  ) : selectedProvider === 'bank' ? (
                    <>
                      <Check className="size-4 mr-1" /> Submit for Confirmation
                    </>
                  ) : (
                    <>
                      <Lock className="size-4 mr-1" /> Unlock for ${target.price.toFixed(2)}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PesaPal iframe */}
      {pesapalCheckoutUrl && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[95vh] flex flex-col overflow-hidden">
            <div className="p-4 flex items-center justify-between border-b border-border">
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-[#1b4f9c]" />
                <div>
                  <p className="text-sm font-semibold">Waiting for payment…</p>
                  <p className="text-xs text-muted-foreground">
                    Complete the payment in the window below — your e-book unlocks automatically.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  cancelledRef.current = true
                  setPesapalCheckoutUrl(null)
                  setTarget(null)
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            <iframe
              src={pesapalCheckoutUrl}
              className="w-full flex-1 min-h-[460px] bg-white"
              title="PesaPal secure checkout"
            />
          </div>
        </div>
      )}

      {/* Reader */}
      {reader && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[70] bg-[#0a0e14] flex flex-col"
        >
          {/* Reader header */}
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-[#0f1622]/95 px-4 py-3">
            <Button variant="ghost" size="sm" className="text-slate-300" onClick={() => setReader(null)}>
              <ArrowLeft className="size-4 mr-1.5" /> Library
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-100">{reader.title}</p>
              <p className="truncate text-xs text-slate-400">
                by {reader.author} · licensed to {email}
              </p>
            </div>
            <Badge className="gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px]">
              <ShieldCheck className="size-3" /> Protected
            </Badge>
          </div>

          {/* Book content */}
          <div
            className="relative flex-1 overflow-y-auto select-none [&_*]:select-none"
            style={{ WebkitTouchCallout: 'none' }}
            onCopy={(e) => e.preventDefault()}
            onCut={(e) => e.preventDefault()}
          >
            {/* Watermark layer */}
            <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
              <div className="grid grid-cols-3 gap-x-6 gap-y-8 rotate-[-18deg] scale-[1.35] translate-y-10 origin-center">
                {watermark.map((i) => (
                  <span key={i} className="whitespace-nowrap text-sm font-semibold text-slate-100/25">
                    Licensed to {email}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative z-10 mx-auto max-w-2xl px-5 py-8 sm:py-10 space-y-2">
              {/* Mini cover */}
              <div className="mb-6 flex items-center gap-4">
                <div
                  className={cn(
                    'flex size-20 shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg',
                    COVER_STYLES[reader.coverColor] || COVER_STYLES.indigo
                  )}
                >
                  <span className="text-3xl">{reader.emoji || '📚'}</span>
                </div>
                <div className="min-w-0">
                  <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-50 leading-tight">{reader.title}</h1>
                  <p className="text-sm text-slate-400 mt-1">
                    {reader.author} · {reader.category} · {reader.level}
                  </p>
                </div>
              </div>

              {renderMarkdown(reader.content)}

              <p className="mt-10 border-t border-white/10 pt-4 text-center text-xs text-slate-500">
                Licensed digital edition · © TOPTIER. This copy is bound to {email} and may not be copied, screenshotted, shared or redistributed.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Loading book state */}
      {reading && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            Opening your e-book…
          </div>
        </div>
      )}

      {/* Continue to subscriptions for more product */}
      <div className="text-center">
        <Button variant="ghost" size="sm" onClick={() => setPage('subscriptions')}>
          <ExternalLink className="size-4 mr-1.5" /> Explore subscriptions & mentorship
        </Button>
      </div>
    </div>
  )
}

function BookCard({
  book,
  admin,
  onBuy,
  onRead,
}: {
  book: EBookInfo
  admin: boolean
  onBuy: () => void
  onRead: () => void
}) {
  const canRead = book.owned || admin
  return (
    <Card className="group overflow-hidden border-border bg-card hover:border-[#1b4f9c]/40 transition-colors">
      <div
        className={cn(
          'relative flex h-40 flex-col justify-between bg-gradient-to-br p-5 text-white',
          COVER_STYLES[book.coverColor] || COVER_STYLES.indigo
        )}
      >
        <div className="flex items-start justify-between">
          <span className="text-4xl drop-shadow">{book.emoji || '📚'}</span>
          <div className="flex gap-1.5">
            <Badge className="bg-black/20 text-white border-white/20 text-[10px] capitalize">{book.category}</Badge>
          </div>
        </div>
        <div>
          <p className="font-display text-lg font-bold leading-tight drop-shadow">{book.title}</p>
          <p className="text-xs text-white/80">by {book.author}</p>
        </div>
        <div className="absolute bottom-3 right-4 rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold tracking-wide text-white/90">
          ${book.price.toFixed(2)}
        </div>
      </div>
      <CardContent className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <Badge className={cn('text-[10px] capitalize', LEVEL_COLORS[book.level] || LEVEL_COLORS.beginner)}>{book.level}</Badge>
          {book.owned && (
            <Badge className="text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Owned</Badge>
          )}
          {admin && !book.owned && (
            <Badge className="text-[10px] bg-[#1b4f9c]/10 text-[#1b4f9c] border-[#1b4f9c]/20">Preview</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{book.description}</p>
      </CardContent>
      <CardFooter className="p-5 pt-0">
        {canRead ? (
          <Button className="w-full" variant="outline" onClick={onRead}>
            <BookOpen className="size-4 mr-1.5" /> {admin && !book.owned ? 'Read (Preview)' : 'Read Now'}
          </Button>
        ) : (
          <Button className="w-full bg-[#1b4f9c] hover:bg-[#16385e] text-white" onClick={onBuy}>
            <Lock className="size-4 mr-1.5" /> Unlock for ${book.price.toFixed(2)}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

export default EBooksPage