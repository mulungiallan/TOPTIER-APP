import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { paginationSchema, validateQuery } from '@/lib/validation'
import { newsIngester } from '@/lib/services/news-ingester'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const parsed = validateQuery(paginationSchema, searchParams)
    if (!parsed.success) {
      return errorResponse(parsed.error, 400)
    }
    const { limit, offset } = parsed.data
    const category = searchParams.get('category')
    const sentiment = searchParams.get('sentiment')
    const search = searchParams.get('search')

    const where: Record<string, unknown> = {}

    if (category) where.category = category.toLowerCase()
    if (sentiment) where.sentiment = sentiment.toLowerCase()
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { summary: { contains: search } },
        { taggedAssets: { contains: search } },
      ]
    }

    // ─── Lazy population ─────────────────────────────────────────────────
    // If the news table is empty/stale, pull fresh articles from Finnhub
    // on-the-fly so the page is never blank. Ingest throttled internally
    // (refresh at most once per 15 minutes, only when stale).
    const count = await db.newsArticle.count()
    if (count === 0) {
      await newsIngester.ensureNews()
    }

    const [articles, total] = await Promise.all([
      db.newsArticle.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.newsArticle.count({ where }),
    ])

    return successResponse({ articles, total, limit, offset })
  } catch (error) {
    console.error('News GET error:', error)
    return errorResponse('Failed to fetch articles', 500)
  }
}
