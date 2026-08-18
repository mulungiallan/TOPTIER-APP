import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { SocialFeedService } from '@/lib/services/social'

// GET /api/social/feed — get the social feed for the current user
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')
    const scope = searchParams.get('scope')
    const tag = searchParams.get('tag') || undefined

    const posts = scope === 'community'
      ? await SocialFeedService.getCommunityPosts(userId, tag, limit, offset)
      : await SocialFeedService.getFeed(userId, limit, offset)
    return successResponse({ posts })
  } catch (error) {
    console.error('Social feed GET error:', error)
    return errorResponse('Failed to fetch feed', 500)
  }
}

// POST /api/social/feed — create a new post
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { content, type, tags } = body

    if (!content || !content.trim()) {
      return errorResponse('Content is required', 400)
    }
    if (content.trim().length > 5000) {
      return errorResponse('Post too long (max 5000 characters)', 400)
    }

    const post = await SocialFeedService.createPost(userId, content.trim(), type || 'general', tags)
    return successResponse({ post }, 201)
  } catch (error) {
    console.error('Social feed POST error:', error)
    return errorResponse('Failed to create post', 500)
  }
}
