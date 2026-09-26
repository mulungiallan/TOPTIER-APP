import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'
import { validateBody, ebookSaveSchema } from '@/lib/validation'

// GET /api/ebooks — catalog of active books + ownership flags for the caller.
// POST /api/ebooks — admin create/update of a book (see ebookSaveSchema).
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAdmin(request)
    if (user) {
      // Admins see every book, active or not, for management.
      const books = await db.eBook.findMany({ orderBy: { createdAt: 'desc' } })
      return successResponse({ books: books.map((b) => publicBook(b)) })
    }

    const auth = await import('@/lib/auth').then((m) => m.authenticateRequest(request, { id: true }))
    if (auth.error) return errorResponse(auth.error, 401)
    const userId = auth.user!.id

    const books = await db.eBook.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    })
    const owned = await db.userEBook.findMany({
      where: { userId },
      select: { bookId: true },
    })
    const ownedIds = new Set(owned.map((o) => o.bookId))

    return successResponse({ books: books.map((b) => publicBook(b, ownedIds.has(b.id))) })
  } catch (error) {
    console.error('GET /api/ebooks error:', error)
    return errorResponse('Failed to load e-books.', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { error, user } = await requireAdmin(request)
    if (error) return error
    if (!user) return errorResponse('Admin access required', 403)

    const body = await request.json()
    const parsed = validateBody(ebookSaveSchema, body)
    if (!parsed.success) return errorResponse(parsed.error, 400)
    const input = parsed.data

    const data = {
      slug: input.slug,
      title: input.title,
      author: input.author || 'TOPTIER',
      coverColor: input.coverColor || 'indigo',
      emoji: input.emoji || null,
      description: input.description,
      category: input.category || 'trading',
      level: input.level || 'beginner',
      price: input.price ?? 1.5,
      isActive: input.isActive ?? true,
      content: input.content,
    }

    if (input.id) {
      const clash = await db.eBook.findFirst({
        where: { slug: input.slug, NOT: { id: input.id } },
        select: { id: true },
      })
      if (clash) return errorResponse(`Another book already uses the slug "${input.slug}".`, 400)
      const updated = await db.eBook.update({ where: { id: input.id }, data })
      return successResponse({ book: publicBook(updated) })
    }

    const existing = await db.eBook.findUnique({ where: { slug: input.slug }, select: { id: true } })
    if (existing) {
      return errorResponse(`A book with slug "${input.slug}" already exists.`, 400)
    }
    const created = await db.eBook.create({ data })
    return successResponse({ book: publicBook(created) })
  } catch (error) {
    console.error('POST /api/ebooks error:', error)
    return errorResponse('Failed to save the e-book.', 500)
  }
}

// Public-facing shape — never exposes raw content (it only leaves the server
// through the owned-only GET /api/ebooks/:id endpoint).
function publicBook(
  b: {
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
    updatedAt: Date
  },
  owned = false
) {
  return {
    id: b.id,
    slug: b.slug,
    title: b.title,
    author: b.author,
    coverColor: b.coverColor,
    emoji: b.emoji,
    description: b.description,
    category: b.category,
    level: b.level,
    price: b.price,
    isActive: b.isActive,
    owned,
    updatedAt: b.updatedAt,
  }
}