import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { GroupService } from '@/lib/services/social'

// GET /api/groups?category=trading  — list public groups OR my-groups
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') // 'mine' to get user's groups
    const category = searchParams.get('category') || undefined

    if (view === 'mine') {
      const groups = await GroupService.getUserGroups(userId)
      return successResponse({ groups })
    }
    const groups = await GroupService.listGroups(category)
    return successResponse({ groups })
  } catch (error) {
    console.error('Groups GET error:', error)
    return errorResponse('Failed to fetch groups', 500)
  }
}

// POST /api/groups — create a new group
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { name, description, category, isPrivate } = body
    if (!name?.trim()) return errorResponse('name is required', 400)

    const group = await GroupService.createGroup(userId, {
      name: name.trim(), description, category, isPrivate,
    })
    return successResponse({ group }, 201)
  } catch (error) {
    console.error('Groups POST error:', error)
    return errorResponse('Failed to create group', 500)
  }
}
