'use client'

import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageCircle,
  X,
  Send,
  Search,
  ChevronRight,
  LifeBuoy,
  Bot,
  User,
  Clock,
  Mail,
  Phone,
  Plus,
  Paperclip,
  CheckCircle2,
  Zap,
  Loader2,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { PoweredBy } from '@/components/branding/powered-by'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fileToResizedDataUrl } from '@/lib/file-to-data-url'

const CATEGORY_TO_API: Record<string, string> = {
  bug: 'bug',
  feature: 'feature_request',
  billing: 'support',
  technical: 'support',
  other: 'support',
}

// ─── Quick FAQ for the widget ──────────────────────────────────────────────

const quickFaqs = [
  {
    id: 'q1',
    q: 'How do I upgrade my plan?',
    a: 'Go to Pricing → choose a plan → select payment method → complete checkout. Your new tier activates instantly.',
  },
  {
    id: 'q2',
    q: 'Why are my signals delayed?',
    a: 'Free-tier signals have a 5-minute delay. Upgrade to Premium for real-time signals and unlimited daily alerts.',
  },
  {
    id: 'q3',
    q: 'How do I enable 2FA?',
    a: 'Settings → Security → Two-Factor Authentication → toggle on. Scan the QR code with Google Authenticator or Authy and verify the 6-digit code.',
  },
  {
    id: 'q4',
    q: 'How does screenshot analysis work?',
    a: 'Upload any chart screenshot and our AI identifies support/resistance levels, chart patterns, trend direction, and potential setups within seconds.',
  },
  {
    id: 'q5',
    q: 'Can I cancel my subscription anytime?',
    a: 'Yes. Go to Settings → Billing → Cancel Subscription. Premium features remain active until the end of your current billing period.',
  },
]

// ─── Bot auto-responses ────────────────────────────────────────────────────

const botResponses: { keywords: string[]; reply: string }[] = [
  {
    keywords: ['refund', 'money back'],
    reply: 'We offer a 7-day money-back guarantee on all new subscriptions. To request a refund, please create a support ticket with your account email and a brief reason. Our billing team responds within 24 hours.',
  },
  {
    keywords: ['password', 'reset', 'forgot'],
    reply: 'To reset your password: 1) Click "Forgot password?" on the login screen, 2) Enter your registered email, 3) Click the reset link in the email (valid for 30 min), 4) Set a new password. Need a ticket?',
  },
  {
    keywords: ['signal', 'accuracy'],
    reply: 'Our signals are generated using a combination of 50+ technical indicators, fundamental analysis, and AI pattern recognition. Historical accuracy is consistently above 75%. Remember, past performance does not guarantee future results.',
  },
  {
    keywords: ['cancel', 'subscription'],
    reply: 'You can cancel anytime from Settings → Billing → Cancel Subscription. Your premium features stay active until the end of your billing period. No partial refunds are issued.',
  },
  {
    keywords: ['support', 'help', 'contact'],
    reply: 'You can reach us via: 📧 support@toptier.app, or create a ticket from the Support page. Premium users get <4h response time, Free users <24h. How else can I help?',
  },
]

function getBotReply(message: string): string {
  const lower = message.toLowerCase()
  for (const r of botResponses) {
    if (r.keywords.some((k) => lower.includes(k))) return r.reply
  }
  return "Thanks for reaching out! I've logged your message. A human agent will follow up shortly. For urgent issues, please create a ticket from the Support page or email support@toptier.app."
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'bot' | 'user'
  text: string
  timestamp: Date
}

// ─── Component ─────────────────────────────────────────────────────────────

