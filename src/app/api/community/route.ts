import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getUserIdFromRequest, successResponse, errorResponse } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const signalId = searchParams.get('signalId')

    if (!signalId) {
      return errorResponse('signalId query parameter is required', 400)
    }

    const [comments, reactions] = await Promise.all([
      db.signalComment.findMany({
        where: { signalId },
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, profilePicture: true },
          },
        },
      }),
      db.signalReaction.findMany({
        where: { signalId },
        include: {
          user: {
            select: { id: true, name: true },
          },
        },
      }),
    ])

    // Aggregate reaction counts
    const reactionCounts = {
      thumbs_up: reactions.filter(r => r.reaction === 'thumbs_up').length,
      thumbs_down: reactions.filter(r => r.reaction === 'thumbs_down').length,
    }

    return successResponse({
      comments,
      reactions,
      reactionCounts,
    })
  } catch (error) {
    console.error('Community GET error:', error)
    return errorResponse('Failed to fetch community data', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request)
    if (!userId) {
      return errorResponse('Unauthorized', 401)
    }

    const body = await request.json()
    const { action } = body

    if (action === 'accept' || action === 'unaccept') {
      const { signalId } = body
      if (!signalId) {
        return errorResponse('signalId is required', 400)
      }

      // Accept / un-accept a signal.
      //
      // This records a row in UserSignal, a many-to-many join, so ANY number of
      // users can accept the same platform signal. It deliberately does NOT
      // write `Signal.userId`: that column is a single nullable FK meaning
      // "this signal belongs to one user" (used by user-generated signals), and
      // writing it here let the first accepter lock the signal out of every
      // other user with a 403.
      //
      // The outcome is not copied here. /api/performance and /api/signals
      // derive it from the parent Signal, so a resolving signal updates every
      // acceptor's history at once.
      const signal = await db.signal.findUnique({
        where: { id: signalId },
        select: { id: true, status: true },
      })
      if (!signal) {
        return errorResponse('Signal not found', 404)
      }

      if (action === 'unaccept') {
        await db.userSignal.deleteMany({ where: { userId, signalId } })
        return successResponse({ signalId, accepted: false })
      }

      // Only still-open signals can be accepted. Accepting an already-resolved
      // signal would silently add a guaranteed historical result to a user's
      // record, inflating their stats with something they never traded.
      if (['hit_tp', 'hit_sl', 'expired'].includes(signal.status)) {
        return errorResponse('This signal has already resolved and can no longer be accepted.', 409)
      }

      // upsert keyed on the unique (userId, signalId) index makes a double-tap
      // or a retried request idempotent instead of throwing.
      const row = await db.userSignal.upsert({
        where: { userId_signalId: { userId, signalId } },
        create: { userId, signalId },
        update: {},
        select: { id: true, acceptedAt: true },
      })

      return successResponse({ signalId, accepted: true, acceptedAt: row.acceptedAt })
    }

    // Add a comment
    if (action === 'comment') {
      const { signalId, content } = body
      if (!signalId || !content) {
        return errorResponse('signalId and content are required', 400)
      }

      // Verify signal exists
      const signal = await db.signal.findUnique({ where: { id: signalId } })
      if (!signal) {
        return errorResponse('Signal not found', 404)
      }

      const comment = await db.signalComment.create({
        data: {
          signalId,
          userId,
          content,
        },
        include: {
          user: {
            select: { id: true, name: true, profilePicture: true },
          },
        },
      })

      return successResponse(comment, 201)
    }

    // Add or toggle a reaction
    if (action === 'react') {
      const { signalId, reaction } = body
      if (!signalId || !reaction) {
        return errorResponse('signalId and reaction are required', 400)
      }

      if (!['thumbs_up', 'thumbs_down'].includes(reaction)) {
        return errorResponse('Invalid reaction. Use "thumbs_up" or "thumbs_down"', 400)
      }

      // Verify signal exists
      const signal = await db.signal.findUnique({ where: { id: signalId } })
      if (!signal) {
        return errorResponse('Signal not found', 404)
      }

      // Check for existing reaction
      const existingReaction = await db.signalReaction.findFirst({
        where: { signalId, userId },
      })

      if (existingReaction) {
        if (existingReaction.reaction === reaction) {
          // Remove reaction (toggle off)
          await db.signalReaction.delete({ where: { id: existingReaction.id } })
          return successResponse({ removed: true, reaction })
        } else {
          // Change reaction
          const updated = await db.signalReaction.update({
            where: { id: existingReaction.id },
            data: { reaction },
          })
          return successResponse(updated)
        }
      }

      // Create new reaction
      const newReaction = await db.signalReaction.create({
        data: { signalId, userId, reaction },
      })

      return successResponse(newReaction, 201)
    }

    return errorResponse('Invalid action. Use "comment" or "react"', 400)
  } catch (error) {
    console.error('Community POST error:', error)
    return errorResponse('Failed to process community action', 500)
  }
}
