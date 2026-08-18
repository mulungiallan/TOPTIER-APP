import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

const REVIEW_CATEGORIES = ['general', 'signals', 'analysis', 'support', 'app']

function isModerator(role: string | null | undefined) {
  return role === 'admin' || role === 'super_admin' || role === 'moderator'
}

// GET /api/reviews  ->  { reviews, mine, stats }
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const [approved, mine] = await Promise.all([
      db.review.findMany({
        where: { status: 'approved' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { user: { select: { name: true, profilePicture: true, country: true } } },
      }),
      db.review.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const allRatings = await db.review.findMany({
      where: { status: 'approved' },
      select: { rating: true },
    })

    const total = allRatings.length
    const average = total > 0
      ? Math.round((allRatings.reduce((sum, r) => sum + r.rating, 0) / total) * 10) / 10
      : 0
    const distribution = [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: allRatings.filter((r) => r.rating === star).length,
    }))

    return successResponse({ reviews: approved, mine, stats: { average, total, distribution } })
  } catch (error) {
    console.error('Reviews GET error:', error)
    return errorResponse('Failed to fetch reviews', 500)
  }
}

// POST /api/reviews  body: { rating, title?, comment?, category? }
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { rating, title, comment, category } = body

    const parsedRating = Number(rating)
    if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return errorResponse('rating must be an integer between 1 and 5', 400)
    }
    const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 100) : ''
    const cleanComment = typeof comment === 'string' ? comment.trim().slice(0, 2000) : ''
    if (!cleanTitle && !cleanComment) {
      return errorResponse('title or comment is required', 400)
    }
    const cleanCategory = REVIEW_CATEGORIES.includes(category) ? category : 'general'

    const review = await db.review.create({
      data: {
        userId,
        rating: parsedRating,
        title: cleanTitle || null,
        comment: cleanComment || null,
        category: cleanCategory,
      },
    })

    return successResponse({ review }, 201)
  } catch (error) {
    console.error('Reviews POST error:', error)
    return errorResponse('Failed to submit review', 500)
  }
}

// PATCH /api/reviews  body: { id, status }  -> moderator approval
export async function PATCH(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const me = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
    if (!isModerator(me?.role)) return errorResponse('You do not have permission to moderate reviews', 403)

    const body = await request.json()
    const { id, status } = body
    if (!id || !['pending', 'approved', 'rejected'].includes(status)) {
      return errorResponse('id and a valid status are required', 400)
    }

    const review = await db.review.update({
      where: { id },
      data: { status },
    })

    return successResponse({ review })
  } catch (error) {
    console.error('Reviews PATCH error:', error)
    return errorResponse('Failed to update review', 500)
  }
}

// DELETE /api/reviews?id=...  -> own review, or any review as moderator
export async function DELETE(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return errorResponse('id is required', 400)

    const existing = await db.review.findUnique({ where: { id } })
    if (!existing) return errorResponse('Review not found', 404)

    const me = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
    if (existing.userId !== userId && !isModerator(me?.role)) {
      return errorResponse('You do not have permission to delete this review', 403)
    }

    await db.review.delete({ where: { id } })
    return successResponse({ deleted: true })
  } catch (error) {
    console.error('Reviews DELETE error:', error)
    return errorResponse('Failed to delete review', 500)
  }
}
