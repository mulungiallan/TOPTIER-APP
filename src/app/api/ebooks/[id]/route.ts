import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin-guard'
import type { EBook } from '@/generated/prisma'

// GET /api/ebooks/:id — full book including content, ONLY for owners/admins.
// Non-owners get a `locked: true` payload with no content (used by the reader
// to poll for unlock after a payment completes).
// DELETE /api/ebooks/:id — admin removes a book (and its purchases).
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const book = await db.eBook.findUnique({ where: { id: params.id } })
    if (!book) return errorResponse('E-book not found.', 404)

    const admin = await requireAdmin(request)
    if (admin.user) {
      return successResponse({ locked: false, owned: true, book: withContent(book) })
    }

    const auth = await import('@/lib/auth').then((m) => m.authenticateRequest(request, { id: true }))
    if (auth.error) return errorResponse(auth.error, 401)
    const userId = auth.user!.id

    const owned = !!(await db.userEBook.findUnique({
      where: { userId_bookId: { userId, bookId: book.id } },
      select: { id: true },
    }))

    if (!owned) {
      return successResponse({ locked: true, owned: false, book: withoutContent(book) })
    }

    return successResponse({ locked: false, owned: true, book: withContent(book) })
  } catch (error) {
    console.error('GET /api/ebooks/:id error:', error)
    return errorResponse('Failed to load the e-book.', 500)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { error, user } = await requireAdmin(request)
    if (error) return error
    if (!user) return errorResponse('Admin access required', 403)

    const book = await db.eBook.findUnique({ where: { id: params.id }, select: { id: true } })
    if (!book) return errorResponse('E-book not found.', 404)

    await db.userEBook.deleteMany({ where: { bookId: book.id } })
    await db.eBook.delete({ where: { id: book.id } })
    return successResponse({ deleted: true })
  } catch (error) {
    console.error('DELETE /api/ebooks/:id error:', error)
    return errorResponse('Failed to delete the e-book.', 500)
  }
}

function withoutContent(book: EBook) {
  const { content: _content, ...rest } = book
  void _content
  return rest
}

function withContent(book: EBook) {
  return book
}