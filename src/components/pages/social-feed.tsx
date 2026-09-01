'use client'

import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Newspaper, Users, Heart, MessageCircle, Share2, Send,
  Loader2, Plus, TrendingUp, Sparkles, MessageSquare,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Post {
  id: string
  userId: string
  userName: string | null
  userAvatar: string | null
  content: string
  type: string
  tags: string | null
  likes: number
  comments: number
  shares: number
  createdAt: string
  likedByMe?: boolean
}

export function SocialFeedPage() {
  const user = useStore((s) => s.user)
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [newPost, setNewPost] = useState('')
  const [postType, setPostType] = useState<'general' | 'signal' | 'analysis' | 'question'>('general')

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    api.get<{ success: boolean; data: { posts: Post[] } }>('/social/feed?limit=30', { signal: ctrl.signal })
      .then((res) => { setPosts(res?.data?.posts || []) })
      .catch(() => { if (!ctrl.signal.aborted) setPosts([]) })
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [])

  const handlePost = async () => {
    if (!newPost.trim()) return
    setPosting(true)
    try {
      const res = await api.post<{ success: boolean; data: { post: Post } }>('/social/feed', {
        content: newPost.trim(), type: postType,
      })
      if (res?.data?.post) {
        setPosts((prev) => [res.data.post, ...prev])
        setNewPost('')
        toast.success('Posted to your feed!')
      }
    } catch (err) {
      toast.error('Failed to post')
    } finally {
      setPosting(false)
    }
  }

  const handleLike = async (postId: string, liked: boolean) => {
    setPosts((prev) => prev.map((p) => p.id === postId
      ? { ...p, likedByMe: !liked, likes: p.likes + (liked ? -1 : 1) }
      : p
    ))
    try {
      await api.post('/social/post/like', { postId, action: liked ? 'unlike' : 'like' })
    } catch {
      // revert
      setPosts((prev) => prev.map((p) => p.id === postId
        ? { ...p, likedByMe: liked, likes: p.likes + (liked ? 1 : -1) }
        : p
      ))
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Newspaper className="h-7 w-7 text-emerald-500" />
            Social Feed
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Share insights, follow traders, and stay connected.</p>
        </div>
      </motion.div>

      {/* Composer */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback>{user?.name?.[0] || 'U'}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <textarea
                value={newPost}
                onChange={(e) => setNewPost(e.target.value)}
                placeholder="Share a trading insight, ask a question, or post an analysis..."
                className="w-full min-h-[80px] p-3 rounded-lg border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
              <div className="flex items-center justify-between mt-2">
                <div className="flex gap-1">
                  {(['general', 'signal', 'analysis', 'question'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setPostType(t)}
                      className={cn(
                        'text-xs px-2.5 py-1 rounded-full border transition capitalize',
                        postType === t
                          ? 'bg-emerald-500 text-white border-emerald-500'
                          : 'border-border hover:bg-accent'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <Button onClick={handlePost} disabled={posting || !newPost.trim()} size="sm">
                  {posting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                  Post
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Feed */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p>No posts yet. Be the first to share!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {posts.map((post, idx) => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(idx * 0.03, 0.3) }}
            >
              <Card className="hover:shadow-md transition">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>{(post.userName || 'A')[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{post.userName || 'Anonymous'}</span>
                        <Badge variant="outline" className="text-[10px] capitalize">{post.type}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(post.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap mb-3">{post.content}</p>
                  {post.tags && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {post.tags.split(',').map((tag) => (
                        <span key={tag} className="text-xs text-emerald-600">#{tag.trim()}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-4 pt-2 border-t">
                    <button
                      onClick={() => handleLike(post.id, !!post.likedByMe)}
                      className={cn(
                        'flex items-center gap-1.5 text-xs transition',
                        post.likedByMe ? 'text-rose-500' : 'text-muted-foreground hover:text-rose-500'
                      )}
                    >
                      <Heart className={cn('h-4 w-4', post.likedByMe && 'fill-current')} />
                      {post.likes}
                    </button>
                    <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-emerald-500 transition">
                      <MessageCircle className="h-4 w-4" />
                      {post.comments}
                    </button>
                    <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-emerald-500 transition">
                      <Share2 className="h-4 w-4" />
                      {post.shares}
                    </button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

export default SocialFeedPage
