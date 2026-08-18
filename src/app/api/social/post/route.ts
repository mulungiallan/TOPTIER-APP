import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { SocialFeedService } from '@/lib/services/social'

// GET /api/social/post?id=... — get a post and its comments
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const postId = searchParams.get('id')
    if (!postId) return errorResponse('id is required', 400)

    const comments = await SocialFeedService.getComments(postId)
    return successResponse({ comments })
  } catch (error) {
    console.error('Post GET error:', error)
    return errorResponse('Failed to fetch post', 500)
  }
}
