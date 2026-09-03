'use client'

import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { MessageSquare, Send, ArrowLeft, Loader2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Conversation {
  id: string
  participant1: { id: string; name: string | null; profilePicture: string | null }
  participant2: { id: string; name: string | null; profilePicture: string | null }
  lastMessageAt: string
  messages: Array<{ content: string; createdAt: string; senderId: string }>
}

interface Message {
  id: string
  content: string
  senderId: string
  sender: { id: string; name: string | null }
  createdAt: string
}

export function MessagesPage() {
  const user = useStore((s) => s.user)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConv, setSelectedConv] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingConv, setLoadingConv] = useState(true)
  const [loadingMsg, setLoadingMsg] = useState(false)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [recipientId, setRecipientId] = useState('')
  const msgEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoadingConv(true)
    api.get<{ success: boolean; data: { conversations: Conversation[] } }>('/messages', { signal: ctrl.signal })
      .then((res) => { setConversations(res?.data?.conversations || []) })
      .catch(() => { if (!ctrl.signal.aborted) setConversations([]) })
      .finally(() => setLoadingConv(false))
    return () => ctrl.abort()
  }, [])

  useEffect(() => {
    if (!selectedConv) return
    const ctrl = new AbortController()
    setLoadingMsg(true)
    api.get<{ success: boolean; data: { messages: Message[] } }>(`/messages?conversationId=${selectedConv}`, { signal: ctrl.signal })
      .then((res) => { setMessages(res?.data?.messages || []) })
      .catch(() => { if (!ctrl.signal.aborted) setMessages([]) })
      .finally(() => setLoadingMsg(false))
    return () => ctrl.abort()
  }, [selectedConv])

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!draft.trim()) return
    setSending(true)
    try {
      const body: Record<string, string> = { content: draft.trim() }
      if (selectedConv) body.conversationId = selectedConv
      else if (recipientId.trim()) body.recipientId = recipientId.trim()
      else {
        toast.error('Enter a recipient user ID or select a conversation')
        setSending(false)
        return
      }
      const res = await api.post<{ success: boolean; data: { message: Message } }>('/messages', body)
      if (res?.data?.message) {
        setMessages((prev) => [...prev, res.data.message])
        setDraft('')
        setRecipientId('')
        api.get<{ success: boolean; data: { conversations: Conversation[] } }>('/messages')
          .then((res) => { setConversations(res?.data?.conversations || []) })
          .catch(() => {})
      }
    } catch {
      toast.error('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const otherParty = (conv: Conversation) => {
    return conv.participant1.id === user?.id ? conv.participant2 : conv.participant1
  }

  return (
    <div className="p-3 md:p-4 max-w-6xl mx-auto h-[calc(100vh-8rem)]">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <MessageSquare className="h-7 w-7 text-emerald-500" />
          Direct Messages
        </h1>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[calc(100%-5rem)]">
        {/* Conversation list */}
        <Card className={cn('md:col-span-1 overflow-hidden', selectedConv && 'hidden md:block')}>
          <CardContent className="p-0 h-full flex flex-col">
            <div className="p-3 border-b">
              <input
                type="text"
                placeholder="New chat: enter user ID..."
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-md border bg-background"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingConv ? (
                <div className="p-3 space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}
                </div>
              ) : conversations.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No conversations yet. Start one above!
                </div>
              ) : (
                conversations.map((c) => {
                  const other = otherParty(c)
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedConv(c.id)}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 hover:bg-accent/40 transition text-left',
                        selectedConv === c.id && 'bg-accent'
                      )}
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarFallback>{(other.name || 'A')[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{other.name || 'Anonymous'}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {c.messages[0]?.content || 'No messages yet'}
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(c.lastMessageAt).toLocaleDateString()}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Message thread */}
        <Card className={cn('md:col-span-2 overflow-hidden', !selectedConv && 'hidden md:block')}>
          <CardContent className="p-0 h-full flex flex-col">
            {!selectedConv && !recipientId ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                <div className="text-center">
                  <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  Select a conversation or enter a user ID to start chatting.
                </div>
              </div>
            ) : (
              <>
                <div className="p-3 border-b flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="md:hidden h-8 w-8" onClick={() => setSelectedConv(null)}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <span className="font-medium text-sm">
                    {selectedConv
                      ? (() => {
                          const c = conversations.find((x) => x.id === selectedConv)
                          return c ? (otherParty(c).name || 'Anonymous') : 'Chat'
                        })()
                      : 'New conversation'}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {loadingMsg ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-2/3 rounded" />)}
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground py-8">
                      No messages yet. Say hello!
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isMe = m.senderId === user?.id
                      return (
                        <div key={m.id} className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                          <div className={cn(
                            'max-w-[75%] px-3 py-2 rounded-2xl text-sm',
                            isMe ? 'bg-emerald-500 text-white rounded-br-sm' : 'bg-accent rounded-bl-sm'
                          )}>
                            <div>{m.content}</div>
                            <div className={cn('text-[10px] mt-1', isMe ? 'text-emerald-100' : 'text-muted-foreground')}>
                              {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                  <div ref={msgEndRef} />
                </div>
                <div className="p-3 border-t flex gap-2">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                    placeholder="Type a message..."
                    className="flex-1 px-3 py-2 text-sm rounded-md border bg-background"
                  />
                  <Button size="icon" onClick={handleSend} disabled={sending || !draft.trim()}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default MessagesPage
