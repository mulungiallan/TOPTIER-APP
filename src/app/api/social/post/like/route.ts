import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { SocialFeedService } from '@/lib/services/social'

// POST /api/social/post/like — toggle like on a post
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { postId, action } = body // action: 'like' | 'unlike'

    if (!postId) return errorResponse('postId is required', 400)

    if (action === 'unlike') {
      await SocialFeedService.unlikePost(userId, postId)
    } else {
      try {
        await SocialFeedService.likePost(userId, postId)
      } catch {
        // Already liked — ignore unique constraint violation
        return successResponse({ liked: true, message: 'Already liked' })
      }
    }
    return successResponse({ liked: action !== 'unlike' })
  } catch (error) {
    console.error('Like POST error:', error)
    return errorResponse('Failed to toggle like', 500)
  }
}