export function FloatingSupportWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [view, setView] = useState<'main' | 'chat' | 'faq' | 'ticket'>('main')
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'bot',
      text: "👋 Hi! I'm BAGMUL Assistant. How can I help you today? Ask a question, browse FAQs, or create a ticket.",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [unread, setUnread] = useState(0)
  const [isBotTyping, setIsBotTyping] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const setPage = useStore((s) => s.setPage)

  // ─── Ticket form state
  const [ticket, setTicket] = useState({
    subject: '',
    category: '',
    priority: '',
    description: '',
  })
  const [ticketAttachments, setTicketAttachments] = useState<{ name: string; dataUrl: string }[]>([])
  const [submittingTicket, setSubmittingTicket] = useState(false)
  const attachInputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, view])

  // Reset unread when opened
  useEffect(() => {
    if (isOpen) setUnread(0)
  }, [isOpen])

  const handleSend = async () => {
    if (!input.trim()) return
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: input,
      timestamp: new Date(),
    }
    const history = messages.map((m) => ({
      role: m.role === 'bot' ? 'assistant' as const : 'user' as const,
      content: m.text,
    }))
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsBotTyping(true)

    try {
      const res = await api.post<{ success: boolean; data: { reply: string } }>('/support/chat', {
        messages: [...history, { role: 'user', content: userMsg.text }],
      })
      const reply = res?.data?.reply?.trim() || getBotReply(userMsg.text)
      setMessages((prev) => [
        ...prev,
        { id: `b-${Date.now()}`, role: 'bot', text: reply, timestamp: new Date() },
      ])
    } catch (err) {
      // Fall back to the local keyword-based assistant so support never breaks.
      if (err instanceof Error && err.message.includes('429')) {
        toast.error('Please wait a moment before sending another message.')
      }
      setMessages((prev) => [
        ...prev,
        { id: `b-${Date.now()}`, role: 'bot', text: getBotReply(userMsg.text), timestamp: new Date() },
      ])
    } finally {
      setIsBotTyping(false)
    }
  }

  const handleQuickFaq = (faq: typeof quickFaqs[0]) => {
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: faq.q,
      timestamp: new Date(),
    }
    const botMsg: ChatMessage = {
      id: `b-${Date.now()}`,
      role: 'bot',
      text: faq.a,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg, botMsg])
    setView('chat')
  }

  const handleCreateTicket = async () => {
    if (!ticket.subject || !ticket.category || !ticket.description) {
      toast.error('Please fill in all required fields')
      return
    }
    setSubmittingTicket(true)
    try {
      await api.post('/support', {
        subject: ticket.subject,
        description: ticket.description,
        category: CATEGORY_TO_API[ticket.category] || 'support',
        priority: ticket.priority || 'medium',
        attachments: ticketAttachments.map((a) => a.dataUrl),
      })
      toast.success('Ticket created! We\'ll respond within 24 hours.')
      setTicket({ subject: '', category: '', priority: '', description: '' })
      setTicketAttachments([])
      setView('chat')
      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          role: 'bot',
          text: `✅ Your ticket has been created. Subject: "${ticket.subject}". Our team will respond within 24 hours. You can track it on the Support page.`,
          timestamp: new Date(),
        },
      ])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create ticket')
    } finally {
      setSubmittingTicket(false)
    }
  }

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
      setTicketAttachments((prev) => [...prev, { name: file.name, dataUrl }])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to read image')
    }
  }

  return (
    <>
      {/* Floating Action Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            key="fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            onClick={() => setIsOpen(true)}
            // Respect safe-area (notches/home indicators) and keep clear of
            // bottom-right action buttons by sitting slightly further from the
            // edge on smaller screens.
            className="fixed bottom-5 right-5 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 transition-all"
            style={{
              bottom: 'max(1.25rem, env(safe-area-inset-bottom))',
              right: 'max(1.25rem, env(safe-area-inset-right))',
            }}
            aria-label="Open customer support"
          >
            <MessageCircle className="size-6" />
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
            <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Support Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed z-50 flex h-[600px] max-h-[calc(100vh-2.5rem)] w-[calc(100vw-2.5rem)] max-w-[400px] flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
            style={{
              bottom: 'max(1.25rem, env(safe-area-inset-bottom))',
              right: 'max(1.25rem, env(safe-area-inset-right))',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 bg-primary text-primary-foreground shrink-0">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Avatar className="size-9 border-2 border-primary-foreground/30">
                    <AvatarFallback className="bg-primary-foreground/20 text-primary-foreground">
                      <Bot className="size-4" />
                    </AvatarFallback>
                  </Avatar>
                  <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-emerald-400 border-2 border-primary" />
                </div>
                <div>
                  <p className="text-sm font-bold leading-tight">BAGMUL Assistant</p>
                  <p className="text-[10px] opacity-90 leading-tight flex items-center gap-1">
                    <Clock className="size-2.5" /> Typically replies instantly
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-primary-foreground hover:bg-primary-foreground/10"
                  onClick={() => setPage('support')}
                  title="Open full Support page"
                >
                  <LifeBuoy className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-primary-foreground hover:bg-primary-foreground/10"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>

            {/* Body — switches between views */}
            <div className="flex-1 overflow-hidden bg-background">
              {view === 'main' && (
                <div className="h-full overflow-y-auto p-4 space-y-4">
                  {/* Greeting */}
                  <div className="rounded-lg bg-muted/50 p-3 text-sm">
                    <p className="font-medium mb-1">👋 Welcome to TopTier Support!</p>
                    <p className="text-muted-foreground text-xs">
                      Powered by BAGMUL. Choose an option below or ask me anything.
                    </p>
                  </div>

                  {/* Quick Actions */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setView('chat')}
                      className="flex flex-col items-start gap-1 p-3 rounded-lg border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
                    >
                      <MessageCircle className="size-5 text-primary" />
                      <span className="text-sm font-medium">Live Chat</span>
                      <span className="text-[10px] text-muted-foreground">Ask the AI assistant</span>
                    </button>
                    <button
                      onClick={() => setView('faq')}
                      className="flex flex-col items-start gap-1 p-3 rounded-lg border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
                    >
                      <Search className="size-5 text-primary" />
                      <span className="text-sm font-medium">FAQs</span>
                      <span className="text-[10px] text-muted-foreground">Browse common questions</span>
                    </button>
                    <button
                      onClick={() => setView('ticket')}
                      className="flex flex-col items-start gap-1 p-3 rounded-lg border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
                    >
                      <Plus className="size-5 text-primary" />
                      <span className="text-sm font-medium">Create Ticket</span>
                      <span className="text-[10px] text-muted-foreground">Get human help</span>
                    </button>
                    <button
                      onClick={() => setPage('support')}
                      className="flex flex-col items-start gap-1 p-3 rounded-lg border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
                    >
                      <LifeBuoy className="size-5 text-primary" />
                      <span className="text-sm font-medium">Support Center</span>
                      <span className="text-[10px] text-muted-foreground">Full help center</span>
                    </button>
                  </div>

                  <Separator />

                  {/* Quick FAQ Preview */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Popular Questions</p>
                    <div className="space-y-1">
                      {quickFaqs.slice(0, 3).map((faq) => (
                        <button
                          key={faq.id}
                          onClick={() => handleQuickFaq(faq)}
                          className="w-full flex items-center justify-between gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors text-left"
                        >
                          <span className="text-xs">{faq.q}</span>
                          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  {/* Contact info */}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="size-3.5" /> support@toptier.app
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="size-3.5" /> Free: &lt;24h · Premium: &lt;4h
                    </div>
                  </div>

                  <PoweredBy variant="inline" className="justify-center pt-2" />
                </div>
              )}

              {view === 'chat' && (
                <div className="h-full flex flex-col">
                  {/* Chat header */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
                    <button
                      onClick={() => setView('main')}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      ← Back
                    </button>
                    <span className="text-xs font-medium flex items-center gap-1">
                      <Bot className="size-3.5" /> AI Assistant
                    </span>
                    <Badge variant="outline" className="text-[9px] gap-1 text-emerald-500 border-emerald-500/30">
                      <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" /> Online
                    </Badge>
                  </div>

                  {/* Messages */}
                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                      >
                        {msg.role === 'bot' && (
                          <Avatar className="size-7 shrink-0 mt-0.5">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              <Bot className="size-3.5" />
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div
                          className={cn(
                            'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                            msg.role === 'user'
                              ? 'bg-primary text-primary-foreground rounded-tr-sm'
                              : 'bg-muted rounded-tl-sm'
                          )}
                        >
                          <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                          <p className={cn('text-[9px] mt-1', msg.role === 'user' ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        {msg.role === 'user' && (
                          <Avatar className="size-7 shrink-0 mt-0.5">
                            <AvatarFallback className="bg-muted text-xs">
                              <User className="size-3.5" />
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    ))}
                    {isBotTyping && (
                      <div className="flex gap-2 justify-start">
                        <Avatar className="size-7 shrink-0 mt-0.5">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            <Bot className="size-3.5" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-muted rounded-tl-sm">
                          <span className="flex items-center gap-1">
                            <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
                            <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '0.15s' }} />
                            <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '0.3s' }} />
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Quick FAQ chips */}
                  {messages.length <= 1 && (
                    <div className="px-3 pb-2 flex flex-wrap gap-1">
                      {quickFaqs.slice(0, 3).map((faq) => (
                        <button
                          key={faq.id}
                          onClick={() => handleQuickFaq(faq)}
                          className="text-[10px] px-2 py-1 rounded-full border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors"
                        >
                          {faq.q}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Input */}
                  <div className="p-3 border-t border-border">
                    {ticketAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {ticketAttachments.map((att, i) => (
                          <div key={`${att.name}-${i}`} className="relative">
                            <img src={att.dataUrl} alt={att.name} className="size-10 rounded-md border object-cover" />
                            <button
                              type="button"
                              onClick={() => setTicketAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                              className="absolute -top-1 -right-1 size-4 rounded-full bg-destructive text-white flex items-center justify-center"
                              title="Remove attachment"
                            >
                              <X className="size-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-end gap-2">
                      <Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => attachInputRef.current?.click()} title="Attach image">
                        <Paperclip className="size-4" />
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
                      <Textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            handleSend()
                          }
                        }}
                        placeholder="Type a message..."
                        rows={1}
                        className="resize-none min-h-[36px] max-h-24 text-sm"
                      />
                      <Button size="icon" className="size-9 shrink-0" onClick={handleSend} disabled={!input.trim()}>
                        <Send className="size-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {view === 'faq' && (
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
                    <button
                      onClick={() => setView('main')}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      ← Back
                    </button>
                    <span className="text-xs font-medium">Frequently Asked Questions</span>
                    <span className="w-8" />
                  </div>
                  <ScrollArea className="flex-1">
                    <Accordion type="single" collapsible className="p-3">
                      {quickFaqs.map((faq) => (
                        <AccordionItem key={faq.id} value={faq.id} className="border rounded-lg mb-2 px-3">
                          <AccordionTrigger className="text-xs font-medium hover:no-underline py-3">
                            {faq.q}
                          </AccordionTrigger>
                          <AccordionContent>
                            <p className="text-xs text-muted-foreground leading-relaxed">{faq.a}</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-2 h-7 text-xs gap-1"
                              onClick={() => handleQuickFaq(faq)}
                            >
                              Ask in chat <ChevronRight className="size-3" />
                            </Button>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </ScrollArea>
                </div>
              )}

              {view === 'ticket' && (
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
                    <button
                      onClick={() => setView('main')}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      ← Back
                    </button>
                    <span className="text-xs font-medium">Create Support Ticket</span>
                    <span className="w-8" />
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    <div>
                      <label className="text-xs font-medium mb-1 block">Subject *</label>
                      <Input
                        placeholder="Brief description"
                        value={ticket.subject}
                        onChange={(e) => setTicket((t) => ({ ...t, subject: e.target.value }))}
                        className="text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-medium mb-1 block">Category *</label>
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={ticket.category}
                          onChange={(e) => setTicket((t) => ({ ...t, category: e.target.value }))}
                        >
                          <option value="">Select</option>
                          <option value="bug">Bug</option>
                          <option value="feature">Feature</option>
                          <option value="billing">Billing</option>
                          <option value="technical">Technical</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium mb-1 block">Priority</label>
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={ticket.priority}
                          onChange={(e) => setTicket((t) => ({ ...t, priority: e.target.value }))}
                        >
                          <option value="">Select</option>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium mb-1 block">Description *</label>
                      <Textarea
                        placeholder="Describe your issue in detail..."
                        rows={4}
                        value={ticket.description}
                        onChange={(e) => setTicket((t) => ({ ...t, description: e.target.value }))}
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={() => attachInputRef.current?.click()}>
                        <Paperclip className="size-3.5" /> Attach Screenshot
                      </Button>
                      {ticketAttachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {ticketAttachments.map((att, i) => (
                            <div key={`${att.name}-${i}`} className="relative">
                              <img src={att.dataUrl} alt={att.name} className="size-12 rounded-md border object-cover" />
                              <button
                                type="button"
                                onClick={() => setTicketAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                                className="absolute -top-1 -right-1 size-4 rounded-full bg-destructive text-white flex items-center justify-center"
                                title="Remove attachment"
                              >
                                <X className="size-2.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button className="w-full gap-2" onClick={handleCreateTicket} disabled={submittingTicket}>
                      {submittingTicket ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                      {submittingTicket ? 'Creating...' : 'Submit Ticket'}
                    </Button>
                    <p className="text-[10px] text-muted-foreground text-center">
                      Average response time: &lt;24 hours (Free) · &lt;4 hours (Premium)
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-border bg-muted/30 px-3 py-1.5 flex items-center justify-center">
              <PoweredBy variant="inline" className="text-[10px]" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export default FloatingSupportWidget
