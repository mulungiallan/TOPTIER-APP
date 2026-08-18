import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { SocialFeedService } from '@/lib/services/social'

// POST /api/social/post/comment — add a comment to a post
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { postId, content } = body

    if (!postId || !content?.trim()) {
      return errorResponse('postId and content are required', 400)
    }
    if (content.trim().length > 2000) {
      return errorResponse('Comment too long (max 2000 characters)', 400)
    }

    const comment = await SocialFeedService.commentPost(userId, postId, content.trim())
    return successResponse({ comment }, 201)
  } catch (error) {
    console.error('Comment POST error:', error)
    return errorResponse('Failed to add comment', 500)
  }
}
