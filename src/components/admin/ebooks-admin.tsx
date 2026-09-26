'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { BookOpen, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface EBookAdmin {
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
  createdAt: string
  updatedAt: string
}

interface EBookAdminFull extends EBookAdmin {
  content: string
}

const emptyForm = {
  slug: '',
  title: '',
  author: 'TOPTIER',
  coverColor: 'indigo',
  emoji: '📚',
  description: '',
  category: 'trading',
  level: 'beginner' as string,
  price: '1.5',
  isActive: true,
  content: '',
}

export function EBooksAdmin() {
  const [books, setBooks] = useState<EBookAdmin[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/ebooks')
      const data = res as { books: EBookAdmin[] }
      setBooks(data.books || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load e-books')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  const openEdit = async (id: string) => {
    setEditingId(id)
    setDialogOpen(true)
    setLoadingDetail(true)
    try {
      const res = await api.get(`/ebooks/${id}`)
      const data = res as { book: EBookAdminFull }
      const b = data.book
      setForm({
        slug: b.slug,
        title: b.title,
        author: b.author,
        coverColor: b.coverColor,
        emoji: b.emoji || '',
        description: b.description,
        category: b.category,
        level: b.level,
        price: String(b.price),
        isActive: b.isActive,
        content: b.content,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load the e-book')
      setDialogOpen(false)
    } finally {
      setLoadingDetail(false)
    }
  }

  const [form, setForm] = useState(emptyForm)

  const set = (key: string, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }))

  const save = async () => {
    if (!form.title.trim() || !form.slug.trim() || !form.description.trim() || !form.content.trim()) {
      toast.error('Title, slug, description and content are required.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        slug: form.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        title: form.title,
        author: form.author,
        coverColor: form.coverColor,
        emoji: form.emoji || null,
        description: form.description,
        category: form.category,
        level: form.level,
        price: Number(form.price) || 1.5,
        isActive: form.isActive,
        content: form.content,
      }
      await api.post('/ebooks', payload)
      toast.success(editingId ? 'E-book updated.' : 'E-book created.')
      setDialogOpen(false)
      setForm(emptyForm)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save the e-book')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string, title: string) => {
    if (!window.confirm(`Delete "${title}" and revoke all owned copies?`)) return
    try {
      await api.delete(`/ebooks/${id}`)
      toast.success('E-book deleted.')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete the e-book')
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="h-5 w-5" /> E-Books Store
            </CardTitle>
            <CardDescription>
              Digital titles sold at $1.50 each. Content unlocks the moment a payment confirms; buyers are bound to their account (watermarked).
            </CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1" /> New Book
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingId ? 'Edit E-Book' : 'Create E-Book'}</DialogTitle>
                <DialogDescription>
                  Content is markdown — start each chapter with <code>## </code>. Price shown in USD.
                </DialogDescription>
              </DialogHeader>

              {loadingDetail ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin mr-2" /> Loading…
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Title</Label>
                      <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="The Supply & Demand Playbook" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Slug (URL)</Label>
                      <Input value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="supply-demand-playbook" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Author</Label>
                      <Input value={form.author} onChange={(e) => set('author', e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Price (USD)</Label>
                      <Input type="number" step="0.05" min="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Category</Label>
                      <select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" value={form.category} onChange={(e) => set('category', e.target.value)}>
                        {['trading', 'strategy', 'psychology', 'guides'].map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Level</Label>
                      <select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm capitalize" value={form.level} onChange={(e) => set('level', e.target.value)}>
                        {['beginner', 'intermediate', 'advanced'].map((l) => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Cover theme</Label>
                      <select className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" value={form.coverColor} onChange={(e) => set('coverColor', e.target.value)}>
                        {['indigo', 'cyan', 'emerald', 'amber', 'rose', 'slate'].map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Emoji (cover art)</Label>
                      <Input value={form.emoji} onChange={(e) => set('emoji', e.target.value)} placeholder="📉" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <Input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Short blurb shown on the store card" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-2">
                      <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} className="size-4" />
                      Active for sale
                    </Label>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Content (markdown)</Label>
                    <textarea
                      className="min-h-[280px] w-full rounded-lg border border-input bg-background p-3 font-mono text-xs"
                      value={form.content}
                      onChange={(e) => set('content', e.target.value)}
                      placeholder={'# Book title\n\nIntro paragraph…\n\n## Chapter One\n\n…'}
                    />
                  </div>
                  <div className="flex gap-3 justify-end">
                    <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button onClick={save} disabled={saving}>
                      {saving ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Plus className="size-4 mr-1" />}
                      {editingId ? 'Save Changes' : 'Create Book'}
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {loading ? (
            <EmptyState text="Loading e-books…" />
          ) : books.length === 0 ? (
            <EmptyState text="No e-books yet. Create your first title." />
          ) : (
            <div className="space-y-2">
              {books.map((book) => (
                <div key={book.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/30 transition-colors">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm">
                    {book.emoji || '📚'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{book.title}</p>
                      {!book.isActive && <Badge variant="outline" className="text-[10px]">hidden</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground mt-0.5">
                      /{book.slug} · {book.category} · {book.level} · ${book.price.toFixed(2)}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEdit(book.id)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-500" onClick={() => remove(book.id, book.title)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>
  )
}

export default EBooksAdmin