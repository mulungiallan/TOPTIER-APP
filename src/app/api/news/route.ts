import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const sentiment = searchParams.get('sentiment')
    const search = searchParams.get('search')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    const where: Record<string, unknown> = {}

    if (category) where.category = category
    if (sentiment) where.sentiment = sentiment
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { summary: { contains: search } },
        { taggedAssets: { contains: search } },
      ]
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
