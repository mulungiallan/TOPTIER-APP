import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { GroupService } from '@/lib/services/social'

// POST /api/groups/join — join or leave a group
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { groupId, action } = body // action: 'join' | 'leave'

    if (!groupId) return errorResponse('groupId is required', 400)

    if (action === 'leave') {
      await GroupService.leaveGroup(groupId, userId)
      return successResponse({ left: true })
    }
    await GroupService.joinGroup(groupId, userId)
    return successResponse({ joined: true }, 201)
  } catch (error) {
    console.error('Group join error:', error)
    return errorResponse('Failed to join/leave group', 500)
  }
}
