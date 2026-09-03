'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Users, Plus, Loader2, Lock, Globe, Hash } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Group {
  id: string
  name: string
  description: string | null
  category: string
  isPrivate: boolean
  memberCount: number
  ownerId: string
  owner?: { name: string | null; profilePicture: string | null }
  _count?: { members: number }
  role?: string
  joinedAt?: string
}

const CATEGORIES = ['trading', 'education', 'signals', 'discussion'] as const

export function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [myGroups, setMyGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newGroup, setNewGroup] = useState({ name: '', description: '', category: 'trading', isPrivate: false })
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState<'discover' | 'mine'>('discover')

  const fetchGroups = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      const [discover, mine] = await Promise.all([
        api.get<{ success: boolean; data: { groups: Group[] } }>('/groups', { signal }),
        api.get<{ success: boolean; data: { groups: Group[] } }>('/groups?view=mine', { signal }),
      ])
      setGroups(discover?.data?.groups || [])
      setMyGroups(mine?.data?.groups || [])
    } catch {
      if (!signal?.aborted) { setGroups([]); setMyGroups([]) }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    fetchGroups(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchGroups])

  const handleJoin = async (id: string) => {
    setJoining(id)
    try {
      await api.post('/groups/join', { groupId: id, action: 'join' })
      toast.success('Joined group!')
      fetchGroups()
    } catch {
      toast.error('Failed to join')
    } finally {
      setJoining(null)
    }
  }

  const handleLeave = async (id: string) => {
    setJoining(id)
    try {
      await api.post('/groups/join', { groupId: id, action: 'leave' })
      toast.success('Left group')
      fetchGroups()
    } catch {
      toast.error('Failed to leave')
    } finally {
      setJoining(null)
    }
  }

  const handleCreate = async () => {
    if (!newGroup.name.trim()) {
      toast.error('Name is required')
      return
    }
    setCreating(true)
    try {
      await api.post('/groups', newGroup)
      toast.success('Group created!')
      setShowCreate(false)
      setNewGroup({ name: '', description: '', category: 'trading', isPrivate: false })
      fetchGroups()
    } catch {
      toast.error('Failed to create group')
    } finally {
      setCreating(false)
    }
  }

  const list = view === 'mine' ? myGroups : groups

  return (
    <div className="space-y-5 p-3 md:p-4 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-7 w-7 text-emerald-500" />
            Groups
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Join trading communities or create your own.</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Create
        </Button>
      </motion.div>

      <div className="flex gap-2">
        <Button variant={view === 'discover' ? 'default' : 'outline'} size="sm" onClick={() => setView('discover')}>
          Discover
        </Button>
        <Button variant={view === 'mine' ? 'default' : 'outline'} size="sm" onClick={() => setView('mine')}>
          My Groups ({myGroups.length})
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
        </div>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p>{view === 'mine' ? 'You haven\'t joined any groups yet.' : 'No groups available.'}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.map((g, idx) => (
            <motion.div
              key={g.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(idx * 0.05, 0.4) }}
            >
              <Card className="h-full flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      {g.isPrivate ? <Lock className="h-4 w-4 text-amber-500" /> : <Globe className="h-4 w-4 text-emerald-500" />}
                      {g.name}
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      <Hash className="h-3 w-3 mr-1" />{g.category}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">{g.description || 'No description'}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback>{(g.owner?.name || 'A')[0]}</AvatarFallback>
                    </Avatar>
                    <span className="text-muted-foreground">Owner: <span className="text-foreground font-medium">{g.owner?.name || 'Unknown'}</span></span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Members</span>
                    <span className="font-medium">{g._count?.members || g.memberCount}</span>
                  </div>
                </CardContent>
                <CardFooter className="pt-2">
                  {view === 'mine' ? (
                    <Button size="sm" variant="outline" className="w-full" disabled={joining === g.id} onClick={() => handleLeave(g.id)}>
                      {joining === g.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                      Leave Group
                    </Button>
                  ) : (
                    <Button size="sm" className="w-full" disabled={joining === g.id} onClick={() => handleJoin(g.id)}>
                      {joining === g.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
                      Join Group
                    </Button>
                  )}
                </CardFooter>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a New Group</DialogTitle>
            <DialogDescription>Build a trading community around your favorite topic.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="gname">Group Name</Label>
              <Input id="gname" value={newGroup.name} onChange={(e) => setNewGroup((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Crypto Scalpers Africa" />
            </div>
            <div>
              <Label htmlFor="gdesc">Description</Label>
              <Input id="gdesc" value={newGroup.description} onChange={(e) => setNewGroup((p) => ({ ...p, description: e.target.value }))} placeholder="What's this group about?" />
            </div>
            <div>
              <Label>Category</Label>
              <div className="flex gap-2 flex-wrap">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewGroup((p) => ({ ...p, category: c }))}
                    className={cn(
                      'text-xs px-3 py-1.5 rounded-full border capitalize',
                      newGroup.category === c ? 'bg-emerald-500 text-white border-emerald-500' : 'hover:bg-accent'
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newGroup.isPrivate}
                onChange={(e) => setNewGroup((p) => ({ ...p, isPrivate: e.target.checked }))}
                className="rounded"
              />
              Private group (invite only)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Create Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default GroupsPage
