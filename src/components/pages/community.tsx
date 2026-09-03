'use client'

import { useState, useCallback, useEffect } from 'react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  MessageSquare,
  ThumbsUp,
  Share2,
  Flag,
  Plus,
  Send,
  Crown,
  TrendingUp,
  TrendingDown,
  Users,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Loader2,
  MessageCircle,
  ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'

// --- Types ---

interface SignalComment {
  id: string
  content: string
  createdAt: string
  user: { id: string; name: string | null; profilePicture: string | null }
}

interface SignalReaction {
  id: string
  userId: string
  reaction: string
}

interface SignalSummary {
  id: string
  type: string
  asset: string
  entryPrice: number
  stopLoss: number
  takeProfit1: number
  status: string
  createdAt: string
  _count: { comments: number; reactions: number }
}

interface Discussion {
  id: string
  signal: { asset: string; type: string; entry: string; tp: string; sl: string }
  title: string
  comments: number
  likes: number
  createdAt: string
  authorName: string | null
  authorAvatar: string | null
  likedByMe: boolean
  replies: Array<{ id: string; user: { id: string; name: string | null }; content: string; createdAt: string }>
}

interface ForumPost {
  id: string
  userId: string
  userName: string | null
  userAvatar: string | null
  content: string
  type: string
  tags: string | null
  likes: number
  comments: number
  createdAt: string
  likedByMe?: boolean
}

const FORUM_CATEGORIES = ['Forex', 'Crypto', 'Stocks', 'Strategies', 'Help']

// --- Sub-Components ---

function SignalCard({ signal }: { signal: { asset: string; type: string; entry: string; tp: string; sl: string } }) {
  const isBuy = signal.type === 'BUY'
  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">{signal.asset}</span>
        <Badge variant={isBuy ? 'default' : 'destructive'} className="text-xs">
          {isBuy ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
          {signal.type}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <div>Entry: <span className="text-foreground font-medium">{signal.entry}</span></div>
        <div>TP: <span className="text-green-600 font-medium">{signal.tp}</span></div>
        <div>SL: <span className="text-red-600 font-medium">{signal.sl}</span></div>
      </div>
    </div>
  )
}

