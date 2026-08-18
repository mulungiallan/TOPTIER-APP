import { NextRequest } from 'next/server'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'
import { DirectMessagingService } from '@/lib/services/social'

// GET /api/messages?conversationId=...  — list messages in a conversation
// GET /api/messages                    — list conversations for the current user
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const { searchParams } = new URL(request.url)
    const conversationId = searchParams.get('conversationId')

    if (conversationId) {
      // IDOR guard: only participants may read a conversation
      const isMember = await DirectMessagingService.isParticipant(conversationId, userId)
      if (!isMember) return errorResponse('You do not have access to this conversation', 403)
      const messages = await DirectMessagingService.getMessages(conversationId)
      return successResponse({ messages })
    }
    const conversations = await DirectMessagingService.listConversations(userId)
    return successResponse({ conversations })
  } catch (error) {
    console.error('Messages GET error:', error)
    return errorResponse('Failed to fetch messages', 500)
  }
}

// POST /api/messages — start or continue a conversation
// body: { recipientId?, conversationId?, content }
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) return errorResponse('Unauthorized', 401)

    const body = await request.json()
    const { recipientId, conversationId, content } = body
    if (!content?.trim()) return errorResponse('content is required', 400)
    if (content.trim().length > 2000) return errorResponse('Message too long (max 2000 characters)', 400)

    let convId = conversationId
    if (!convId && recipientId) {
      const conv = await DirectMessagingService.getOrCreateConversation(userId, recipientId)
      convId = conv.id
    }
    if (!convId) return errorResponse('conversationId or recipientId is required', 400)

    // IDOR guard: cannot post into a conversation you're not part of
    if (conversationId) {
      const isMember = await DirectMessagingService.isParticipant(conversationId, userId)
      if (!isMember) return errorResponse('You do not have access to this conversation', 403)
    }

    const message = await DirectMessagingService.sendMessage(convId, userId, content.trim())
    return successResponse({ message }, 201)
  } catch (error) {
    console.error('Messages POST error:', error)
    return errorResponse('Failed to send message', 500)
  }
}