function ShareDialog({ signal }: { signal: { asset: string; type: string; entry: string; tp: string; sl: string } }) {
  const [copied, setCopied] = useState(false)

  const shareText = `🔥 ${signal.type} Signal: ${signal.asset}\nEntry: ${signal.entry}\nTP: ${signal.tp}\nSL: ${signal.sl}\n\nShared via TOPTIER`

  const handleCopy = () => {
    navigator.clipboard.writeText(shareText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Copied to clipboard!')
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
          <Share2 className="h-3 w-3" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Signal</DialogTitle>
          <DialogDescription>Share this signal with your network</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/30 p-4 mb-4">
          <SignalCard signal={signal} />
          <p className="text-xs text-muted-foreground mt-2 text-center">TOPTIER</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <p className="col-span-2 text-xs text-muted-foreground text-center">
            Native sharing opens the platform share sheet on supported devices.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ReportDialog({ target }: { target: string }) {
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submitReport = async () => {
    if (!reason) {
      toast.error('Please select a reason')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/support', {
        subject: `Reported content: ${target}`,
        description: details.trim() || `Reported as ${reason.replace('_', ' ')}.`,
        category: 'complaint',
        priority: 'medium',
      })
      toast.success('Report submitted. Thank you!')
      setReason('')
      setDetails('')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit report')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive">
          <Flag className="h-3 w-3" />
          Report
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report Content</DialogTitle>
          <DialogDescription>Reports are filed as a support ticket and reviewed by our team</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Reason</label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="spam">Spam</SelectItem>
                <SelectItem value="harassment">Harassment</SelectItem>
                <SelectItem value="misinformation">Misinformation</SelectItem>
                <SelectItem value="offensive">Offensive content</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Details (optional)</label>
            <Textarea placeholder="Please describe the issue..." value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          <Button className="w-full" onClick={submitReport} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Report'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ForumPostDialog({ post }: { post: ForumPost }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-xs ml-auto gap-1">
          View
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              {post.userAvatar && <AvatarImage src={post.userAvatar} />}
              <AvatarFallback className="text-xs">{(post.userName || 'U')[0].toUpperCase()}</AvatarFallback>
            </Avatar>
            {post.userName || 'Unknown user'}
          </DialogTitle>
          <DialogDescription>
            {new Date(post.createdAt).toLocaleString()} · {post.tags ? `#${post.tags.split(',').join(' #')}` : 'General'}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-80">
          <p className="text-sm whitespace-pre-wrap">{post.content}</p>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function DiscussionThread({ discussion, onRefresh }: { discussion: Discussion; onRefresh?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [liked, setLiked] = useState(discussion.likedByMe)
  const [postingComment, setPostingComment] = useState(false)
  const [reacting, setReacting] = useState(false)
  const user = useStore((s) => s.user)
  const isPremium = user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'pro'

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              {discussion.authorAvatar && <AvatarImage src={discussion.authorAvatar} />}
              <AvatarFallback className="text-xs">{(discussion.authorName || 'U')[0].toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{discussion.authorName || 'Unknown user'}</span>
                <span className="text-xs text-muted-foreground">{new Date(discussion.createdAt).toLocaleString()}</span>
              </div>
              <CardTitle className="text-sm mt-0.5">{discussion.title}</CardTitle>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-3 space-y-3">
        <SignalCard signal={discussion.signal} />
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={reacting} onClick={async () => {
            setReacting(true)
            const target = !liked
            try {
              await api.post('/community', { signalId: discussion.id, action: 'react', reaction: 'thumbs_up' })
              setLiked(target)
            } catch (err: unknown) {
              toast.error(err instanceof Error ? err.message : 'Failed to update reaction')
            } finally {
              setReacting(false)
            }
          }}>
            <ThumbsUp className={`h-3 w-3 ${liked ? 'fill-current text-primary' : ''}`} />
            {discussion.likes + (liked && !discussion.likedByMe ? 1 : 0)}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setExpanded(!expanded)}>
            <MessageSquare className="h-3 w-3" />
            {discussion.comments}
          </Button>
          <ShareDialog signal={discussion.signal} />
          <ReportDialog target={`signal ${discussion.signal.asset} discussion`} />
          <Button variant="default" size="sm" className="h-7 gap-1 text-xs ml-auto" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? 'Hide' : 'Join Discussion'}
          </Button>
        </div>
      </CardContent>
      {expanded && (
        <>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            <ScrollArea className="max-h-64">
              {discussion.replies.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No comments yet. Be the first to comment.</p>
              ) : (
                <div className="space-y-3">
                  {discussion.replies.map((reply) => (
                    <div key={reply.id} className="flex gap-2">
                      <Avatar className="h-6 w-6 mt-0.5">
                        <AvatarFallback className="text-[10px]">{(reply.user.name || 'U')[0].toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{reply.user.name || 'Unknown user'}</span>
                          <span className="text-xs text-muted-foreground">{new Date(reply.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="text-sm mt-0.5">{reply.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
            <div className="flex gap-2">
              {isPremium ? (
                <>
                  <Input
                    placeholder="Write a comment..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    className="text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newComment.trim()) {
                        (async () => {
                          try {
                            setPostingComment(true)
                            await api.post('/community', { signalId: discussion.id, action: 'comment', content: newComment.trim() })
                            toast.success('Comment posted!')
                            setNewComment('')
                            onRefresh?.()
                          } catch (err: unknown) {
                            toast.error(err instanceof Error ? err.message : 'Failed to post comment')
                          } finally {
                            setPostingComment(false)
                          }
                        })()
                      }
                    }}
                  />
                  <Button size="sm" disabled={postingComment} onClick={async () => {
                    if (newComment.trim()) {
                      try {
                        setPostingComment(true)
                        await api.post('/community', { signalId: discussion.id, action: 'comment', content: newComment.trim() })
                        toast.success('Comment posted!')
                        setNewComment('')
                        onRefresh?.()
                      } catch (err: unknown) {
                        toast.error(err instanceof Error ? err.message : 'Failed to post comment')
                      } finally {
                        setPostingComment(false)
                      }
                    }
                  }}>
                    <Send className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <div className="flex items-center gap-2 w-full p-2 rounded-lg bg-muted/50">
                  <Crown className="h-4 w-4 text-amber-500" />
                  <span className="text-xs text-muted-foreground">Only Premium users can comment</span>
                </div>
              )}
            </div>
          </CardContent>
        </>
      )}
    </Card>
  )
}

// --- Chats & Groups ---

interface Conversation {
  id: string
  participant1: { id: string; name: string | null; profilePicture: string | null }
  participant2: { id: string; name: string | null; profilePicture: string | null }
  lastMessageAt: string
  messages: Array<{ content: string; createdAt: string; senderId: string }>
}

interface CommunityGroup {
  id: string
  name: string
  description: string | null
  category: string | null
  memberCount: number
  isPrivate: boolean
  owner: { name: string | null; profilePicture: string | null } | null
}

function ChatsTab() {
  const user = useStore((s) => s.user)
  const setPage = useStore((s) => s.setPage)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [groups, setGroups] = useState<CommunityGroup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    Promise.all([
      api.get<{ data: { conversations: Conversation[] } }>('/messages', { signal: ctrl.signal }),
      api.get<{ data: { groups: CommunityGroup[] } }>('/groups', { signal: ctrl.signal }),
    ])
      .then(([convRes, groupsRes]) => {
        setConversations(convRes?.data?.conversations || [])
        setGroups(groupsRes?.data?.groups || [])
      })
      .catch(() => { if (!ctrl.signal.aborted) { setConversations([]); setGroups([]) } })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const otherParticipant = (conv: Conversation) =>
    conv.participant1.id === user?.id ? conv.participant2 : conv.participant1
  const lastMessage = (conv: Conversation) =>
    conv.messages.length > 0 ? conv.messages[conv.messages.length - 1].content : 'No messages yet'

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Chats */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageCircle className="h-4 w-4" /> Your Chats
            </CardTitle>
            <CardDescription>Private messages with other traders</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPage('messages')}>
            Open Messages <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          {conversations.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <MessageCircle className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="font-medium">No chats yet</p>
              <p className="text-sm">Start a conversation from the Messages page.</p>
              <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => setPage('messages')}>
                Open Messages <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <ScrollArea className="max-h-96">
              <div className="space-y-2">
                {conversations.map((conv) => {
                  const other = otherParticipant(conv)
                  return (
                    <div
                      key={conv.id}
                      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setPage('messages')}
                    >
                      <Avatar className="size-9 shrink-0">
                        <AvatarImage src={other.profilePicture || undefined} />
                        <AvatarFallback>{(other.name || 'U').slice(0, 1).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{other.name || 'Trader'}</p>
                        <p className="text-xs text-muted-foreground truncate">{lastMessage(conv)}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(conv.lastMessageAt).toLocaleDateString()}
                      </span>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Groups */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Trading Groups
            </CardTitle>
            <CardDescription>Public groups you can join and discuss in</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPage('groups')}>
            Open Groups <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="font-medium">No public groups yet</p>
              <p className="text-sm">Create or discover groups from the Groups page.</p>
              <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => setPage('groups')}>
                Open Groups <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <ScrollArea className="max-h-96">
              <div className="space-y-2">
                {groups.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setPage('groups')}
                  >
                    <div className="size-9 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{group.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {group.description || group.category || 'Trading group'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Users className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{group.memberCount}</span>
                    </div>
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

export default function CommunityPage() {
  const [activeForumTab, setActiveForumTab] = useState('Forex')
  const [showGuidelines, setShowGuidelines] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [discussions, setDiscussions] = useState<Discussion[]>([])
  const [forumPosts, setForumPosts] = useState<ForumPost[]>([])
  const [forumLoading, setForumLoading] = useState(false)
  const [forumDialogOpen, setForumDialogOpen] = useState(false)
  const [postTitle, setPostTitle] = useState('')
  const [postCategory, setPostCategory] = useState('')
  const [postContent, setPostContent] = useState('')
  const [posting, setPosting] = useState(false)
  const user = useStore((s) => s.user)
  const isPremium = user?.subscriptionTier === 'premium' || user?.subscriptionTier === 'pro'
  const myId = user?.id

  // Fetch signal discussions (real signals + their comments/reactions)
  const fetchCommunityData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const signalsResult = await api.get<{ data: { signals: SignalSummary[] } }>('/signals?status=active&limit=10')
      const signalsData = signalsResult.data?.signals
      if (signalsData && Array.isArray(signalsData) && signalsData.length > 0) {
        const threads = await Promise.all(
          signalsData.map(async (signal): Promise<Discussion | null> => {
            try {
              const communityResult = await api.get<{ data: { comments: SignalComment[]; reactions: SignalReaction[] } }>(`/community?signalId=${signal.id}`)
              const communityData = communityResult.data
              const comments = communityData?.comments || []
              const reactionCounts = {
                thumbs_up: (communityData?.reactions || []).filter((r) => r.reaction === 'thumbs_up').length,
              }
              return {
                id: signal.id,
                signal: {
                  asset: signal.asset,
                  type: signal.type,
                  entry: String(signal.entryPrice),
                  tp: String(signal.takeProfit1),
                  sl: String(signal.stopLoss),
                },
                title: `${signal.type} Signal: ${signal.asset}`,
                comments: comments.length,
                likes: reactionCounts.thumbs_up,
                createdAt: signal.createdAt,
                authorName: null,
                authorAvatar: null,
                likedByMe: myId ? (communityData?.reactions || []).some((r) => r.userId === myId && r.reaction === 'thumbs_up') : false,
                replies: comments.map((c) => ({
                  id: c.id,
                  user: { id: c.user.id, name: c.user.name },
                  content: c.content,
                  createdAt: c.createdAt,
                })),
              }
            } catch {
              return null
            }
          })
        )
        setDiscussions(threads.filter((d): d is Discussion => d !== null))
      } else {
        setDiscussions([])
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load community data')
      setDiscussions([])
    } finally {
      setLoading(false)
    }
  }, [myId])

  // Fetch forum posts for the active category (real public posts from /social/feed)
  const fetchForumPosts = useCallback(async (tab: string) => {
    setForumLoading(true)
    try {
      const res = await api.get<{ data: { posts: ForumPost[] } }>(`/social/feed?scope=community&tag=${encodeURIComponent(tab.toLowerCase())}&limit=20`)
      setForumPosts(res.data?.posts || [])
    } catch {
      setForumPosts([])
    } finally {
      setForumLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCommunityData()
  }, [fetchCommunityData])

  useEffect(() => {
    fetchForumPosts(activeForumTab)
  }, [activeForumTab, fetchForumPosts])

  const handleCreatePost = async () => {
    if (!postTitle.trim() || !postContent.trim() || !postCategory) return
    setPosting(true)
    try {
      await api.post('/social/feed', {
        content: `${postTitle.trim()}\n\n${postContent.trim()}`,
        type: 'general',
        tags: postCategory.toLowerCase(),
      })
      setForumDialogOpen(false)
      setPostTitle('')
      setPostCategory('')
      setPostContent('')
      setActiveForumTab(postCategory)
      toast.success('Post created!')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create post')
    } finally {
      setPosting(false)
    }
  }

  const handleToggleLike = async (post: ForumPost) => {
    try {
      await api.post('/social/post/like', { postId: post.id, action: post.likedByMe ? 'unlike' : 'like' })
      setForumPosts((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, likedByMe: !p.likedByMe, likes: p.likes + (p.likedByMe ? -1 : 1) } : p))
      )
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update like')
    }
  }

  return (
    <div className="space-y-5 p-3 md:p-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Community Center</h1>
          <p className="text-sm text-muted-foreground">Discuss signals, chat with traders, and join groups</p>
        </div>
        <Dialog open={showGuidelines} onOpenChange={setShowGuidelines}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <BookOpen className="h-4 w-4" />
              Guidelines
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Community Guidelines</DialogTitle>
              <DialogDescription>Our rules for a safe and productive community</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-80">
              <div className="space-y-3 text-sm">
                <div><strong>1. Be Respectful</strong> - Treat all members with respect. No personal attacks or harassment.</div>
                <div><strong>2. No Spam</strong> - Do not post promotional content or irrelevant links.</div>
                <div><strong>3. Share Responsibly</strong> - Signals are opinions, not financial advice. Always do your own research.</div>
                <div><strong>4. No Misinformation</strong> - Do not share false or misleading information intentionally.</div>
                <div><strong>5. Report Issues</strong> - Use the report button for any content that violates these guidelines.</div>
                <div><strong>6. Premium Content</strong> - Respect premium-only areas and do not share premium content publicly.</div>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="discussions" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="discussions" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Discussions
          </TabsTrigger>
          <TabsTrigger value="forum" className="gap-2">
            <Users className="h-4 w-4" />
            Forum
          </TabsTrigger>
          <TabsTrigger value="chats" className="gap-2">
            <MessageCircle className="h-4 w-4" />
            Chats &amp; Groups
          </TabsTrigger>
        </TabsList>

        {/* Signal Discussions */}
        <TabsContent value="discussions" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Signal Discussions</h2>
            <Badge variant="outline" className="text-xs">{discussions.length} active</Badge>
          </div>
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : discussions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No active signals</p>
                <p className="text-sm">Signal discussions appear here when new signals are published.</p>
              </div>
            ) : (
              discussions.map((d) => (
                <DiscussionThread key={d.id} discussion={d} onRefresh={fetchCommunityData} />
              ))
            )}
          </div>
        </TabsContent>

        {/* Community Forum */}
        <TabsContent value="forum" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Forum</h2>
            {isPremium ? (
              <Dialog open={forumDialogOpen} onOpenChange={setForumDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-2">
                    <Plus className="h-4 w-4" />
                    New Post
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Post</DialogTitle>
                    <DialogDescription>Share your thoughts with the community</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <Input
                      placeholder="Post title"
                      value={postTitle}
                      onChange={(e) => setPostTitle(e.target.value)}
                      maxLength={120}
                    />
                    <Select value={postCategory} onValueChange={setPostCategory}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {FORUM_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Textarea
                      placeholder="Write your post content..."
                      rows={5}
                      value={postContent}
                      onChange={(e) => setPostContent(e.target.value)}
                      maxLength={2000}
                    />
                    <Button size="sm" className="w-full" disabled={!postTitle.trim() || !postContent.trim() || !postCategory || posting} onClick={handleCreatePost}>
                      {posting ? 'Posting...' : 'Create Post'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            ) : (
              <Button size="sm" className="gap-2" disabled>
                <Crown className="h-4 w-4" />
                New Post (Premium)
              </Button>
            )}
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {FORUM_CATEGORIES.map((tab) => (
              <Button
                key={tab}
                variant={activeForumTab === tab ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveForumTab(tab)}
                className="shrink-0"
              >
                {tab}
              </Button>
            ))}
          </div>

          <div className="space-y-3">
            {forumLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : forumPosts.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No posts yet</p>
                <p className="text-sm">Be the first to start a discussion in {activeForumTab}!</p>
              </div>
            ) : (
              forumPosts.map((post) => {
                const titleLine = post.content.split('\n').find(Boolean) || 'Untitled'
                const rest = post.content.split('\n').slice(1).join('\n').trim()
                return (
                  <Card key={post.id} className="transition-shadow hover:shadow-md">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="h-9 w-9">
                          {post.userAvatar && <AvatarImage src={post.userAvatar} />}
                          <AvatarFallback className="text-xs">{(post.userName || 'U')[0].toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{post.userName || 'Unknown user'}</span>
                            <span className="text-xs text-muted-foreground">{new Date(post.createdAt).toLocaleString()}</span>
                          </div>
                          <h3 className="font-semibold text-sm mt-0.5">{titleLine}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{rest}</p>
                          <div className="flex items-center gap-3 mt-2">
                            <button
                              className={`flex items-center gap-1 text-xs ${post.likedByMe ? 'text-primary' : 'text-muted-foreground'} hover:text-primary transition-colors`}
                              onClick={() => handleToggleLike(post)}
                            >
                              <ThumbsUp className="h-3 w-3" /> {post.likes}
                            </button>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <MessageSquare className="h-3 w-3" /> {post.comments}
                            </span>
                            <ForumPostDialog post={post} />
                            <ReportDialog target={`forum post "${titleLine}"`} />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        </TabsContent>

        {/* Chats & Groups */}
        <TabsContent value="chats" className="space-y-4 mt-4">
          <ChatsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
